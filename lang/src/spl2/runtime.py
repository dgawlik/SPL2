"""SPL2 Runtime execution engine for `ask`, `agent`, `decide`, `success`, and `failure`."""

from __future__ import annotations

import asyncio
import base64
import builtins
import contextvars
import glob as glob_mod
import json
import logging
import mimetypes
import os
import re
import sys
import time
import traceback
from contextlib import contextmanager
from dataclasses import asdict, is_dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any, Iterator, Sequence

from pydantic import BaseModel, TypeAdapter, ValidationError

from .compiler import SPL2SyntaxError, compile_spl2
from .context import (
    enforce_scope,
    forbid_scope,
    get_active_enforces,
    get_active_forbids,
    get_active_restrict,
    get_context_snapshot,
    restrict_scope,
)
from .importer import install_import_hook
from .mcp import MCPManager, MCPToolSpec
from .tools import (
    BUILTIN_TOOL_SCHEMAS,
    execute_builtin_tool,
    resolve_enabled_builtin_tools,
)
from .trace import (
    TraceManager,
    agent_loop_context,
    get_active_trace,
    trace_context,
)
from .tui import emit_tui_event, is_realtime_active

logger = logging.getLogger("spl2")

DEFAULT_MODEL = "gpt-4.1"

IMAGE_EXTENSIONS = frozenset({".png", ".jpg", ".jpeg", ".webp", ".gif"})
PDF_EXTENSIONS = frozenset({".pdf"})

LEN_GUIDANCE_MAP: dict[str, str] = {
    "word": "Respond with a single word or very short phrase.",
    "sentence": "Respond with a single concise sentence.",
    "paragraph": "Respond with a single well-structured paragraph.",
    "long": "Provide a comprehensive, detailed, multi-paragraph response.",
}

FMT_GUIDANCE_MAP: dict[str, str] = {
    "text": "Respond in plain text.",
    "object": "Respond ONLY with a valid JSON object (e.g. {\"key\": ...}). Do not wrap in markdown code fences.",
    "array": "Respond ONLY with a valid JSON array (e.g. [...]). Do not wrap in markdown code fences.",
    "string": "Respond ONLY with a valid JSON string literal (or plain string).",
    "float": "Respond ONLY with a single numeric floating-point value (e.g. 3.14).",
    "int": "Respond ONLY with a single integer value (e.g. 42).",
    "bool": "Respond ONLY with a JSON boolean literal: true or false.",
}


class SPL2SuccessException(BaseException):
    """Unwinds the call stack when `success <expr>` is executed."""

    def __init__(self, data: Any = None, lineno: int = 1) -> None:
        self.data = data
        self.lineno = lineno
        super().__init__("SPL2 success")


class SPL2FailureException(BaseException):
    """Unwinds the call stack when `failure <expr>` is executed."""

    def __init__(self, reason: Any = "Failure", lineno: int = 1) -> None:
        self.reason = str(reason) if reason is not None else "Failure"
        self.lineno = lineno
        super().__init__(self.reason)


class SPL2RuntimeError(RuntimeError):
    """Raised when an SPL2 operation fails with a known source line number."""

    def __init__(self, message: str, lineno: int | None = None) -> None:
        self.lineno = lineno
        super().__init__(message)


_cli_model_var: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "spl2_cli_model", default=None
)
_mcp_manager_var: contextvars.ContextVar[MCPManager | None] = contextvars.ContextVar(
    "spl2_mcp_manager", default=None
)
_sync_client_override: Any = None
_async_client_override: Any = None


def set_openai_clients(sync_client: Any = None, async_client: Any = None) -> None:
    """Allow tests or embedders to inject custom OpenAI / AsyncOpenAI clients."""
    global _sync_client_override, _async_client_override
    _sync_client_override = sync_client
    _async_client_override = async_client


def _get_sync_client() -> Any:
    if _sync_client_override is not None:
        return _sync_client_override
    from openai import OpenAI

    api_key = os.environ.get("OPENAI_API_KEY") or "sk-placeholder"
    base_url = os.environ.get("OPENAI_BASE_URL") or None
    return OpenAI(api_key=api_key, base_url=base_url)


def _get_async_client() -> Any:
    if _async_client_override is not None:
        return _async_client_override
    from openai import AsyncOpenAI

    api_key = os.environ.get("OPENAI_API_KEY") or "sk-placeholder"
    base_url = os.environ.get("OPENAI_BASE_URL") or None
    return AsyncOpenAI(api_key=api_key, base_url=base_url)


def resolve_model(per_call_model: str | None = None) -> str:
    """Resolve model with precedence: CLI `--model` > per-call `model=` > env var (`OPENAI_MODEL`/`SPL2_MODEL`) > default."""
    cli_m = _cli_model_var.get()
    if cli_m:
        return cli_m
    if per_call_model:
        return per_call_model
    env_m = os.environ.get("OPENAI_MODEL") or os.environ.get("SPL2_MODEL")
    if env_m:
        return env_m
    return DEFAULT_MODEL


def to_json_compatible(value: Any) -> Any:
    """Recursively convert Python objects (Pydantic models, dataclasses, dates, Paths, sets) into JSON-serializable structures."""
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    if is_dataclass(value) and not isinstance(value, type):
        return to_json_compatible(asdict(value))
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, dict):
        return {str(k): to_json_compatible(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set, frozenset)):
        return [to_json_compatible(v) for v in value]
    return str(value)


def trigger_success(data: Any = None, *, lineno: int = 1) -> None:
    """Terminate execution immediately with status='ok' and given data."""
    raise SPL2SuccessException(data=to_json_compatible(data), lineno=lineno)


def trigger_failure(reason: Any = "Failure", *, lineno: int = 1) -> None:
    """Terminate execution immediately with status='failure' and given reason."""
    if isinstance(reason, (dict, list, BaseModel)):
        reason_str = json.dumps(to_json_compatible(reason), ensure_ascii=False)
    else:
        reason_str = str(reason)
    raise SPL2FailureException(reason=reason_str, lineno=lineno)


def _resolve_files(
    files_spec: str | Path | Sequence[str | Path] | None,
    lineno: int | None = None,
) -> tuple[list[tuple[str, str]], list[dict[str, Any]], list[dict[str, str]]]:
    """Validate and load files specified by `files=`.

    Returns:
      - `text_blocks`: list of `(display_path, utf8_content)`
      - `attachment_blocks`: list of OpenAI content blocks (`input_image` / `input_file`)
      - `trace_meta`: list of `{"path": ..., "sha256": ...}` for deterministic trace hashing
    """
    if files_spec is None:
        return [], [], []

    if isinstance(files_spec, (str, Path)):
        raw_items = [files_spec]
    else:
        raw_items = list(files_spec)

    if not raw_items:
        raise SPL2RuntimeError("Modifier 'files' matched no files (empty sequence).", lineno=lineno)

    matched_paths: list[Path] = []
    restrict_policy = get_active_restrict()

    for item in raw_items:
        pattern_str = str(item)
        if any(ch in pattern_str for ch in ("*", "?", "[")):
            matches = sorted(glob_mod.glob(pattern_str, recursive=True))
            file_matches = [Path(m) for m in matches if Path(m).is_file()]
            if not file_matches:
                raise SPL2RuntimeError(
                    f"File pattern '{pattern_str}' matched no existing files.",
                    lineno=lineno,
                )
            for p in file_matches:
                restrict_policy.check_fs(p)
                matched_paths.append(p)
        else:
            p = Path(pattern_str)
            restrict_policy.check_fs(p)
            if not p.is_file():
                raise SPL2RuntimeError(
                    f"File not found: '{pattern_str}'.",
                    lineno=lineno,
                )
            matched_paths.append(p)

    import hashlib

    text_blocks: list[tuple[str, str]] = []
    attachment_blocks: list[dict[str, Any]] = []
    trace_meta: list[dict[str, str]] = []

    for p in matched_paths:
        raw_bytes = p.read_bytes()
        sha = hashlib.sha256(raw_bytes).hexdigest()
        display_path = p.as_posix()
        trace_meta.append({"path": display_path, "sha256": sha})
        ext = p.suffix.lower()

        if ext in IMAGE_EXTENSIONS:
            mime, _ = mimetypes.guess_type(p.name)
            mime = mime or f"image/{ext.lstrip('.')}"
            b64 = base64.b64encode(raw_bytes).decode("ascii")
            attachment_blocks.append(
                {
                    "type": "input_image",
                    "image_url": f"data:{mime};base64,{b64}",
                }
            )
        elif ext in PDF_EXTENSIONS:
            b64 = base64.b64encode(raw_bytes).decode("ascii")
            attachment_blocks.append(
                {
                    "type": "input_file",
                    "filename": p.name,
                    "file_data": f"data:application/pdf;base64,{b64}",
                }
            )
        else:
            text_content = raw_bytes.decode("utf-8", errors="replace")
            text_blocks.append((display_path, text_content))

    return text_blocks, attachment_blocks, trace_meta


def _build_system_instructions(
    *,
    kind: str,
    len_mod: str | None = None,
    fmt_mod: str = "text",
    schema_mod: Any = None,
) -> str:
    """Assemble system instructions incorporating `len`, `fmt`/`schema`, `enforce`, and `forbid`."""
    parts: list[str] = []
    if kind == "decide":
        parts.append(
            "You are a precise boolean evaluator. Evaluate whether the user's statement/predicate holds true given the provided evidence. "
            'Respond with a JSON object matching {"result": true} or {"result": false}.'
        )
    elif kind == "agent":
        parts.append(
            "You are an autonomous SPL2 agent. Use the available tools when needed to inspect files, run commands, fetch URLs, or search the web, then provide the final answer."
        )
    else:
        parts.append("You are a precise SPL2 assistant.")

    if len_mod:
        guidance = LEN_GUIDANCE_MAP.get(len_mod, f"Target response length: {len_mod}.")
        parts.append(f"Length guidance: {guidance}")

    if schema_mod is not None:
        schema_json = _get_json_schema(schema_mod)
        parts.append(
            "You MUST return valid JSON strictly conforming to the following JSON Schema:\n"
            + json.dumps(schema_json, indent=2)
        )
    elif kind != "decide":
        fmt_guidance = FMT_GUIDANCE_MAP.get(fmt_mod, FMT_GUIDANCE_MAP["text"])
        parts.append(fmt_guidance)

    enforces = get_active_enforces()
    for c in enforces:
        parts.append(f"MANDATORY CONSTRAINT — You MUST satisfy this constraint: {c}")

    forbids = get_active_forbids()
    for c in forbids:
        parts.append(f"PROHIBITED CONSTRAINT — You MUST NOT do this: {c}")

    return "\n\n".join(parts)


def _get_json_schema(schema_mod: Any) -> dict[str, Any]:
    if isinstance(schema_mod, type) and issubclass(schema_mod, BaseModel):
        return schema_mod.model_json_schema()
    return TypeAdapter(schema_mod).json_schema()


def _strip_markdown_fences(text: str) -> str:
    stripped = text.strip()
    m = re.match(r"^```(?:json|[a-zA-Z0-9_-]*)?\s*\r?\n(.*?)\r?\n```\s*$", stripped, re.DOTALL)
    if m:
        return m.group(1).strip()
    return stripped


def _validate_and_parse_output(
    raw_text: str,
    *,
    fmt: str = "text",
    schema: Any = None,
    parsed_obj: Any = None,
) -> Any:
    """Validate and parse raw LLM output against `schema` or `fmt`."""
    if schema is not None:
        if parsed_obj is not None:
            if isinstance(schema, type) and issubclass(schema, BaseModel) and isinstance(parsed_obj, schema):
                return parsed_obj
        cleaned = _strip_markdown_fences(raw_text)
        if isinstance(schema, type) and issubclass(schema, BaseModel):
            return schema.model_validate_json(cleaned)
        return TypeAdapter(schema).validate_json(cleaned)

    if fmt == "text":
        return raw_text

    cleaned = _strip_markdown_fences(raw_text)
    if fmt == "object":
        val = json.loads(cleaned)
        if not isinstance(val, dict):
            raise ValueError(f"Expected a JSON object for fmt='object', got {type(val).__name__}.")
        return val
    if fmt == "array":
        val = json.loads(cleaned)
        if not isinstance(val, list):
            raise ValueError(f"Expected a JSON array for fmt='array', got {type(val).__name__}.")
        return val
    if fmt == "string":
        try:
            val = json.loads(cleaned)
            if isinstance(val, str):
                return val
        except Exception:
            pass
        return cleaned
    if fmt == "int":
        try:
            val = json.loads(cleaned)
        except Exception:
            val = int(cleaned.strip())
        if isinstance(val, bool) or not isinstance(val, int):
            raise ValueError(f"Expected an integer for fmt='int', got {raw_text!r}.")
        return val
    if fmt == "float":
        try:
            val = json.loads(cleaned)
        except Exception:
            val = float(cleaned.strip())
        if isinstance(val, bool) or not isinstance(val, (int, float)):
            raise ValueError(f"Expected a float for fmt='float', got {raw_text!r}.")
        return float(val)
    if fmt == "bool":
        lowered = cleaned.lower().strip()
        if lowered in {"true", '{"result": true}'}:
            return True
        if lowered in {"false", '{"result": false}'}:
            return False
        val = json.loads(cleaned)
        if isinstance(val, dict) and "result" in val and isinstance(val["result"], bool):
            return val["result"]
        if not isinstance(val, bool):
            raise ValueError(f"Expected a boolean for fmt='bool', got {raw_text!r}.")
        return val

    raise ValueError(f"Unsupported fmt value: {fmt!r}")


def _extract_reasoning_from_item(item: Any) -> list[str]:
    """Extract reasoning text chunks from a single OpenAI reasoning output item."""
    texts: list[str] = []
    summaries = (
        getattr(item, "summary", None)
        or (item.get("summary") if isinstance(item, dict) else None)
        or []
    )
    for s in summaries:
        s_text = getattr(s, "text", None) or (
            s.get("text") if isinstance(s, dict) else None
        )
        if s_text:
            texts.append(str(s_text))
    if not texts:
        contents = (
            getattr(item, "content", None)
            or (item.get("content") if isinstance(item, dict) else None)
            or []
        )
        for c in contents:
            c_text = getattr(c, "text", None) or (
                c.get("text") if isinstance(c, dict) else None
            )
            if c_text:
                texts.append(str(c_text))
    return texts


def _extract_response_data(response: Any) -> tuple[str, list[str], list[dict[str, Any]], Any]:
    """Extract `(output_text, reasoning_summaries, function_calls, parsed_output)` from an OpenAI Responses API object."""
    reasoning_texts: list[str] = []
    tool_calls: list[dict[str, Any]] = []
    text_chunks: list[str] = []
    parsed_obj = getattr(response, "output_parsed", None)

    output_items = getattr(response, "output", None) or []
    for item in output_items:
        item_type = getattr(item, "type", None) or (item.get("type") if isinstance(item, dict) else None)
        if item_type == "reasoning":
            reasoning_texts.extend(_extract_reasoning_from_item(item))
        elif item_type == "function_call":
            call_id = getattr(item, "call_id", None) or (item.get("call_id") if isinstance(item, dict) else None) or getattr(item, "id", "call_1")
            name = getattr(item, "name", None) or (item.get("name") if isinstance(item, dict) else "")
            arguments = getattr(item, "arguments", None) or (item.get("arguments") if isinstance(item, dict) else "{}")
            tool_calls.append({"call_id": str(call_id), "name": str(name), "arguments": str(arguments)})
        elif item_type == "message":
            contents = getattr(item, "content", None) or (item.get("content") if isinstance(item, dict) else None) or []
            for c in contents:
                c_text = getattr(c, "text", None) or (c.get("text") if isinstance(c, dict) else None)
                if c_text is not None:
                    text_chunks.append(str(c_text))
                c_parsed = getattr(c, "parsed", None) or (c.get("parsed") if isinstance(c, dict) else None)
                if c_parsed is not None and parsed_obj is None:
                    parsed_obj = c_parsed

    if not reasoning_texts:
        streamed_reasoning = getattr(response, "_spl2_streamed_reasoning_text", "")
        if streamed_reasoning:
            reasoning_texts.append(str(streamed_reasoning))

    output_text = getattr(response, "output_text", None)
    if output_text is None:
        output_text = "".join(text_chunks)
    if not output_text:
        streamed_text = getattr(response, "_spl2_streamed_text", "")
        if streamed_text:
            output_text = str(streamed_text)
    return str(output_text), reasoning_texts, tool_calls, parsed_obj


def _emit_reasoning_if_needed(
    response: Any, reasoning_list: list[str], *, step_idx: int | None = None
) -> None:
    """Log reasoning at DEBUG level and emit a single whole `reasoning` TUI event if not already streamed."""
    if not reasoning_list:
        return
    combined = "\n".join(r for r in reasoning_list if r)
    if not combined:
        return
    if step_idx is not None:
        logger.debug("SPL2 agent reasoning [step %d]: %s", step_idx, combined)
    else:
        logger.debug("SPL2 reasoning: %s", combined)
    if not getattr(response, "_spl2_streamed_reasoning", False):
        emit_tui_event("reasoning", {"text": combined})


class _StreamEventAccumulator:
    """Accumulates and forwards realtime reasoning and response deltas during an OpenAI stream."""

    def __init__(self) -> None:
        self.reasoning_chunks: list[str] = []
        self.text_chunks: list[str] = []
        self.reasoning_part_done: bool = False
        self.emitted_reasoning_final: bool = False

    def handle_event(self, event: Any) -> None:
        event_type = getattr(event, "type", None) or (
            event.get("type") if isinstance(event, dict) else None
        )
        if not event_type:
            return

        if event_type in {
            "response.reasoning_summary_text.delta",
            "response.reasoning_text.delta",
        }:
            delta = getattr(event, "delta", None) or (
                event.get("delta") if isinstance(event, dict) else None
            )
            if delta:
                delta_str = str(delta)
                if self.reasoning_part_done and self.reasoning_chunks:
                    self.reasoning_chunks.append("\n")
                    emit_tui_event("reasoning_delta", {"delta": "\n", "text": "\n"})
                    self.reasoning_part_done = False
                self.reasoning_chunks.append(delta_str)
                emit_tui_event("reasoning_delta", {"delta": delta_str, "text": delta_str})
            return

        if event_type in {
            "response.reasoning_summary_part.done",
            "response.reasoning_summary_text.done",
            "response.reasoning_text.done",
        }:
            if self.reasoning_chunks:
                self.reasoning_part_done = True
            return

        if event_type == "response.output_item.done":
            item = getattr(event, "item", None) or (
                event.get("item") if isinstance(event, dict) else None
            )
            item_type = getattr(item, "type", None) or (
                item.get("type") if isinstance(item, dict) else None
            )
            if item_type == "reasoning":
                if not self.reasoning_chunks:
                    item_reasoning = _extract_reasoning_from_item(item)
                    if item_reasoning:
                        combined = "\n".join(item_reasoning)
                        self.reasoning_chunks.append(combined)
                        emit_tui_event(
                            "reasoning_delta", {"delta": combined, "text": combined}
                        )
                if self.reasoning_chunks and not self.emitted_reasoning_final:
                    emit_tui_event(
                        "reasoning", {"text": "".join(self.reasoning_chunks)}
                    )
                    self.emitted_reasoning_final = True
            return

        if event_type == "response.output_text.delta":
            delta = getattr(event, "delta", None) or (
                event.get("delta") if isinstance(event, dict) else None
            )
            if delta:
                if self.reasoning_chunks and not self.emitted_reasoning_final:
                    emit_tui_event(
                        "reasoning", {"text": "".join(self.reasoning_chunks)}
                    )
                    self.emitted_reasoning_final = True
                delta_str = str(delta)
                self.text_chunks.append(delta_str)
                emit_tui_event("response_delta", {"delta": delta_str, "text": delta_str})
            return

    def finalize_response(self, resp: Any) -> Any:
        if self.reasoning_chunks and not self.emitted_reasoning_final:
            emit_tui_event("reasoning", {"text": "".join(self.reasoning_chunks)})
            self.emitted_reasoning_final = True
        try:
            setattr(resp, "_spl2_streamed_reasoning", self.emitted_reasoning_final)
            setattr(
                resp, "_spl2_streamed_reasoning_text", "".join(self.reasoning_chunks)
            )
            setattr(resp, "_spl2_streamed_text", "".join(self.text_chunks))
        except Exception:
            pass
        return resp


def _is_transient_api_error(exc: BaseException) -> bool:
    """Return True if exc is a rate-limit (429), 5xx server error, or transient network timeout."""
    status_code = getattr(exc, "status_code", None)
    if isinstance(status_code, int) and (status_code == 429 or status_code >= 500):
        return True
    cls_name = type(exc).__name__
    if cls_name in {
        "RateLimitError",
        "APITimeoutError",
        "APIConnectionError",
        "InternalServerError",
        "TimeoutError",
        "ConnectionError",
    }:
        return True
    return False


def _build_reasoning_param(thinking: str | None) -> dict[str, Any] | None:
    if not thinking or thinking == "none":
        return None
    effort = "high" if thinking == "max" else thinking
    if is_realtime_active():
        return {"effort": effort, "summary": "auto"}
    return {"effort": effort}


def _build_user_input(
    prompt_str: str,
    text_blocks: list[tuple[str, str]],
    attachment_blocks: list[dict[str, Any]],
) -> str | list[dict[str, Any]]:
    full_text_parts: list[str] = []
    for path_str, content in text_blocks:
        full_text_parts.append(f'<file path="{path_str}">\n{content}\n</file>')
    full_text_parts.append(prompt_str)
    combined_text = "\n\n".join(full_text_parts)

    if not attachment_blocks:
        return combined_text

    content_list: list[dict[str, Any]] = [{"type": "input_text", "text": combined_text}]
    content_list.extend(attachment_blocks)
    return [{"role": "user", "content": content_list}]


def _invoke_responses_sync(
    client: Any,
    *,
    model: str,
    instructions: str,
    input_payload: Any,
    tokens: int | None,
    thinking: str | None,
    schema: Any,
    tools: list[dict[str, Any]] | None,
    retries: int,
) -> Any:
    """Call OpenAI `client.responses.parse` or `client.responses.create` with exponential backoff for transient errors."""
    kwargs: dict[str, Any] = {
        "model": model,
        "instructions": instructions,
        "input": input_payload,
    }
    if tokens is not None:
        kwargs["max_output_tokens"] = tokens
    reasoning_cfg = _build_reasoning_param(thinking)
    if reasoning_cfg is not None:
        kwargs["reasoning"] = reasoning_cfg
    if tools:
        kwargs["tools"] = tools

    use_parse = (
        schema is not None
        and isinstance(schema, type)
        and issubclass(schema, BaseModel)
        and not tools
        and hasattr(client.responses, "parse")
    )
    use_stream = is_realtime_active() and hasattr(client.responses, "stream")

    attempt = 0
    while True:
        try:
            if use_stream:
                stream_kwargs = dict(kwargs)
                if use_parse:
                    stream_kwargs["text_format"] = schema
                acc = _StreamEventAccumulator()
                with client.responses.stream(**stream_kwargs) as stream_ctx:
                    for event in stream_ctx:
                        acc.handle_event(event)
                    final_resp = stream_ctx.get_final_response()
                return acc.finalize_response(final_resp)
            if use_parse:
                return client.responses.parse(**kwargs, text_format=schema)
            return client.responses.create(**kwargs)
        except BaseException as exc:
            if (
                isinstance(kwargs.get("reasoning"), dict)
                and "summary" in kwargs["reasoning"]
                and "summary" in str(exc).lower()
            ):
                kwargs["reasoning"] = {"effort": kwargs["reasoning"]["effort"]}
                continue
            if _is_transient_api_error(exc) and attempt < retries:
                delay = min(8.0, 0.5 * (2**attempt))
                attempt += 1
                logger.debug(
                    "Transient OpenAI API error (%s), backing off %.2fs (retry %d/%d)",
                    exc,
                    delay,
                    attempt,
                    retries,
                )
                time.sleep(delay)
                continue
            raise


async def _invoke_responses_async(
    client: Any,
    *,
    model: str,
    instructions: str,
    input_payload: Any,
    tokens: int | None,
    thinking: str | None,
    schema: Any,
    tools: list[dict[str, Any]] | None,
    retries: int,
) -> Any:
    """Call AsyncOpenAI `client.responses.parse` or `client.responses.create` with exponential backoff."""
    kwargs: dict[str, Any] = {
        "model": model,
        "instructions": instructions,
        "input": input_payload,
    }
    if tokens is not None:
        kwargs["max_output_tokens"] = tokens
    reasoning_cfg = _build_reasoning_param(thinking)
    if reasoning_cfg is not None:
        kwargs["reasoning"] = reasoning_cfg
    if tools:
        kwargs["tools"] = tools

    use_parse = (
        schema is not None
        and isinstance(schema, type)
        and issubclass(schema, BaseModel)
        and not tools
        and hasattr(client.responses, "parse")
    )
    use_stream = is_realtime_active() and hasattr(client.responses, "stream")

    attempt = 0
    while True:
        try:
            if use_stream:
                stream_kwargs = dict(kwargs)
                if use_parse:
                    stream_kwargs["text_format"] = schema
                acc = _StreamEventAccumulator()
                async with client.responses.stream(**stream_kwargs) as stream_ctx:
                    async for event in stream_ctx:
                        acc.handle_event(event)
                    final_resp = await stream_ctx.get_final_response()
                return acc.finalize_response(final_resp)
            if use_parse:
                return await client.responses.parse(**kwargs, text_format=schema)
            return await client.responses.create(**kwargs)
        except BaseException as exc:
            if (
                isinstance(kwargs.get("reasoning"), dict)
                and "summary" in kwargs["reasoning"]
                and "summary" in str(exc).lower()
            ):
                kwargs["reasoning"] = {"effort": kwargs["reasoning"]["effort"]}
                continue
            if _is_transient_api_error(exc) and attempt < retries:
                delay = min(8.0, 0.5 * (2**attempt))
                attempt += 1
                logger.debug(
                    "Transient AsyncOpenAI error (%s), backing off %.2fs (retry %d/%d)",
                    exc,
                    delay,
                    attempt,
                    retries,
                )
                await asyncio.sleep(delay)
                continue
            raise


def _rehydrate_cached_value(cached: Any, schema: Any, fmt: str) -> Any:
    """Convert a JSON-deserialized trace value back into the target `schema` or `fmt` type."""
    if schema is not None:
        if isinstance(schema, type) and issubclass(schema, BaseModel):
            if isinstance(cached, schema):
                return cached
            return schema.model_validate(cached)
        return TypeAdapter(schema).validate_python(cached)
    if fmt == "float" and isinstance(cached, (int, float)):
        return float(cached)
    if fmt == "int" and isinstance(cached, int):
        return int(cached)
    return cached


def _make_trace_payload(
    *,
    kind: str,
    prompt_str: str,
    model: str,
    len_mod: str | None,
    fmt: str,
    schema: Any,
    tokens: int | None,
    thinking: str | None,
    files_meta: list[dict[str, str]],
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    schema_sig = _get_json_schema(schema) if schema is not None else None
    payload: dict[str, Any] = {
        "prompt": prompt_str,
        "model": model,
        "context": get_context_snapshot(),
        "modifiers": {
            "len": len_mod,
            "fmt": fmt if schema is None else None,
            "schema": schema_sig,
            "tokens": tokens,
            "thinking": thinking,
            "files": files_meta,
        },
    }
    if extra:
        payload["modifiers"].update(extra)
    return payload


def ask_sync(
    prompt: Any,
    *,
    len: str | None = None,
    fmt: str = "text",
    schema: Any = None,
    tokens: int | None = None,
    retries: int = 0,
    thinking: str | None = None,
    files: str | Path | Sequence[str | Path] | None = None,
    model: str | None = None,
    __lineno__: int = 1,
) -> Any:
    """Synchronous `ask` execution with OpenAI Responses API, files, self-repair retries, and trace support."""
    prompt_str = str(prompt)
    resolved_model = resolve_model(model)
    text_blocks, attachment_blocks, files_meta = _resolve_files(files, lineno=__lineno__)

    trace = get_active_trace()
    trace_payload = _make_trace_payload(
        kind="ask",
        prompt_str=prompt_str,
        model=resolved_model,
        len_mod=len,
        fmt=fmt,
        schema=schema,
        tokens=tokens,
        thinking=thinking,
        files_meta=files_meta,
    )
    claimed_hash = ""
    claimed_occ = 0
    if trace is not None:
        claimed_hash, claimed_occ, hit, cached = trace.claim_occurrence("ask", trace_payload)
        if hit:
            val = _rehydrate_cached_value(cached, schema=schema, fmt=fmt)
            emit_tui_event("prompt", {"kind": "ask (replay)", "model": resolved_model, "prompt": prompt_str})
            emit_tui_event("response", {"text": to_json_compatible(val)})
            return val

    instructions = _build_system_instructions(
        kind="ask", len_mod=len, fmt_mod=fmt, schema_mod=schema
    )
    user_input = _build_user_input(prompt_str, text_blocks, attachment_blocks)

    logger.debug(
        "SPL2 ask [model=%s, fmt=%s, schema=%s, thinking=%s, enforcements=%s, prohibitions=%s]\nPrompt: %s",
        resolved_model,
        fmt,
        getattr(schema, "__name__", schema),
        thinking,
        get_active_enforces(),
        get_active_forbids(),
        prompt_str,
    )
    emit_tui_event("prompt", {"kind": "ask", "model": resolved_model, "prompt": prompt_str})

    client = _get_sync_client()
    conversation: list[dict[str, Any]] | str = user_input
    repair_attempt = 0

    while True:
        try:
            resp = _invoke_responses_sync(
                client,
                model=resolved_model,
                instructions=instructions,
                input_payload=conversation,
                tokens=tokens,
                thinking=thinking,
                schema=schema,
                tools=None,
                retries=retries,
            )
        except BaseException as exc:
            raise SPL2RuntimeError(f"LLM call failed in ask: {exc}", lineno=__lineno__) from exc

        raw_text, reasoning_list, _, parsed_obj = _extract_response_data(resp)
        _emit_reasoning_if_needed(resp, reasoning_list)

        logger.debug("SPL2 raw response: %s", raw_text)
        emit_tui_event("response", {"text": raw_text})

        try:
            validated = _validate_and_parse_output(
                raw_text, fmt=fmt, schema=schema, parsed_obj=parsed_obj
            )
            if trace is not None:
                trace.store_claimed(
                    "ask", claimed_hash, claimed_occ, to_json_compatible(validated)
                )
            return validated
        except (ValidationError, ValueError, json.JSONDecodeError) as val_exc:
            if repair_attempt < retries:
                repair_attempt += 1
                logger.debug(
                    "Validation failed on ask (attempt %d/%d): %s — performing self-repair",
                    repair_attempt,
                    retries,
                    val_exc,
                )
                emit_tui_event(
                    "retry", {"attempt": repair_attempt, "error": str(val_exc)}
                )
                if isinstance(conversation, str):
                    conversation = [{"role": "user", "content": conversation}]
                else:
                    conversation = list(conversation)
                conversation.append({"role": "assistant", "content": raw_text})
                conversation.append(
                    {
                        "role": "user",
                        "content": (
                            f"Your previous response failed output validation with the following error:\n{val_exc}\n\n"
                            "Please correct your response so it strictly satisfies the required format/schema."
                        ),
                    }
                )
                continue
            raise SPL2RuntimeError(
                f"Output validation failed after {repair_attempt} retries: {val_exc}",
                lineno=__lineno__,
            ) from val_exc


async def ask_async(
    prompt: Any,
    *,
    len: str | None = None,
    fmt: str = "text",
    schema: Any = None,
    tokens: int | None = None,
    retries: int = 0,
    thinking: str | None = None,
    files: str | Path | Sequence[str | Path] | None = None,
    model: str | None = None,
    __lineno__: int = 1,
) -> Any:
    """Asynchronous `ask` execution using `AsyncOpenAI`."""
    prompt_str = str(prompt)
    resolved_model = resolve_model(model)
    text_blocks, attachment_blocks, files_meta = _resolve_files(files, lineno=__lineno__)

    trace = get_active_trace()
    trace_payload = _make_trace_payload(
        kind="ask",
        prompt_str=prompt_str,
        model=resolved_model,
        len_mod=len,
        fmt=fmt,
        schema=schema,
        tokens=tokens,
        thinking=thinking,
        files_meta=files_meta,
    )
    claimed_hash = ""
    claimed_occ = 0
    if trace is not None:
        claimed_hash, claimed_occ, hit, cached = trace.claim_occurrence("ask", trace_payload)
        if hit:
            val = _rehydrate_cached_value(cached, schema=schema, fmt=fmt)
            emit_tui_event("prompt", {"kind": "ask (replay)", "model": resolved_model, "prompt": prompt_str})
            emit_tui_event("response", {"text": to_json_compatible(val)})
            return val

    instructions = _build_system_instructions(
        kind="ask", len_mod=len, fmt_mod=fmt, schema_mod=schema
    )
    user_input = _build_user_input(prompt_str, text_blocks, attachment_blocks)

    logger.debug("SPL2 async ask [model=%s]\nPrompt: %s", resolved_model, prompt_str)
    emit_tui_event("prompt", {"kind": "await ask", "model": resolved_model, "prompt": prompt_str})

    client = _get_async_client()
    conversation: list[dict[str, Any]] | str = user_input
    repair_attempt = 0

    while True:
        try:
            resp = await _invoke_responses_async(
                client,
                model=resolved_model,
                instructions=instructions,
                input_payload=conversation,
                tokens=tokens,
                thinking=thinking,
                schema=schema,
                tools=None,
                retries=retries,
            )
        except BaseException as exc:
            raise SPL2RuntimeError(f"LLM call failed in async ask: {exc}", lineno=__lineno__) from exc

        raw_text, reasoning_list, _, parsed_obj = _extract_response_data(resp)
        _emit_reasoning_if_needed(resp, reasoning_list)

        logger.debug("SPL2 raw response: %s", raw_text)
        emit_tui_event("response", {"text": raw_text})

        try:
            validated = _validate_and_parse_output(
                raw_text, fmt=fmt, schema=schema, parsed_obj=parsed_obj
            )
            if trace is not None:
                trace.store_claimed(
                    "ask", claimed_hash, claimed_occ, to_json_compatible(validated)
                )
            return validated
        except (ValidationError, ValueError, json.JSONDecodeError) as val_exc:
            if repair_attempt < retries:
                repair_attempt += 1
                logger.debug(
                    "Validation failed on async ask (attempt %d/%d): %s — performing self-repair",
                    repair_attempt,
                    retries,
                    val_exc,
                )
                emit_tui_event("retry", {"attempt": repair_attempt, "error": str(val_exc)})
                if isinstance(conversation, str):
                    conversation = [{"role": "user", "content": conversation}]
                else:
                    conversation = list(conversation)
                conversation.append({"role": "assistant", "content": raw_text})
                conversation.append(
                    {
                        "role": "user",
                        "content": (
                            f"Your previous response failed output validation with the following error:\n{val_exc}\n\n"
                            "Please correct your response so it strictly satisfies the required format/schema."
                        ),
                    }
                )
                continue
            raise SPL2RuntimeError(
                f"Output validation failed after {repair_attempt} retries: {val_exc}",
                lineno=__lineno__,
            ) from val_exc


class _DecideSchema(BaseModel):
    result: bool


def _format_decide_prompt(prompt: Any, data: Any = None) -> str:
    predicate_str = str(prompt)
    if data is None:
        return f"Predicate to evaluate:\n{predicate_str}"
    serialized_data = json.dumps(to_json_compatible(data), ensure_ascii=False, indent=2)
    return f"Evidence / Data:\n{serialized_data}\n\nPredicate to evaluate:\n{predicate_str}"


def decide_sync(
    prompt: Any,
    *,
    data: Any = None,
    len: str | None = None,
    fmt: str = "bool",
    schema: Any = None,
    tokens: int | None = None,
    retries: int = 0,
    thinking: str | None = None,
    files: str | Path | Sequence[str | Path] | None = None,
    model: str | None = None,
    __lineno__: int = 1,
) -> bool:
    """Synchronous `decide` evaluation returning a Python `bool`."""
    full_prompt = _format_decide_prompt(prompt, data=data)
    resolved_model = resolve_model(model)
    text_blocks, attachment_blocks, files_meta = _resolve_files(files, lineno=__lineno__)

    trace = get_active_trace()
    trace_payload = _make_trace_payload(
        kind="decide",
        prompt_str=full_prompt,
        model=resolved_model,
        len_mod=len,
        fmt="bool",
        schema=None,
        tokens=tokens,
        thinking=thinking,
        files_meta=files_meta,
        extra={"data": to_json_compatible(data)},
    )
    claimed_hash = ""
    claimed_occ = 0
    if trace is not None:
        claimed_hash, claimed_occ, hit, cached = trace.claim_occurrence("decide", trace_payload)
        if hit:
            res_bool = bool(cached)
            emit_tui_event("prompt", {"kind": "decide (replay)", "model": resolved_model, "prompt": full_prompt})
            emit_tui_event("response", {"text": res_bool})
            return res_bool

    instructions = _build_system_instructions(kind="decide", len_mod=len, fmt_mod="bool")
    user_input = _build_user_input(full_prompt, text_blocks, attachment_blocks)

    logger.debug("SPL2 decide [model=%s]\n%s", resolved_model, full_prompt)
    emit_tui_event("prompt", {"kind": "decide", "model": resolved_model, "prompt": full_prompt})

    client = _get_sync_client()
    conversation: list[dict[str, Any]] | str = user_input
    repair_attempt = 0

    while True:
        try:
            resp = _invoke_responses_sync(
                client,
                model=resolved_model,
                instructions=instructions,
                input_payload=conversation,
                tokens=tokens,
                thinking=thinking,
                schema=_DecideSchema,
                tools=None,
                retries=retries,
            )
        except BaseException as exc:
            raise SPL2RuntimeError(f"LLM call failed in decide: {exc}", lineno=__lineno__) from exc

        raw_text, reasoning_list, _, parsed_obj = _extract_response_data(resp)
        _emit_reasoning_if_needed(resp, reasoning_list)

        logger.debug("SPL2 decide raw response: %s", raw_text)
        emit_tui_event("response", {"text": raw_text})

        try:
            if isinstance(parsed_obj, _DecideSchema):
                decision = bool(parsed_obj.result)
            else:
                decision = bool(_validate_and_parse_output(raw_text, fmt="bool"))
            if trace is not None:
                trace.store_claimed("decide", claimed_hash, claimed_occ, decision)
            return decision
        except (ValidationError, ValueError, json.JSONDecodeError) as val_exc:
            if repair_attempt < retries:
                repair_attempt += 1
                emit_tui_event("retry", {"attempt": repair_attempt, "error": str(val_exc)})
                if isinstance(conversation, str):
                    conversation = [{"role": "user", "content": conversation}]
                else:
                    conversation = list(conversation)
                conversation.append({"role": "assistant", "content": raw_text})
                conversation.append(
                    {
                        "role": "user",
                        "content": 'Please respond strictly with {"result": true} or {"result": false}.',
                    }
                )
                continue
            raise SPL2RuntimeError(
                f"Failed to parse boolean decision after {repair_attempt} retries: {val_exc}",
                lineno=__lineno__,
            ) from val_exc


async def decide_async(
    prompt: Any,
    *,
    data: Any = None,
    len: str | None = None,
    fmt: str = "bool",
    schema: Any = None,
    tokens: int | None = None,
    retries: int = 0,
    thinking: str | None = None,
    files: str | Path | Sequence[str | Path] | None = None,
    model: str | None = None,
    __lineno__: int = 1,
) -> bool:
    """Asynchronous `decide` evaluation returning a Python `bool`."""
    full_prompt = _format_decide_prompt(prompt, data=data)
    resolved_model = resolve_model(model)
    text_blocks, attachment_blocks, files_meta = _resolve_files(files, lineno=__lineno__)

    trace = get_active_trace()
    trace_payload = _make_trace_payload(
        kind="decide",
        prompt_str=full_prompt,
        model=resolved_model,
        len_mod=len,
        fmt="bool",
        schema=None,
        tokens=tokens,
        thinking=thinking,
        files_meta=files_meta,
        extra={"data": to_json_compatible(data)},
    )
    claimed_hash = ""
    claimed_occ = 0
    if trace is not None:
        claimed_hash, claimed_occ, hit, cached = trace.claim_occurrence("decide", trace_payload)
        if hit:
            res_bool = bool(cached)
            emit_tui_event("prompt", {"kind": "decide (replay)", "model": resolved_model, "prompt": full_prompt})
            emit_tui_event("response", {"text": res_bool})
            return res_bool

    instructions = _build_system_instructions(kind="decide", len_mod=len, fmt_mod="bool")
    user_input = _build_user_input(full_prompt, text_blocks, attachment_blocks)

    logger.debug("SPL2 async decide [model=%s]\n%s", resolved_model, full_prompt)
    emit_tui_event("prompt", {"kind": "await decide", "model": resolved_model, "prompt": full_prompt})

    client = _get_async_client()
    conversation: list[dict[str, Any]] | str = user_input
    repair_attempt = 0

    while True:
        try:
            resp = await _invoke_responses_async(
                client,
                model=resolved_model,
                instructions=instructions,
                input_payload=conversation,
                tokens=tokens,
                thinking=thinking,
                schema=_DecideSchema,
                tools=None,
                retries=retries,
            )
        except BaseException as exc:
            raise SPL2RuntimeError(f"LLM call failed in async decide: {exc}", lineno=__lineno__) from exc

        raw_text, reasoning_list, _, parsed_obj = _extract_response_data(resp)
        _emit_reasoning_if_needed(resp, reasoning_list)

        emit_tui_event("response", {"text": raw_text})

        try:
            if isinstance(parsed_obj, _DecideSchema):
                decision = bool(parsed_obj.result)
            else:
                decision = bool(_validate_and_parse_output(raw_text, fmt="bool"))
            if trace is not None:
                trace.store_claimed("decide", claimed_hash, claimed_occ, decision)
            return decision
        except (ValidationError, ValueError, json.JSONDecodeError) as val_exc:
            if repair_attempt < retries:
                repair_attempt += 1
                emit_tui_event("retry", {"attempt": repair_attempt, "error": str(val_exc)})
                if isinstance(conversation, str):
                    conversation = [{"role": "user", "content": conversation}]
                else:
                    conversation = list(conversation)
                conversation.append({"role": "assistant", "content": raw_text})
                conversation.append(
                    {
                        "role": "user",
                        "content": 'Please respond strictly with {"result": true} or {"result": false}.',
                    }
                )
                continue
            raise SPL2RuntimeError(
                f"Failed to parse boolean decision after {repair_attempt} retries: {val_exc}",
                lineno=__lineno__,
            ) from val_exc


def _prepare_agent_tools(
    tools_mod: Any, mcp_mod: Any
) -> tuple[list[dict[str, Any]], dict[str, MCPToolSpec], list[str]]:
    """Build OpenAI tool schemas and MCP lookup table for an `agent` call."""
    enabled_builtins = resolve_enabled_builtin_tools(tools_mod)
    openai_tools: list[dict[str, Any]] = [
        BUILTIN_TOOL_SCHEMAS[name] for name in enabled_builtins
    ]
    mcp_map: dict[str, MCPToolSpec] = {}
    mcp_mgr = _mcp_manager_var.get()
    if mcp_mgr is not None:
        for spec in mcp_mgr.get_allowed_tools(mcp_mod):
            openai_tools.append(spec.to_openai_schema())
            mcp_map[spec.openai_tool_name] = spec
            mcp_map[spec.qualified_name] = spec
            mcp_map[spec.name] = spec
    return openai_tools, mcp_map, enabled_builtins


def _dispatch_agent_tool_call(
    call_name: str,
    raw_arguments: str,
    enabled_builtins: list[str],
    mcp_map: dict[str, MCPToolSpec],
) -> Any:
    """Execute a built-in or MCP tool invoked by the agent."""
    try:
        args = json.loads(raw_arguments) if raw_arguments else {}
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON arguments for tool '{call_name}': {raw_arguments}") from exc

    if call_name in enabled_builtins:
        return execute_builtin_tool(call_name, args)

    if call_name in mcp_map:
        spec = mcp_map[call_name]
        mcp_mgr = _mcp_manager_var.get()
        if mcp_mgr is None:
            raise RuntimeError(f"MCP manager is not configured for tool '{call_name}'.")
        return mcp_mgr.call_tool(spec.server, spec.name, args)

    raise ValueError(f"Tool '{call_name}' is not enabled or unknown.")


def agent_sync(
    prompt: Any,
    *,
    len: str | None = None,
    fmt: str = "text",
    schema: Any = None,
    tokens: int | None = None,
    retries: int = 0,
    thinking: str | None = None,
    files: str | Path | Sequence[str | Path] | None = None,
    model: str | None = None,
    tools: Any = None,
    mcp: Any = None,
    max_steps: int = 25,
    __lineno__: int = 1,
) -> Any:
    """Synchronous `agent` autonomous tool-calling loop with built-in tools, MCP, and crash-recoverable trace replay."""
    prompt_str = str(prompt)
    resolved_model = resolve_model(model)
    text_blocks, attachment_blocks, files_meta = _resolve_files(files, lineno=__lineno__)
    openai_tools, mcp_map, enabled_builtins = _prepare_agent_tools(tools, mcp)

    trace = get_active_trace()
    trace_payload = _make_trace_payload(
        kind="agent",
        prompt_str=prompt_str,
        model=resolved_model,
        len_mod=len,
        fmt=fmt,
        schema=schema,
        tokens=tokens,
        thinking=thinking,
        files_meta=files_meta,
        extra={
            "tools": enabled_builtins,
            "mcp": sorted({spec.qualified_name for spec in mcp_map.values()}),
            "max_steps": max_steps,
        },
    )
    claimed_hash = ""
    claimed_occ = 0
    if trace is not None:
        claimed_hash, claimed_occ, hit, cached = trace.claim_occurrence("agent", trace_payload)
        if hit:
            # Completed agent call replays its final output atomically (skipping internal tool executions)
            val = _rehydrate_cached_value(cached, schema=schema, fmt=fmt)
            emit_tui_event("prompt", {"kind": "agent (replay)", "model": resolved_model, "prompt": prompt_str})
            emit_tui_event("response", {"text": to_json_compatible(val)})
            return val

    parent_agent_key = f"{claimed_hash}:{claimed_occ}"
    instructions = _build_system_instructions(
        kind="agent", len_mod=len, fmt_mod=fmt, schema_mod=schema
    )
    initial_input = _build_user_input(prompt_str, text_blocks, attachment_blocks)
    if isinstance(initial_input, str):
        conversation: list[dict[str, Any]] = [{"role": "user", "content": initial_input}]
    else:
        conversation = list(initial_input)

    logger.debug(
        "SPL2 agent start [model=%s, max_steps=%d, tools=%s]",
        resolved_model,
        max_steps,
        enabled_builtins,
    )
    emit_tui_event("prompt", {"kind": "agent", "model": resolved_model, "prompt": prompt_str})

    client = _get_sync_client()
    repair_attempt = 0

    with agent_loop_context():
        for step_idx in range(max_steps):
            emit_tui_event("step", {"step": step_idx + 1, "max_steps": max_steps})
            step_payload = {
                "parent_agent_key": parent_agent_key,
                "step_index": step_idx,
                "conversation": to_json_compatible(conversation),
            }

            step_hit = False
            step_cached: dict[str, Any] | None = None
            if trace is not None:
                step_hit, step_cached = trace.lookup_agent_step(
                    parent_agent_key, step_idx, step_payload
                )

            if step_hit and step_cached is not None:
                raw_text = step_cached.get("raw_text", "")
                tool_calls = step_cached.get("tool_calls", [])
                tool_outputs = step_cached.get("tool_outputs", [])
                parsed_obj = None
                if tool_calls:
                    for tc, tout in zip(tool_calls, tool_outputs):
                        conversation.append(
                            {
                                "type": "function_call",
                                "call_id": tc["call_id"],
                                "name": tc["name"],
                                "arguments": tc["arguments"],
                            }
                        )
                        conversation.append(
                            {
                                "type": "function_call_output",
                                "call_id": tc["call_id"],
                                "output": tout["output"],
                            }
                        )
                    continue
            else:
                try:
                    resp = _invoke_responses_sync(
                        client,
                        model=resolved_model,
                        instructions=instructions,
                        input_payload=conversation,
                        tokens=tokens,
                        thinking=thinking,
                        schema=schema if not openai_tools else None,
                        tools=openai_tools,
                        retries=retries,
                    )
                except BaseException as exc:
                    raise SPL2RuntimeError(
                        f"LLM call failed in agent (step {step_idx + 1}): {exc}",
                        lineno=__lineno__,
                    ) from exc

                raw_text, reasoning_list, tool_calls, parsed_obj = _extract_response_data(resp)
                _emit_reasoning_if_needed(resp, reasoning_list, step_idx=step_idx + 1)

                if tool_calls:
                    tool_outputs = []
                    for tc in tool_calls:
                        try:
                            tool_res = _dispatch_agent_tool_call(
                                tc["name"],
                                tc["arguments"],
                                enabled_builtins,
                                mcp_map,
                            )
                        except BaseException as tool_exc:
                            raise SPL2RuntimeError(
                                f"Agent tool '{tc['name']}' failed: {tool_exc}",
                                lineno=__lineno__,
                            ) from tool_exc

                        out_str = (
                            tool_res
                            if isinstance(tool_res, str)
                            else json.dumps(to_json_compatible(tool_res), ensure_ascii=False)
                        )
                        tool_outputs.append({"call_id": tc["call_id"], "output": out_str})

                    if trace is not None:
                        trace.record_agent_step(
                            parent_agent_key,
                            step_idx,
                            step_payload,
                            {
                                "raw_text": raw_text,
                                "tool_calls": tool_calls,
                                "tool_outputs": tool_outputs,
                            },
                        )

                    for tc, tout in zip(tool_calls, tool_outputs):
                        conversation.append(
                            {
                                "type": "function_call",
                                "call_id": tc["call_id"],
                                "name": tc["name"],
                                "arguments": tc["arguments"],
                            }
                        )
                        conversation.append(
                            {
                                "type": "function_call_output",
                                "call_id": tc["call_id"],
                                "output": tout["output"],
                            }
                        )
                    continue

            # No tool calls -> final answer turn
            logger.debug("SPL2 agent final response: %s", raw_text)
            emit_tui_event("response", {"text": raw_text})
            try:
                validated = _validate_and_parse_output(
                    raw_text, fmt=fmt, schema=schema, parsed_obj=parsed_obj
                )
                if trace is not None:
                    trace.store_claimed(
                        "agent",
                        claimed_hash,
                        claimed_occ,
                        to_json_compatible(validated),
                    )
                return validated
            except (ValidationError, ValueError, json.JSONDecodeError) as val_exc:
                if repair_attempt < retries:
                    repair_attempt += 1
                    logger.debug(
                        "Agent output validation failed (attempt %d/%d): %s — performing self-repair",
                        repair_attempt,
                        retries,
                        val_exc,
                    )
                    emit_tui_event(
                        "retry", {"attempt": repair_attempt, "error": str(val_exc)}
                    )
                    conversation.append({"role": "assistant", "content": raw_text})
                    conversation.append(
                        {
                            "role": "user",
                            "content": (
                                f"Your final response failed output validation with the following error:\n{val_exc}\n\n"
                                "Please provide the corrected final response strictly matching the required format/schema."
                            ),
                        }
                    )
                    continue
                raise SPL2RuntimeError(
                    f"Agent output validation failed after {repair_attempt} retries: {val_exc}",
                    lineno=__lineno__,
                ) from val_exc

    raise SPL2RuntimeError(
        f"Agent exceeded max_steps ({max_steps}) without completing.",
        lineno=__lineno__,
    )


async def agent_async(
    prompt: Any,
    *,
    len: str | None = None,
    fmt: str = "text",
    schema: Any = None,
    tokens: int | None = None,
    retries: int = 0,
    thinking: str | None = None,
    files: str | Path | Sequence[str | Path] | None = None,
    model: str | None = None,
    tools: Any = None,
    mcp: Any = None,
    max_steps: int = 25,
    __lineno__: int = 1,
) -> Any:
    """Asynchronous `agent` autonomous tool-calling loop using `AsyncOpenAI`."""
    prompt_str = str(prompt)
    resolved_model = resolve_model(model)
    text_blocks, attachment_blocks, files_meta = _resolve_files(files, lineno=__lineno__)
    openai_tools, mcp_map, enabled_builtins = _prepare_agent_tools(tools, mcp)

    trace = get_active_trace()
    trace_payload = _make_trace_payload(
        kind="agent",
        prompt_str=prompt_str,
        model=resolved_model,
        len_mod=len,
        fmt=fmt,
        schema=schema,
        tokens=tokens,
        thinking=thinking,
        files_meta=files_meta,
        extra={
            "tools": enabled_builtins,
            "mcp": sorted({spec.qualified_name for spec in mcp_map.values()}),
            "max_steps": max_steps,
        },
    )
    claimed_hash = ""
    claimed_occ = 0
    if trace is not None:
        claimed_hash, claimed_occ, hit, cached = trace.claim_occurrence("agent", trace_payload)
        if hit:
            val = _rehydrate_cached_value(cached, schema=schema, fmt=fmt)
            emit_tui_event("prompt", {"kind": "agent (replay)", "model": resolved_model, "prompt": prompt_str})
            emit_tui_event("response", {"text": to_json_compatible(val)})
            return val

    parent_agent_key = f"{claimed_hash}:{claimed_occ}"
    instructions = _build_system_instructions(
        kind="agent", len_mod=len, fmt_mod=fmt, schema_mod=schema
    )
    initial_input = _build_user_input(prompt_str, text_blocks, attachment_blocks)
    if isinstance(initial_input, str):
        conversation: list[dict[str, Any]] = [{"role": "user", "content": initial_input}]
    else:
        conversation = list(initial_input)

    emit_tui_event("prompt", {"kind": "await agent", "model": resolved_model, "prompt": prompt_str})
    client = _get_async_client()
    repair_attempt = 0

    with agent_loop_context():
        for step_idx in range(max_steps):
            emit_tui_event("step", {"step": step_idx + 1, "max_steps": max_steps})
            step_payload = {
                "parent_agent_key": parent_agent_key,
                "step_index": step_idx,
                "conversation": to_json_compatible(conversation),
            }

            step_hit = False
            step_cached: dict[str, Any] | None = None
            if trace is not None:
                step_hit, step_cached = trace.lookup_agent_step(
                    parent_agent_key, step_idx, step_payload
                )

            if step_hit and step_cached is not None:
                raw_text = step_cached.get("raw_text", "")
                tool_calls = step_cached.get("tool_calls", [])
                tool_outputs = step_cached.get("tool_outputs", [])
                parsed_obj = None
                if tool_calls:
                    for tc, tout in zip(tool_calls, tool_outputs):
                        conversation.append(
                            {
                                "type": "function_call",
                                "call_id": tc["call_id"],
                                "name": tc["name"],
                                "arguments": tc["arguments"],
                            }
                        )
                        conversation.append(
                            {
                                "type": "function_call_output",
                                "call_id": tc["call_id"],
                                "output": tout["output"],
                            }
                        )
                    continue
            else:
                try:
                    resp = await _invoke_responses_async(
                        client,
                        model=resolved_model,
                        instructions=instructions,
                        input_payload=conversation,
                        tokens=tokens,
                        thinking=thinking,
                        schema=schema if not openai_tools else None,
                        tools=openai_tools,
                        retries=retries,
                    )
                except BaseException as exc:
                    raise SPL2RuntimeError(
                        f"LLM call failed in async agent (step {step_idx + 1}): {exc}",
                        lineno=__lineno__,
                    ) from exc

                raw_text, reasoning_list, tool_calls, parsed_obj = _extract_response_data(resp)
                _emit_reasoning_if_needed(resp, reasoning_list, step_idx=step_idx + 1)

                if tool_calls:
                    tool_outputs = []
                    for tc in tool_calls:
                        try:
                            tool_res = _dispatch_agent_tool_call(
                                tc["name"],
                                tc["arguments"],
                                enabled_builtins,
                                mcp_map,
                            )
                        except BaseException as tool_exc:
                            raise SPL2RuntimeError(
                                f"Agent tool '{tc['name']}' failed: {tool_exc}",
                                lineno=__lineno__,
                            ) from tool_exc

                        out_str = (
                            tool_res
                            if isinstance(tool_res, str)
                            else json.dumps(to_json_compatible(tool_res), ensure_ascii=False)
                        )
                        tool_outputs.append({"call_id": tc["call_id"], "output": out_str})

                    if trace is not None:
                        trace.record_agent_step(
                            parent_agent_key,
                            step_idx,
                            step_payload,
                            {
                                "raw_text": raw_text,
                                "tool_calls": tool_calls,
                                "tool_outputs": tool_outputs,
                            },
                        )

                    for tc, tout in zip(tool_calls, tool_outputs):
                        conversation.append(
                            {
                                "type": "function_call",
                                "call_id": tc["call_id"],
                                "name": tc["name"],
                                "arguments": tc["arguments"],
                            }
                        )
                        conversation.append(
                            {
                                "type": "function_call_output",
                                "call_id": tc["call_id"],
                                "output": tout["output"],
                            }
                        )
                    continue

            emit_tui_event("response", {"text": raw_text})
            try:
                validated = _validate_and_parse_output(
                    raw_text, fmt=fmt, schema=schema, parsed_obj=parsed_obj
                )
                if trace is not None:
                    trace.store_claimed(
                        "agent",
                        claimed_hash,
                        claimed_occ,
                        to_json_compatible(validated),
                    )
                return validated
            except (ValidationError, ValueError, json.JSONDecodeError) as val_exc:
                if repair_attempt < retries:
                    repair_attempt += 1
                    emit_tui_event(
                        "retry", {"attempt": repair_attempt, "error": str(val_exc)}
                    )
                    conversation.append({"role": "assistant", "content": raw_text})
                    conversation.append(
                        {
                            "role": "user",
                            "content": (
                                f"Your final response failed output validation with the following error:\n{val_exc}\n\n"
                                "Please provide the corrected final response strictly matching the required format/schema."
                            ),
                        }
                    )
                    continue
                raise SPL2RuntimeError(
                    f"Agent output validation failed after {repair_attempt} retries: {val_exc}",
                    lineno=__lineno__,
                ) from val_exc

    raise SPL2RuntimeError(
        f"Agent exceeded max_steps ({max_steps}) without completing.",
        lineno=__lineno__,
    )


# Helpers for `--emit-py` transpiled Python code where `__spl2_prompt__` is passed as keyword arg
def _emit_py_ask(*, __spl2_prompt__: Any = "", **kwargs: Any) -> Any:
    return ask_sync(__spl2_prompt__, **kwargs)


async def _emit_py_async_ask(*, __spl2_prompt__: Any = "", **kwargs: Any) -> Any:
    return await ask_async(__spl2_prompt__, **kwargs)


def _emit_py_agent(*, __spl2_prompt__: Any = "", **kwargs: Any) -> Any:
    return agent_sync(__spl2_prompt__, **kwargs)


async def _emit_py_async_agent(*, __spl2_prompt__: Any = "", **kwargs: Any) -> Any:
    return await agent_async(__spl2_prompt__, **kwargs)


def _emit_py_decide(*, __spl2_prompt__: Any = "", **kwargs: Any) -> bool:
    return decide_sync(__spl2_prompt__, **kwargs)


async def _emit_py_async_decide(*, __spl2_prompt__: Any = "", **kwargs: Any) -> bool:
    return await decide_async(__spl2_prompt__, **kwargs)


@contextmanager
def _redirect_print_to_stderr() -> Iterator[None]:
    """Route standard Python `print()` calls (when `file=` is not specified) to `sys.stderr`."""
    orig_print = builtins.print

    def _spl2_print(*args: Any, **kwargs: Any) -> None:
        if "file" not in kwargs or kwargs["file"] is None:
            kwargs["file"] = sys.stderr
        msg = kwargs.get("sep", " ").join(str(a) for a in args)
        emit_tui_event("log", {"message": msg})
        orig_print(*args, **kwargs)

    builtins.print = _spl2_print
    try:
        yield
    finally:
        builtins.print = orig_print


def _extract_exception_lineno(exc: BaseException, target_filename: str, default_lineno: int) -> int:
    """Find the originating line number in `target_filename` from an exception's traceback."""
    if isinstance(exc, SPL2RuntimeError) and exc.lineno is not None:
        return exc.lineno
    if isinstance(exc, SPL2SyntaxError):
        return exc.lineno

    tb = exc.__traceback__
    matched_lineno: int | None = None
    last_lineno: int | None = None
    norm_target = os.path.normcase(os.path.abspath(target_filename)) if target_filename != "<spl2>" else "<spl2>"

    for frame_summary in traceback.extract_tb(tb):
        if frame_summary.lineno:
            last_lineno = frame_summary.lineno
            fn = frame_summary.filename
            norm_fn = os.path.normcase(os.path.abspath(fn)) if fn != "<spl2>" else "<spl2>"
            if norm_fn == norm_target or fn == target_filename:
                matched_lineno = frame_summary.lineno

    return matched_lineno or last_lineno or default_lineno


def run_spl2_source(
    source: str,
    *,
    filename: str = "<spl2>",
    script_args: list[str] | None = None,
    model: str | None = None,
    mcp_config_path: str | Path | None = None,
    trace_path: str | Path | None = None,
) -> tuple[dict[str, Any], int]:
    """Compile and execute SPL2 source code, returning `(envelope_dict, exit_code)`."""
    lines = source.splitlines()
    last_lineno = max(1, len(lines))

    try:
        code_obj = compile_spl2(source, filename=filename)
    except SPL2SyntaxError as syn_exc:
        print(str(syn_exc), file=sys.stderr)
        envelope = {
            "status": "failure",
            "reason": str(syn_exc),
            "lineno": syn_exc.lineno,
            "data": None,
        }
        return envelope, 1

    install_import_hook()
    script_dir = str(Path(filename).resolve().parent) if filename != "<spl2>" else os.getcwd()
    mcp_mgr = MCPManager.from_config_file(mcp_config_path, cwd=script_dir)
    trace_mgr = TraceManager(trace_path) if trace_path is not None else None

    model_token = _cli_model_var.set(model)
    mcp_token = _mcp_manager_var.set(mcp_mgr)

    import types

    saved_argv = list(sys.argv)
    saved_path = list(sys.path)
    saved_main_mod = sys.modules.get("__main__")
    if script_args is not None:
        sys.argv = [filename, *script_args]
    if script_dir not in sys.path:
        sys.path.insert(0, script_dir)

    main_mod = types.ModuleType("__main__")
    main_mod.__file__ = filename
    main_mod.__package__ = None
    main_mod.__builtins__ = builtins
    sys.modules["__main__"] = main_mod
    globals_dict = main_mod.__dict__

    try:
        with trace_context(trace_mgr), _redirect_print_to_stderr():
            exec(code_obj, globals_dict)
    except SPL2SuccessException as succ:
        envelope = {
            "status": "ok",
            "reason": None,
            "lineno": succ.lineno,
            "data": succ.data,
        }
        return envelope, 0
    except SPL2FailureException as fail:
        envelope = {
            "status": "failure",
            "reason": fail.reason,
            "lineno": fail.lineno,
            "data": None,
        }
        return envelope, 1
    except BaseException as exc:
        err_lineno = _extract_exception_lineno(exc, filename, last_lineno)
        reason_msg = f"{type(exc).__name__}: {exc}" if not isinstance(exc, SPL2RuntimeError) else str(exc)
        envelope = {
            "status": "failure",
            "reason": reason_msg,
            "lineno": err_lineno,
            "data": None,
        }
        return envelope, 1
    finally:
        mcp_mgr.close_all()
        _cli_model_var.reset(model_token)
        _mcp_manager_var.reset(mcp_token)
        if saved_main_mod is not None:
            sys.modules["__main__"] = saved_main_mod
        sys.argv = saved_argv
        sys.path = saved_path

    # Implicit EOF
    envelope = {
        "status": "ok",
        "reason": None,
        "lineno": last_lineno,
        "data": None,
    }
    return envelope, 0


def run_spl2_file(
    script_path: str | Path,
    *,
    script_args: list[str] | None = None,
    model: str | None = None,
    mcp_config_path: str | Path | None = None,
    trace_path: str | Path | None = None,
) -> tuple[dict[str, Any], int]:
    """Read and execute a `.spl2` file, returning `(envelope_dict, exit_code)`."""
    path_obj = Path(script_path)
    if not path_obj.is_file():
        envelope = {
            "status": "failure",
            "reason": f"Script file not found: {script_path}",
            "lineno": 1,
            "data": None,
        }
        return envelope, 1
    source = path_obj.read_text(encoding="utf-8")
    return run_spl2_source(
        source,
        filename=str(path_obj),
        script_args=script_args,
        model=model,
        mcp_config_path=mcp_config_path,
        trace_path=trace_path,
    )
