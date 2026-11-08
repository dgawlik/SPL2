"""Comprehensive test suite for the SPL2 compiler, linter, runtime, tools, MCP, trace, importer, and CLI."""

from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import date
import http.server
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
from types import SimpleNamespace
from typing import Any, Optional

from pydantic import BaseModel, EmailStr, Field
import pytest

from spl2 import (
    RestrictionError,
    SPL2SyntaxError,
    compile_spl2,
    enforce_scope,
    forbid_scope,
    get_active_enforces,
    get_active_forbids,
    get_active_restrict,
    lint_spl2,
    restrict_scope,
    run_spl2_file,
    run_spl2_source,
    transpile_spl2,
)
from spl2.cli import main as cli_main
from spl2.mcp import MCPManager
from spl2.runtime import set_openai_clients
from spl2.tools import read_file, shell, web_fetch, web_search, write_file


# ---------------------------------------------------------------------------
# Helpers for mocking OpenAI Responses API
# ---------------------------------------------------------------------------


def make_mock_response(
    output_text: str = "",
    *,
    parsed: Any = None,
    reasoning: list[str] | None = None,
    tool_calls: list[dict[str, str]] | None = None,
) -> Any:
    output_items: list[Any] = []
    if reasoning:
        output_items.append(
            SimpleNamespace(
                type="reasoning",
                summary=[SimpleNamespace(text=r) for r in reasoning],
            )
        )
    if tool_calls:
        for idx, tc in enumerate(tool_calls):
            output_items.append(
                SimpleNamespace(
                    type="function_call",
                    call_id=tc.get("call_id", f"call_{idx}"),
                    name=tc["name"],
                    arguments=tc.get("arguments", "{}"),
                )
            )
    if output_text or parsed is not None:
        output_items.append(
            SimpleNamespace(
                type="message",
                content=[SimpleNamespace(text=output_text, parsed=parsed)],
            )
        )
    return SimpleNamespace(
        output_text=output_text,
        output_parsed=parsed,
        output=output_items,
    )


class FakeOpenAIClient:
    """Fake sync/async OpenAI client recording all `responses.create` and `responses.parse` calls."""

    def __init__(self, handler) -> None:
        self.calls: list[dict[str, Any]] = []
        self._handler = handler
        self.responses = self

    def create(self, **kwargs: Any) -> Any:
        self.calls.append({"method": "create", **kwargs})
        return self._handler(kwargs)

    def parse(self, **kwargs: Any) -> Any:
        self.calls.append({"method": "parse", **kwargs})
        return self._handler(kwargs)


class FakeAsyncOpenAIClient:
    def __init__(self, handler) -> None:
        self.calls: list[dict[str, Any]] = []
        self._handler = handler
        self.responses = self

    async def create(self, **kwargs: Any) -> Any:
        self.calls.append({"method": "create", **kwargs})
        res = self._handler(kwargs)
        if asyncio.iscoroutine(res):
            return await res
        return res

    async def parse(self, **kwargs: Any) -> Any:
        self.calls.append({"method": "parse", **kwargs})
        res = self._handler(kwargs)
        if asyncio.iscoroutine(res):
            return await res
        return res


@pytest.fixture(autouse=True)
def reset_clients():
    set_openai_clients(None, None)
    yield
    set_openai_clients(None, None)


# ---------------------------------------------------------------------------
# 1. Compile-Time Lint Rules (Rules 1 - 6) & Formatting
# ---------------------------------------------------------------------------


def test_lint_rule1_unknown_modifiers():
    diags = lint_spl2("x = ask(unknown_mod='foo') 'Hello'", filename="test.spl2")
    assert len(diags) == 1
    assert diags[0].rule == "unknown-modifier"
    assert "unknown_mod" in diags[0].message
    formatted = diags[0].format()
    assert "test.spl2:1:" in formatted
    assert "^" in formatted

    diags_r = lint_spl2("restrict(bad_perm='x'):\n    pass\n", filename="test.spl2")
    assert len(diags_r) == 1
    assert diags_r[0].rule == "unknown-modifier"
    assert "bad_perm" in diags_r[0].message


def test_lint_rule2_mutual_exclusion_fmt_and_schema():
    code = "x = ask(fmt='object', schema=dict) 'Prompt'\n"
    diags = lint_spl2(code, filename="mutex.spl2")
    assert len(diags) == 1
    assert diags[0].rule == "mutually-exclusive-modifiers"
    assert "mutually exclusive" in diags[0].message


def test_lint_rule3_literal_values_fmt_and_thinking():
    diags_fmt = lint_spl2("x = ask(fmt='yaml') 'Prompt'\n")
    assert len(diags_fmt) == 1
    assert diags_fmt[0].rule == "invalid-literal-modifier"

    diags_think = lint_spl2("x = agent(thinking='extreme') 'Prompt'\n")
    assert len(diags_think) == 1
    assert diags_think[0].rule == "invalid-literal-modifier"

    # Valid values pass
    assert lint_spl2("x = ask(fmt='float', thinking='high') 'Prompt'\n") == []


def test_lint_rule4_numeric_modifiers_retries_tokens_max_steps():
    assert lint_spl2("x = ask(retries=-1) 'Prompt'\n")[0].rule == "invalid-numeric-modifier"
    assert lint_spl2("x = ask(retries=1.5) 'Prompt'\n")[0].rule == "invalid-numeric-modifier"
    assert lint_spl2("x = ask(retries=True) 'Prompt'\n")[0].rule == "invalid-numeric-modifier"
    assert lint_spl2("x = ask(tokens=0) 'Prompt'\n")[0].rule == "invalid-numeric-modifier"
    assert lint_spl2("x = ask(tokens='100') 'Prompt'\n")[0].rule == "invalid-numeric-modifier"
    assert lint_spl2("x = agent(max_steps=-5) 'Prompt'\n")[0].rule == "invalid-numeric-modifier"
    assert lint_spl2("x = ask(retries=0, tokens=100) 'Prompt'\n") == []


def test_lint_rule5_agent_only_modifiers_on_ask_and_decide():
    for kw in ("ask", "decide"):
        for mod in ("tools=['read_file']", "mcp='srv/*'", "max_steps=5"):
            diags = lint_spl2(f"x = {kw}({mod}) 'Prompt'\n")
            assert len(diags) == 1
            assert diags[0].rule == "agent-only-modifier"
            assert "agent-only" in diags[0].message


def test_lint_rule6_empty_restrict_and_missing_expressions():
    assert lint_spl2("restrict():\n    pass\n")[0].rule == "missing-expression"
    assert lint_spl2("restrict:\n    pass\n")[0].rule == "missing-expression"
    assert lint_spl2("enforce:\n    pass\n")[0].rule == "missing-expression"
    assert lint_spl2("forbid:\n    pass\n")[0].rule == "missing-expression"
    assert lint_spl2("x = ask(fmt='text')\n")[0].rule == "missing-expression"
    assert lint_spl2("x = agent()\n")[0].rule == "missing-expression"
    assert lint_spl2("x = decide(thinking='low')\n")[0].rule == "missing-expression"
    assert lint_spl2("x = ask\n")[0].rule == "missing-expression"


# ---------------------------------------------------------------------------
# 2. Contextual (Soft) Keywords Preservation
# ---------------------------------------------------------------------------


def test_soft_keywords_as_variables_params_and_attributes():
    code = """
def helper(ask, agent=1, decide=True, enforce='yes', forbid='no', restrict=None, success=10, failure=20):
    return ask + agent + (1 if decide else 0) + success - failure

class Holder:
    def __init__(self):
        self.ask = 'attr_ask'
        self.success = True

ask = 5
agent = 6
h = Holder()
val = helper(ask, agent=agent, decide=h.success)
success {'val': val, 'attr': h.ask}
"""
    env, exit_code = run_spl2_source(code)
    assert exit_code == 0
    assert env["status"] == "ok"
    assert env["data"] == {"val": 2, "attr": "attr_ask"}


# ---------------------------------------------------------------------------
# 3. `ask`, `decide`, Pydantic `schema=`, Self-Repair, and `files=`
# ---------------------------------------------------------------------------


def test_mock_conversation_example_stops_after_three_rounds():
    def handler(kwargs):
        assert len(client.calls) <= 6, "Conversation restarted an exhausted generator"
        return make_mock_response(f"message-{len(client.calls)}")

    client = FakeOpenAIClient(handler)
    set_openai_clients(sync_client=client)
    example = Path(__file__).parents[1] / "examples" / "mock_convesation.spl2"
    source = example.read_text(encoding="utf-8")
    env, exit_code = run_spl2_source(
        source + "\nsuccess [(message.sender, message.content) for message in conv.messages]\n",
        filename=str(example),
    )

    assert exit_code == 0, env
    assert env["data"] == [
        [sender, f"message-{idx}"]
        for idx, sender in enumerate(["Alice", "Bob"] * 3, start=1)
    ]
    assert len(client.calls) == 6
    for idx, call in enumerate(client.calls):
        prompt = call["input"]
        for previous in range(1, idx + 1):
            assert f"message-{previous}" in prompt
        assert f"message-{idx + 1}" not in prompt


def test_ask_formats_and_pydantic_schema():
    class Person(BaseModel):
        first_name: str = Field(..., min_length=1, max_length=50)
        last_name: str = Field(..., min_length=1, max_length=50)
        age: int = Field(..., ge=0, le=120)
        email: Optional[EmailStr] = None
        birth_date: date

    def handler(kwargs):
        if kwargs.get("text_format") is not None:
            p = Person(
                first_name="Ada",
                last_name="Lovelace",
                age=36,
                email="ada@example.com",
                birth_date=date(1815, 12, 10),
            )
            return make_mock_response(p.model_dump_json(), parsed=p)
        return make_mock_response('{"count": 42}')

    client = FakeOpenAIClient(handler)
    set_openai_clients(sync_client=client)

    code = """
from datetime import date
from typing import Optional
from pydantic import BaseModel, EmailStr, Field

class Person(BaseModel):
    first_name: str = Field(..., min_length=1, max_length=50)
    last_name: str = Field(..., min_length=1, max_length=50)
    age: int = Field(..., ge=0, le=120)
    email: Optional[EmailStr] = None
    birth_date: date

person = ask(schema=Person, retries=2) 'Generate sample person'
obj = ask(fmt='object') 'Give count'
success {'person': person, 'obj': obj}
"""
    env, exit_code = run_spl2_source(code)
    assert exit_code == 0
    assert env["status"] == "ok"
    assert env["data"]["person"]["first_name"] == "Ada"
    assert env["data"]["person"]["birth_date"] == "1815-12-10"
    assert env["data"]["obj"] == {"count": 42}


def test_ask_self_repair_retry():
    attempts = 0

    def handler(kwargs):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            return make_mock_response("not-an-integer")
        return make_mock_response("99")

    set_openai_clients(sync_client=FakeOpenAIClient(handler))
    env, code = run_spl2_source("n = ask(fmt='int', retries=1) 'Give a number'\nsuccess n\n")
    assert code == 0
    assert env["data"] == 99
    assert attempts == 2


def test_ask_files_text_image_pdf_and_missing(tmp_path: Path):
    txt_file = tmp_path / "note.txt"
    txt_file.write_text("Important project context", encoding="utf-8")
    img_file = tmp_path / "pixel.png"
    img_file.write_bytes(b"\x89PNG\r\n\x1a\n")
    pdf_file = tmp_path / "doc.pdf"
    pdf_file.write_bytes(b"%PDF-1.4 mock")

    captured_inputs: list[Any] = []

    def handler(kwargs):
        captured_inputs.append(kwargs["input"])
        return make_mock_response("Processed attachments")

    set_openai_clients(sync_client=FakeOpenAIClient(handler))

    code = f"""
res = ask(files={[str(txt_file), str(img_file), str(pdf_file)]!r}) 'Summarize files'
success res
"""
    env, exit_code = run_spl2_source(code)
    assert exit_code == 0
    assert env["data"] == "Processed attachments"
    user_msg = captured_inputs[0][0]["content"]
    assert any(c["type"] == "input_text" and '<file path="' in c["text"] for c in user_msg)
    assert any(c["type"] == "input_image" for c in user_msg)
    assert any(c["type"] == "input_file" for c in user_msg)

    # Missing file fails fast with status="failure"
    missing_code = f"res = ask(files={str(tmp_path / 'nonexistent.txt')!r}) 'Read missing'\n"
    env_fail, code_fail = run_spl2_source(missing_code)
    assert code_fail == 1
    assert env_fail["status"] == "failure"
    assert "not found" in env_fail["reason"].lower()


def test_decide_boolean_evaluation():
    def handler(kwargs):
        assert "3*3" in str(kwargs["input"])
        return make_mock_response('{"result": true}')

    set_openai_clients(sync_client=FakeOpenAIClient(handler))
    code = """
if decide(data='Calculation is 3*3') 'The result of calculation is 9':
    success {'status': 'ok'}
else:
    failure 'LLM made mistake'
"""
    env, exit_code = run_spl2_source(code)
    assert exit_code == 0
    assert env["status"] == "ok"
    assert env["data"] == {"status": "ok"}


# ---------------------------------------------------------------------------
# 4. Enforce, Forbid, Restrict & Dynamic Context Scoping
# ---------------------------------------------------------------------------


def test_enforce_forbid_system_instructions():
    captured_instructions: list[str] = []

    def handler(kwargs):
        captured_instructions.append(kwargs["instructions"])
        return make_mock_response("狗的故事")

    set_openai_clients(sync_client=FakeOpenAIClient(handler))
    code = """
enforce 'Answer in Chinese':
    forbid 'Mentioning word cat':
        result = ask 'Funny story about a pet'
success result
"""
    env, exit_code = run_spl2_source(code)
    assert exit_code == 0
    assert "Answer in Chinese" in captured_instructions[0]
    assert "Mentioning word cat" in captured_instructions[0]


def test_restrict_intersection_and_guardrails(tmp_path: Path):
    src_dir = tmp_path / "src"
    sub_dir = src_dir / "sub"
    other_dir = tmp_path / "other"
    sub_dir.mkdir(parents=True)
    other_dir.mkdir(parents=True)
    allowed_file = sub_dir / "ok.txt"
    allowed_file.write_text("hello", encoding="utf-8")
    blocked_file = src_dir / "top.txt"
    blocked_file.write_text("top", encoding="utf-8")
    outside_file = other_dir / "secret.txt"
    outside_file.write_text("secret", encoding="utf-8")

    with restrict_scope(
        fs=str(src_dir),
        net="*.example.com",
        exec="git,pytest",
        mcp="docs/*",
    ):
        # Nested restrict narrows fs to sub_dir, exec to pytest, net to api.example.com, mcp to docs/search
        with restrict_scope(
            fs=[str(sub_dir), str(other_dir)],  # Attempting to widen to other_dir must fail!
            net="api.example.com",
            exec="pytest,curl",  # curl not in outer allowlist!
            mcp="docs/search,evil/*",
        ):
            assert read_file(allowed_file) == "hello"
            with pytest.raises(RestrictionError):
                read_file(blocked_file)
            with pytest.raises(RestrictionError):
                read_file(outside_file)

            policy = get_active_restrict()
            policy.check_net("https://api.example.com/v1")
            with pytest.raises(RestrictionError):
                policy.check_net("https://sub.example.com/v1")

            policy.check_exec("pytest -q")
            with pytest.raises(RestrictionError):
                policy.check_exec("git status")
            with pytest.raises(RestrictionError):
                policy.check_exec("curl https://example.com")

            policy.check_mcp("docs", "search")
            with pytest.raises(RestrictionError):
                policy.check_mcp("docs", "other")
            with pytest.raises(RestrictionError):
                policy.check_mcp("evil", "read")


def test_async_concurrency_and_contextvar_isolation():
    seen_constraints: dict[str, tuple[tuple[str, ...], tuple[str, ...]]] = {}

    def handler(kwargs):
        prompt = kwargs["input"]
        seen_constraints[prompt] = (get_active_enforces(), get_active_forbids())
        return make_mock_response(f"ack:{prompt}")

    set_openai_clients(async_client=FakeAsyncOpenAIClient(handler))
    code = """
import asyncio

async def worker(name: str, rule: str):
    enforce rule:
        return await ask name

async def main():
    return await asyncio.gather(
        worker('task_a', 'rule_a'),
        worker('task_b', 'rule_b'),
    )

res = asyncio.run(main())
success res
"""
    env, exit_code = run_spl2_source(code)
    assert exit_code == 0
    assert env["data"] == ["ack:task_a", "ack:task_b"]
    assert seen_constraints["task_a"] == (("rule_a",), ())
    assert seen_constraints["task_b"] == (("rule_b",), ())


# ---------------------------------------------------------------------------
# 5. Agent Loop, Built-in Tools (`web_search`, `web_fetch`), and MCP
# ---------------------------------------------------------------------------


def test_agent_loop_with_builtin_tools(tmp_path: Path):
    target = tmp_path / "data.txt"
    target.write_text("alpha\nbeta\n", encoding="utf-8")
    step = 0

    def handler(kwargs):
        nonlocal step
        step += 1
        if step == 1:
            return make_mock_response(
                reasoning=["Need to read data.txt first"],
                tool_calls=[
                    {
                        "call_id": "call_1",
                        "name": "read_file",
                        "arguments": json.dumps({"path": str(target)}),
                    }
                ],
            )
        return make_mock_response('["alpha", "beta"]')

    set_openai_clients(sync_client=FakeOpenAIClient(handler))
    code = f"""
restrict(fs={str(tmp_path)!r}):
    lines = agent(fmt='array', tools=['read_file'], thinking='low') 'Read lines from data.txt'
success lines
"""
    env, exit_code = run_spl2_source(code)
    assert exit_code == 0
    assert env["data"] == ["alpha", "beta"]
    assert step == 2


def test_web_search_and_web_fetch_against_local_http_server(monkeypatch):
    mock_ddg_html = """
    <html><body>
      <div class="result">
        <a class="result__a" href="https://example.com/spl2">SPL2 Documentation</a>
        <a class="result__snippet">Semantic Prompt Language v2 reference guide.</a>
      </div>
    </body></html>
    """

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(mock_ddg_html.encode("utf-8"))

        def log_message(self, format, *args):
            pass

    server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
    port = server.server_port
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    try:
        url = f"http://127.0.0.1:{port}/html/"
        monkeypatch.setenv("SPL2_SEARCH_URL", url)
        results = web_search("SPL2 language")
        assert len(results) == 1
        assert results[0] == {
            "title": "SPL2 Documentation",
            "url": "https://example.com/spl2",
            "snippet": "Semantic Prompt Language v2 reference guide.",
        }
        fetched = web_fetch(url)
        assert "SPL2 Documentation" in fetched
    finally:
        server.shutdown()


def test_mcp_stdio_and_http_servers(tmp_path: Path):
    # Create a tiny stdio MCP server script
    stdio_server_script = tmp_path / "mock_mcp_stdio.py"
    stdio_server_script.write_text(
        """
import json, sys

while True:
    line = sys.stdin.readline()
    if not line:
        break
    line = line.strip()
    if not line:
        continue
    msg = json.loads(line)
    mid = msg.get("id")
    method = msg.get("method")
    if method == "initialize":
        resp = {"jsonrpc": "2.0", "id": mid, "result": {"protocolVersion": "2024-11-05", "capabilities": {}}}
    elif method == "tools/list":
        resp = {"jsonrpc": "2.0", "id": mid, "result": {"tools": [
            {"name": "echo_note", "description": "Echo a note", "inputSchema": {"type": "object", "properties": {"text": {"type": "string"}}}}
        ]}}
    elif method == "tools/call":
        arg_text = msg["params"]["arguments"].get("text", "")
        resp = {"jsonrpc": "2.0", "id": mid, "result": {"content": [{"type": "text", "text": f"STDIO:{arg_text}"}]}}
    else:
        continue
    sys.stdout.write(json.dumps(resp) + "\\n")
    sys.stdout.flush()
""",
        encoding="utf-8",
    )

    mcp_config = tmp_path / "mcp.json"
    mcp_config.write_text(
        json.dumps(
            {
                "mcpServers": {
                    "notes": {
                        "command": sys.executable,
                        "args": [str(stdio_server_script)],
                    }
                }
            }
        ),
        encoding="utf-8",
    )

    step = 0

    def handler(kwargs):
        nonlocal step
        step += 1
        if step == 1:
            return make_mock_response(
                tool_calls=[
                    {
                        "call_id": "c1",
                        "name": "mcp__notes__echo_note",
                        "arguments": json.dumps({"text": "hello-mcp"}),
                    }
                ]
            )
        # Verify tool output was passed back into conversation
        last_item = kwargs["input"][-1]
        return make_mock_response(last_item["output"])

    set_openai_clients(sync_client=FakeOpenAIClient(handler))
    code = "res = agent(tools=[], mcp='notes/*') 'Use notes MCP'\nsuccess res\n"
    env, exit_code = run_spl2_source(code, mcp_config_path=mcp_config)
    assert exit_code == 0
    assert env["data"] == "STDIO:hello-mcp"


# ---------------------------------------------------------------------------
# 6. `--trace` Record, Replay, Crash Recovery, and Stale Truncation
# ---------------------------------------------------------------------------


def test_trace_record_replay_and_invalidation(tmp_path: Path):
    trace_file = tmp_path / "run.trace.jsonl"
    call_count = 0

    def handler(kwargs):
        nonlocal call_count
        call_count += 1
        return make_mock_response(f"ans-{call_count}")

    set_openai_clients(sync_client=FakeOpenAIClient(handler))

    script_v1 = "a = ask 'First'\nb = ask 'Second'\nsuccess [a, b]\n"
    env1, code1 = run_spl2_source(script_v1, trace_path=trace_file)
    assert code1 == 0
    assert env1["data"] == ["ans-1", "ans-2"]
    assert call_count == 2

    # Re-run unmodified with trace: zero live LLM calls!
    env2, code2 = run_spl2_source(script_v1, trace_path=trace_file)
    assert code2 == 0
    assert env2["data"] == ["ans-1", "ans-2"]
    assert call_count == 2

    # Modify second prompt -> first replays, second executes live and truncates stale entry
    script_v2 = "a = ask 'First'\nb = ask 'Second MODIFIED'\nsuccess [a, b]\n"
    env3, code3 = run_spl2_source(script_v2, trace_path=trace_file)
    assert code3 == 0
    assert env3["data"] == ["ans-1", "ans-3"]
    assert call_count == 3


def test_trace_agent_crash_recovery_and_atomic_replay(tmp_path: Path):
    trace_file = tmp_path / "agent.trace.jsonl"
    side_effect_file = tmp_path / "counter.txt"
    side_effect_file.write_text("0", encoding="utf-8")

    llm_calls = 0
    should_crash_step_2 = True

    def handler(kwargs):
        nonlocal llm_calls
        llm_calls += 1
        # Check if tool output is already in input
        has_tool_output = any(
            isinstance(x, dict) and x.get("type") == "function_call_output"
            for x in kwargs["input"]
        )
        if not has_tool_output:
            return make_mock_response(
                tool_calls=[
                    {
                        "call_id": "call_write",
                        "name": "write_file",
                        "arguments": json.dumps(
                            {"path": str(side_effect_file), "content": "written_once"}
                        ),
                    }
                ]
            )
        if should_crash_step_2:
            raise RuntimeError("Simulated mid-agent crash on step 2")
        return make_mock_response("agent_finished")

    set_openai_clients(sync_client=FakeOpenAIClient(handler))
    code = "res = agent 'Write file and finish'\nsuccess res\n"

    # Run 1 crashes on step 2 after executing step 1's write_file tool
    env_crash, code_crash = run_spl2_source(code, trace_path=trace_file)
    assert code_crash == 1
    assert side_effect_file.read_text(encoding="utf-8") == "written_once"
    assert llm_calls == 2

    # Modify file on disk to prove step 1's write_file is NOT re-executed during crash recovery!
    side_effect_file.write_text("preserved_on_recovery", encoding="utf-8")
    should_crash_step_2 = False

    # Run 2 replays step 1 from trace and resumes live at step 2
    env_rec, code_rec = run_spl2_source(code, trace_path=trace_file)
    assert code_rec == 0
    assert env_rec["data"] == "agent_finished"
    assert side_effect_file.read_text(encoding="utf-8") == "preserved_on_recovery"
    assert llm_calls == 3

    # Run 3 replays the completed agent call atomically in 0 LLM calls
    env_atomic, code_atomic = run_spl2_source(code, trace_path=trace_file)
    assert code_atomic == 0
    assert env_atomic["data"] == "agent_finished"
    assert llm_calls == 3


# ---------------------------------------------------------------------------
# 7. `.spl2` Module Importing & CLI (`--check`, `--emit-py`, `--realtime`)
# ---------------------------------------------------------------------------


def test_spl2_importing_another_spl2_module(tmp_path: Path):
    helper_mod = tmp_path / "my_helper.spl2"
    helper_mod.write_text(
        """
def ask_greeting(name: str) -> str:
    enforce 'Be polite':
        return ask f'Greet {name}'
""",
        encoding="utf-8",
    )
    main_mod = tmp_path / "main_app.spl2"
    main_mod.write_text(
        """
from my_helper import ask_greeting

msg = ask_greeting('Alice')
success {'greeting': msg}
""",
        encoding="utf-8",
    )

    set_openai_clients(
        sync_client=FakeOpenAIClient(lambda kw: make_mock_response("Hello, Alice!"))
    )
    env, exit_code = run_spl2_file(main_mod)
    assert exit_code == 0
    assert env["data"] == {"greeting": "Hello, Alice!"}


def test_cli_check_emit_py_print_stderr_and_realtime(tmp_path: Path, capsys):
    script = tmp_path / "demo.spl2"
    script.write_text(
        "print('debug log to stderr')\nres = ask 'Ping'\nsuccess {'pong': res}\n",
        encoding="utf-8",
    )

    # 1. --check
    assert cli_main(["--check", str(script)]) == 0

    # 2. --emit-py
    assert cli_main(["--emit-py", str(script)]) == 0
    out_emit, _ = capsys.readouterr()
    assert "__spl2_ask__" in out_emit

    # 3. Normal execution: print() goes to stderr, JSON envelope to stdout
    set_openai_clients(
        sync_client=FakeOpenAIClient(lambda kw: make_mock_response("PONG"))
    )
    assert cli_main([str(script)]) == 0
    out_run, err_run = capsys.readouterr()
    assert "debug log to stderr" in err_run
    parsed_stdout = json.loads(out_run.strip())
    assert parsed_stdout == {
        "status": "ok",
        "reason": None,
        "lineno": 3,
        "data": {"pong": "PONG"},
    }

    # 4. --realtime (non-TTY headless auto-close) keeps stdout clean JSON
    assert cli_main(["--realtime", str(script)]) == 0
    out_rt, _ = capsys.readouterr()
    parsed_rt = json.loads(out_rt.strip())
    assert parsed_rt["status"] == "ok"
    assert parsed_rt["data"] == {"pong": "PONG"}


def test_realtime_tui_streams_thinking_and_response_as_single_messages():
    from textual.app import App
    from spl2.tui import run_with_realtime_tui

    class FakeStreamCtx:
        def __init__(self, events, final_resp):
            self._events = events
            self._final_resp = final_resp

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def __iter__(self):
            return iter(self._events)

        def get_final_response(self):
            return self._final_resp

    class StreamingClient:
        def __init__(self):
            self.responses = self

        def stream(self, **kwargs):
            events = [
                SimpleNamespace(
                    type="response.reasoning_summary_text.delta", delta="Step 1: "
                ),
                SimpleNamespace(
                    type="response.reasoning_summary_text.delta", delta="analyze input."
                ),
                SimpleNamespace(type="response.output_text.delta", delta="Hello "),
                SimpleNamespace(type="response.output_text.delta", delta="world!"),
            ]
            final_resp = make_mock_response(
                "Hello world!",
                reasoning=["Step 1: analyze input."],
            )
            return FakeStreamCtx(events, final_resp)

    set_openai_clients(sync_client=StreamingClient())

    committed_entries: list[str] = []
    orig_exit = App.exit

    def spy_exit(self, *args, **kwargs):
        committed_entries.extend(getattr(self, "_committed_entries", []))
        return orig_exit(self, *args, **kwargs)

    App.exit = spy_exit
    try:
        env = run_with_realtime_tui(
            lambda: run_spl2_source(
                "ans = ask(thinking='medium') 'Say hello'\nsuccess ans\n"
            )[0],
            interactive=False,
        )
    finally:
        App.exit = orig_exit

    assert env["status"] == "ok"
    assert env["data"] == "Hello world!"

    reasoning_entries = [e for e in committed_entries if "REASONING:" in e]
    response_entries = [e for e in committed_entries if "RESPONSE:" in e]
    assert len(reasoning_entries) == 1
    assert "Step 1: analyze input." in reasoning_entries[0]
    assert len(response_entries) == 1
    assert "Hello world!" in response_entries[0]


# ---------------------------------------------------------------------------
# 8. Runnable Markdown Workflows (`.md` Frontmatter, `spl2` Fences, Blockquotes)
# ---------------------------------------------------------------------------

MD_HEADER = "---\nextension: semantic-prompt-language\nversion: 2\n"


def _md_doc(body: str, metadata: str = "") -> str:
    return f"{MD_HEADER}{metadata}---\n\n{body}"


def _spl2_fence(code: str) -> str:
    return f"```spl2\n{code}\n```"


def test_markdown_frontmatter_and_fence_validation():
    from spl2.markdown import extract_markdown, is_workflow_markdown

    assert is_workflow_markdown(_md_doc("Text")) is True
    assert is_workflow_markdown(_md_doc("Text").replace("version: 2", "version: 1")) is True
    assert is_workflow_markdown(_md_doc("Text").replace("extension:", '"extension":')) is True
    assert is_workflow_markdown("---\nplain scalar\n---") is False
    assert is_workflow_markdown("# Comment\n" + _md_doc("Text")) is False
    assert is_workflow_markdown("---\ntitle: ordinary\n---\nextension: semantic-prompt-language") is False

    invalid_cases = [
        ("", "frontmatter"),
        ("---\nextension: semantic-prompt-language\nversion: 2", "unterminated YAML frontmatter"),
        ("---\nextension: wrong\nversion: 2\n---", "extension: semantic-prompt-language"),
        ("---\nextension: semantic-prompt-language\nversion: 3\n---", "version: 1 or 2"),
        ("---\nextension: semantic-prompt-language\n---", "version: 1 or 2"),
        ("---\nextension: semantic-prompt-language\nversion: 2\nversion: 2\n---", "duplicate key"),
        (_md_doc("", "model: 42\n"), "frontmatter model must be a non-empty string"),
        (_md_doc("", "preamble: []\n"), "frontmatter preamble must be a string"),
        (_md_doc("", "unknown: value\n"), "unknown frontmatter field 'unknown'"),
        (_md_doc("```spl2\nsuccess 1"), "unterminated SPL2 fence"),
    ]
    for src, expected_msg in invalid_cases:
        diags = lint_spl2(src, filename="workflow.md")
        assert len(diags) >= 1, f"Expected error for: {src!r}"
        assert expected_msg in diags[0].message

    # Split block across fences must fail validation
    split_block = _md_doc(_spl2_fence("if True:") + "\n\n" + _spl2_fence("    pass"))
    diags_split = lint_spl2(split_block, filename="split.md")
    assert len(diags_split) == 1
    assert "SyntaxError" in diags_split[0].message

    # Tilde fences, CRLF, multiline YAML preamble, and exact line numbers
    tilde_src = _md_doc(
        "~~~spl2\nfailure 'no'\n~~~",
        "preamble: |\n  Be precise.\n  Be brief.\n",
    ).replace("\n", "\r\n")
    extracted = extract_markdown(tilde_src, filename="tilde.md")
    assert extracted.preamble == "Be precise.\nBe brief.\n"
    assert extracted.blocks[0].line == 10
    assert extracted.code.split("\n")[9] == "failure 'no'"


def test_markdown_ignores_commentary_non_spl2_fences_and_parses_blockquotes():
    from spl2.markdown import extract_markdown

    src = _md_doc(
        f"""Fail now. @failure

```text
> fail now
```

```spl
fail 'v1 fence ignored'
```

<!--
> fail now
-->

- ```spl2
  failure 'nested list fence ignored'
  ```

{_spl2_fence("count = 1")}

## A heading comment

{_spl2_fence("count += 2\nsuccess count")}"""
    )
    env, exit_code = run_spl2_source(src, filename="commentary.md")
    assert exit_code == 0
    assert env == {"status": "ok", "reason": None, "lineno": 32, "data": 3}

    bq_doc = extract_markdown(
        _md_doc("> First line\ncontinued\n>\n> Second paragraph\n\nComment\n\n> Next instruction")
    )
    assert len(bq_doc.blocks) == 2
    assert bq_doc.blocks[0].kind == "natural"
    assert bq_doc.blocks[0].text == "First line\ncontinued\n\nSecond paragraph"
    assert bq_doc.blocks[1].kind == "natural"
    assert bq_doc.blocks[1].text == "Next instruction"


def test_markdown_mixed_fences_and_blockquotes_with_pydantic_and_preamble():
    calls: list[dict[str, Any]] = []
    step = 0

    def handler(kwargs):
        nonlocal step
        calls.append(kwargs)
        step += 1
        if step == 1:
            # Blockquote 1: call `double(2)` and save `count = 4`
            return make_mock_response(
                tool_calls=[
                    {
                        "call_id": "c1",
                        "name": "call_function",
                        "arguments": json.dumps({"name": "double", "args": [2]}),
                    },
                    {
                        "call_id": "c2",
                        "name": "save_variable",
                        "arguments": json.dumps({"name": "count", "value": 4}),
                    },
                ]
            )
        if step == 2:
            # Finish blockquote 1
            return make_mock_response("Updated count.")
        if step == 3:
            # Blockquote 2: validate and save Pydantic `Person` instance to `@person`
            return make_mock_response(
                tool_calls=[
                    {
                        "call_id": "c3",
                        "name": "save_variable",
                        "arguments": json.dumps(
                            {
                                "name": "person",
                                "value": {
                                    "first_name": "Ada",
                                    "last_name": "Lovelace",
                                    "age": 36,
                                },
                            }
                        ),
                    }
                ]
            )
        return make_mock_response("Saved person.")

    set_openai_clients(sync_client=FakeOpenAIClient(handler))

    md_source = _md_doc(
        f"""{_spl2_fence('''from pydantic import BaseModel

class Person(BaseModel):
    first_name: str
    last_name: str
    age: int

count = 2
def double(x):
    return x * 2
''')}

> Set @count to @double of its current value.

{_spl2_fence("assert count == 4")}

> Generate a person @validate[Person] and save to @person

{_spl2_fence("assert isinstance(person, Person)\nsuccess {'count': count, 'name': f'{person.first_name} {person.last_name}'}")}
""",
        metadata="model: frontmatter-model\npreamble: Be concise and accurate.\n",
    )

    env, exit_code = run_spl2_source(md_source, filename="mixed.md")
    assert exit_code == 0
    assert env["status"] == "ok"
    assert env["data"] == {"count": 4, "name": "Ada Lovelace"}
    assert len(calls) == 4
    for c in calls:
        assert c["model"] == "frontmatter-model"
        assert "Be concise and accurate." in c["instructions"]


def test_markdown_inline_blockquote_directives_and_trace_replay(tmp_path: Path):
    trace_file = tmp_path / "md_workflow.trace.jsonl"
    allowed_dir = tmp_path / "reports"
    allowed_dir.mkdir()
    report_file = allowed_dir / "out.txt"

    llm_calls = 0

    def handler(kwargs):
        nonlocal llm_calls
        llm_calls += 1
        if llm_calls == 1:
            # Verify @ENFORCE and @FORBID from blockquote are in instructions
            assert "Write in uppercase" in kwargs["instructions"]
            assert "Using lowercase" in kwargs["instructions"]
            return make_mock_response(
                tool_calls=[
                    {
                        "call_id": "w1",
                        "name": "write_file",
                        "arguments": json.dumps(
                            {"path": str(report_file), "content": "REPORT DATA"}
                        ),
                    },
                    {
                        "call_id": "s1",
                        "name": "save_variable",
                        "arguments": json.dumps(
                            {"name": "summary", "value": {"title": "OK"}}
                        ),
                    },
                ]
            )
        return make_mock_response("Completed.")

    set_openai_clients(sync_client=FakeOpenAIClient(handler))

    md_source = _md_doc(
        f"""> @ENFORCE Write in uppercase
> @FORBID Using lowercase
> @RESTRICT fs['{allowed_dir.as_posix()}']
>
> Write report and save @summary.

{_spl2_fence("success summary.title")}
"""
    )

    # First run: records to trace_file
    env1, code1 = run_spl2_source(
        md_source, filename=str(tmp_path / "flow.md"), trace_path=trace_file
    )
    assert code1 == 0
    assert env1["data"] == "OK"
    assert report_file.read_text(encoding="utf-8") == "REPORT DATA"
    assert llm_calls == 2

    # Modify file on disk to verify replay does not re-run blockquote side effects
    report_file.write_text("EDITED ON DISK", encoding="utf-8")

    # Second run: replays blockquote from trace with 0 new LLM calls
    env2, code2 = run_spl2_source(
        md_source, filename=str(tmp_path / "flow.md"), trace_path=trace_file
    )
    assert code2 == 0
    assert env2["data"] == "OK"
    assert report_file.read_text(encoding="utf-8") == "EDITED ON DISK"
    assert llm_calls == 2


def test_cli_check_and_emit_py_on_markdown_and_all_examples(capsys):
    examples_dir = Path(__file__).resolve().parent.parent / "examples"
    spl2_files = sorted(examples_dir.glob("*.spl2"))
    md_files = sorted(examples_dir.glob("*.md"))
    assert len(spl2_files) >= 5
    assert len(md_files) >= 2

    for f in [*spl2_files, *md_files]:
        assert cli_main(["--check", str(f)]) == 0
        assert cli_main(["--emit-py", str(f)]) == 0
        out_py, _ = capsys.readouterr()
        assert "from spl2.runtime import" in out_py
