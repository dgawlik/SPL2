# Policies, Sandboxing & Termination

SPL2 separates prompt-level guidance (`enforce`, `forbid`) from deterministic runtime capability sandboxing (`restrict`) and guarantees a single JSON output envelope on `stdout` (`success`, `failure`).

## `enforce` & `forbid`

`enforce <expr>:` and `forbid <expr>:` dynamically scope mandatory positive and negative instructions across all nested `ask`, `agent`, and `decide` calls:

* `enforce <expr>:` appends *"You MUST satisfy this constraint"* to the LLM system instructions.
* `forbid <expr>:` appends *"You MUST NOT do this"* to the LLM system instructions.

`decide_guard.spl2`

```spl2
enforce 'Answer in Chinese':
    forbid 'Mentioning word cat':
        story = ask 'Funny story about a pet'

if decide(data='Calculation is 3*3') 'The result of calculation is 9':
    success {'status': 'ok', 'story': story}
else:
    failure 'LLM made mistake'
```

## `restrict` Capability Sandboxing

`restrict(fs=..., net=..., exec=..., mcp=...):` enforces deterministic guardrails on built-in tools and `agent` tool calls within the block:

| Modifier | Guardrail |
| --- | --- |
| `fs` | Canonical path containment for `read_file`, `write_file`, and `files=` attachments |
| `net` | Allowed hostnames or wildcard domains (`*.example.com`) for `web_fetch` and `web_search` |
| `exec` | Allowed executable names for `shell` (such as `'git,pytest'`) |
| `mcp` | Allowed MCP servers/tools (`"server"`, `"server/*"`, or `"server/tool"`) |

### Nested Intersection Semantics

When `restrict` blocks are nested, their allowlists are intersected—inner blocks can only narrow permissions, never widen them:

```spl2
restrict(fs='src', net='*.example.com', exec='git,pytest', mcp='docs/*'):
    restrict(fs='src/core', exec='pytest'):
        summary = agent 'Run pytest on src/core and summarize results'
```

Because `enforce`, `forbid`, and `restrict` are stored in `contextvars.ContextVar`, constraints apply across helper functions, `ThreadPoolExecutor` workers, and concurrent `asyncio.gather()` tasks without cross-task bleed.

## `success`, `failure` & Output Contract

Every SPL2 execution emits a single structured JSON envelope on `stdout`:

```json
{
  "status": "ok",
  "reason": null,
  "lineno": 12,
  "data": {}
}
```

or on failure (exiting with a non-zero exit code):

```json
{
  "status": "failure",
  "reason": "LLM made mistake",
  "lineno": 15,
  "data": null
}
```

* `success <expr>` immediately unwinds the stack, serializes `<expr>` (including Pydantic models) into `data`, and exits with code `0`.
* `failure <expr>` immediately unwinds the stack, records `<expr>` in `reason`, and exits with code `1`.
* **Implicit EOF**: Reaching the end of the file without `success` or `failure` emits `{"status": "ok", "reason": null, "lineno": <last_line>, "data": null}`.
* **Uncaught Exceptions**: Any unhandled Python exception, retry exhaustion, or `RestrictionError` emits `"status": "failure"` with the originating `.spl2` line number.
* **`print()` Routing**: Standard Python `print()` calls and logs are routed to `stderr` so `stdout` remains guaranteed valid JSON.
