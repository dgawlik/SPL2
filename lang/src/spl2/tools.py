"""Built-in SPL2 tools (`read_file`, `write_file`, `shell`, `web_fetch`, `web_search`)."""

from __future__ import annotations

import html
import json
import logging
import os
import re
import subprocess
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable, Sequence

from .context import get_active_restrict, get_context_snapshot

logger = logging.getLogger("spl2")

DEFAULT_SEARCH_URL = "https://html.duckduckgo.com/html/"


def _notify_tool_event(tool_name: str, args: dict[str, Any], result: Any = None, phase: str = "start") -> None:
    """Log tool calls at DEBUG level and forward to the realtime TUI if active."""
    from .tui import emit_tui_event

    if phase == "start":
        logger.debug("Tool call: %s(%s)", tool_name, json.dumps(args, default=str))
        emit_tui_event("tool_start", {"name": tool_name, "args": args})
    else:
        preview = str(result)
        if len(preview) > 500:
            preview = preview[:500] + "..."
        logger.debug("Tool result [%s]: %s", tool_name, preview)
        emit_tui_event("tool_end", {"name": tool_name, "args": args, "result": result})


def read_file(path: str | Path) -> str:
    """Read UTF-8 file contents from the workspace, enforcing active `restrict(fs=...)` policies."""
    from .trace import get_active_trace, is_inside_agent_loop

    path_str = str(path)
    resolved = get_active_restrict().check_fs(path_str)
    trace = get_active_trace()
    if trace is not None and not is_inside_agent_loop():
        hit, cached = trace.lookup(
            kind="tool:read_file",
            payload={"path": path_str, "context": get_context_snapshot()},
        )
        if hit:
            _notify_tool_event("read_file", {"path": path_str}, cached, phase="end")
            return str(cached)

    _notify_tool_event("read_file", {"path": path_str}, phase="start")
    content = resolved.read_text(encoding="utf-8")
    _notify_tool_event("read_file", {"path": path_str}, content, phase="end")

    if trace is not None and not is_inside_agent_loop():
        trace.record(
            kind="tool:read_file",
            payload={"path": path_str, "context": get_context_snapshot()},
            result=content,
        )
    return content


def write_file(path: str | Path, content: str) -> str:
    """Write UTF-8 content to a file, creating parent directories as needed, enforcing `restrict(fs=...)`."""
    from .trace import get_active_trace, is_inside_agent_loop

    path_str = str(path)
    resolved = get_active_restrict().check_fs(path_str)
    trace = get_active_trace()
    if trace is not None and not is_inside_agent_loop():
        hit, cached = trace.lookup(
            kind="tool:write_file",
            payload={"path": path_str, "content": content, "context": get_context_snapshot()},
        )
        if hit:
            _notify_tool_event("write_file", {"path": path_str}, cached, phase="end")
            return str(cached)

    _notify_tool_event("write_file", {"path": path_str, "bytes": len(content.encode("utf-8"))}, phase="start")
    resolved.parent.mkdir(parents=True, exist_ok=True)
    resolved.write_text(content, encoding="utf-8")
    out = f"Wrote {len(content)} characters to {path_str}"
    _notify_tool_event("write_file", {"path": path_str}, out, phase="end")

    if trace is not None and not is_inside_agent_loop():
        trace.record(
            kind="tool:write_file",
            payload={"path": path_str, "content": content, "context": get_context_snapshot()},
            result=out,
        )
    return out


def shell(command: str) -> str:
    """Execute a shell command in the platform default shell, returning combined stdout/stderr."""
    from .trace import get_active_trace, is_inside_agent_loop

    get_active_restrict().check_exec(command)
    trace = get_active_trace()
    if trace is not None and not is_inside_agent_loop():
        hit, cached = trace.lookup(
            kind="tool:shell",
            payload={"command": command, "context": get_context_snapshot()},
        )
        if hit:
            _notify_tool_event("shell", {"command": command}, cached, phase="end")
            return str(cached)

    _notify_tool_event("shell", {"command": command}, phase="start")
    completed = subprocess.run(
        command,
        shell=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    output = completed.stdout or ""
    _notify_tool_event("shell", {"command": command, "returncode": completed.returncode}, output, phase="end")

    if trace is not None and not is_inside_agent_loop():
        trace.record(
            kind="tool:shell",
            payload={"command": command, "context": get_context_snapshot()},
            result=output,
        )
    return output


def web_fetch(url: str) -> str:
    """Fetch HTTP(S) content from a URL, enforcing active `restrict(net=...)` policies."""
    from .trace import get_active_trace, is_inside_agent_loop

    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError(f"Unsupported URL scheme in web_fetch: {url!r} (only http and https are allowed)")
    get_active_restrict().check_net(url)

    trace = get_active_trace()
    if trace is not None and not is_inside_agent_loop():
        hit, cached = trace.lookup(
            kind="tool:web_fetch",
            payload={"url": url, "context": get_context_snapshot()},
        )
        if hit:
            _notify_tool_event("web_fetch", {"url": url}, cached, phase="end")
            return str(cached)

    _notify_tool_event("web_fetch", {"url": url}, phase="start")
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "SPL2-Runtime/2.0 (+https://github.com/dgawlik/semantic-prompt-language)"
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read()
        charset = resp.headers.get_content_charset() or "utf-8"
        text = raw.decode(charset, errors="replace")

    _notify_tool_event("web_fetch", {"url": url}, text, phase="end")
    if trace is not None and not is_inside_agent_loop():
        trace.record(
            kind="tool:web_fetch",
            payload={"url": url, "context": get_context_snapshot()},
            result=text,
        )
    return text


def _strip_html_tags(raw_html: str) -> str:
    cleaned = re.sub(r"<[^>]+>", "", raw_html)
    return html.unescape(cleaned).strip()


def _parse_ddg_html(page_html: str, max_results: int = 8) -> list[dict[str, str]]:
    """Parse DuckDuckGo HTML search results into a list of {title, url, snippet} dicts."""
    results: list[dict[str, str]] = []
    # Match result__a links and result__snippet blocks
    link_pattern = re.compile(
        r'<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>(.*?)</a>',
        re.IGNORECASE | re.DOTALL,
    )
    snippet_pattern = re.compile(
        r'<(?:a|div|span)[^>]*class="[^"]*result__snippet[^"]*"[^>]*>(.*?)</(?:a|div|span)>',
        re.IGNORECASE | re.DOTALL,
    )
    links = link_pattern.findall(page_html)
    snippets = snippet_pattern.findall(page_html)

    for idx, (href, raw_title) in enumerate(links[:max_results]):
        url = html.unescape(href)
        # Unwrap DuckDuckGo uddg redirect URL if present
        if "uddg=" in url:
            parsed_qs = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
            if "uddg" in parsed_qs and parsed_qs["uddg"]:
                url = parsed_qs["uddg"][0]
        title = _strip_html_tags(raw_title)
        snippet = _strip_html_tags(snippets[idx]) if idx < len(snippets) else ""
        if title or url:
            results.append({"title": title, "url": url, "snippet": snippet})
    return results


def web_search(query: str) -> list[dict[str, str]]:
    """Perform a zero-config web search via DuckDuckGo HTML endpoint (`SPL2_SEARCH_URL`).

    Returns top titles, URLs, and snippets as a list of dicts.
    """
    from .trace import get_active_trace, is_inside_agent_loop

    search_base = os.environ.get("SPL2_SEARCH_URL", DEFAULT_SEARCH_URL)
    get_active_restrict().check_net(search_base)

    trace = get_active_trace()
    if trace is not None and not is_inside_agent_loop():
        hit, cached = trace.lookup(
            kind="tool:web_search",
            payload={"query": query, "search_url": search_base, "context": get_context_snapshot()},
        )
        if hit and isinstance(cached, list):
            _notify_tool_event("web_search", {"query": query}, cached, phase="end")
            return cached

    _notify_tool_event("web_search", {"query": query, "endpoint": search_base}, phase="start")
    sep = "&" if "?" in search_base else "?"
    full_url = f"{search_base}{sep}{urllib.parse.urlencode({'q': query})}"
    req = urllib.request.Request(
        full_url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SPL2/2.0",
            "Accept": "text/html,application/xhtml+xml",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw_html = resp.read().decode("utf-8", errors="replace")

    results = _parse_ddg_html(raw_html)
    _notify_tool_event("web_search", {"query": query}, results, phase="end")

    if trace is not None and not is_inside_agent_loop():
        trace.record(
            kind="tool:web_search",
            payload={"query": query, "search_url": search_base, "context": get_context_snapshot()},
            result=results,
        )
    return results


BUILTIN_TOOLS: dict[str, Callable[..., Any]] = {
    "read_file": read_file,
    "write_file": write_file,
    "shell": shell,
    "web_fetch": web_fetch,
    "web_search": web_search,
}

BUILTIN_TOOL_SCHEMAS: dict[str, dict[str, Any]] = {
    "read_file": {
        "type": "function",
        "name": "read_file",
        "description": "Reads UTF-8 file contents from the workspace.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "File path to read."}
            },
            "required": ["path"],
            "additionalProperties": False,
        },
    },
    "write_file": {
        "type": "function",
        "name": "write_file",
        "description": "Writes UTF-8 content to a file, creating parent directories as needed.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "File path to write."},
                "content": {"type": "string", "description": "UTF-8 text content to write."},
            },
            "required": ["path", "content"],
            "additionalProperties": False,
        },
    },
    "shell": {
        "type": "function",
        "name": "shell",
        "description": "Executes a shell command in the platform default shell, returning combined stdout/stderr.",
        "parameters": {
            "type": "object",
            "properties": {
                "command": {"type": "string", "description": "Shell command to execute."}
            },
            "required": ["command"],
            "additionalProperties": False,
        },
    },
    "web_fetch": {
        "type": "function",
        "name": "web_fetch",
        "description": "Fetches HTTP(S) content from a URL.",
        "parameters": {
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "HTTP(S) URL to fetch."}
            },
            "required": ["url"],
            "additionalProperties": False,
        },
    },
    "web_search": {
        "type": "function",
        "name": "web_search",
        "description": "Performs a web search using DuckDuckGo HTML endpoint and returns top titles, URLs, and snippets.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query string."}
            },
            "required": ["query"],
            "additionalProperties": False,
        },
    },
}


def resolve_enabled_builtin_tools(
    tools_modifier: str | Sequence[str | Callable[..., Any]] | None
) -> list[str]:
    """Return list of enabled built-in tool names based on `agent(tools=...)` modifier."""
    if tools_modifier is None:
        return list(BUILTIN_TOOLS.keys())
    if isinstance(tools_modifier, str):
        if not tools_modifier.strip():
            return []
        names = [p.strip() for p in tools_modifier.split(",") if p.strip()]
    else:
        names = []
        for item in tools_modifier:
            if callable(item) and hasattr(item, "__name__"):
                names.append(item.__name__)
            elif isinstance(item, str):
                for p in item.split(","):
                    if p.strip():
                        names.append(p.strip())
            else:
                raise ValueError(f"Invalid tool specification in tools=: {item!r}")

    for name in names:
        if name not in BUILTIN_TOOLS:
            raise ValueError(
                f"Unknown built-in tool '{name}'. Available built-in tools: {', '.join(BUILTIN_TOOLS.keys())}."
            )
    return names


def execute_builtin_tool(name: str, arguments: dict[str, Any]) -> Any:
    """Invoke a built-in tool by name with JSON-parsed arguments."""
    if name not in BUILTIN_TOOLS:
        raise ValueError(f"Unknown built-in tool: {name}")
    fn = BUILTIN_TOOLS[name]
    if name == "read_file":
        return fn(arguments["path"])
    if name == "write_file":
        return fn(arguments["path"], arguments["content"])
    if name == "shell":
        return fn(arguments["command"])
    if name == "web_fetch":
        return fn(arguments["url"])
    if name == "web_search":
        return fn(arguments["query"])
    return fn(**arguments)


__all__ = [
    "read_file",
    "write_file",
    "shell",
    "web_fetch",
    "web_search",
    "BUILTIN_TOOLS",
    "BUILTIN_TOOL_SCHEMAS",
    "resolve_enabled_builtin_tools",
    "execute_builtin_tool",
]
