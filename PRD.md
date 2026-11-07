
# Semantic Prompt Language v2 (SPL2)

This Product Requirements Definition describes **Semantic Prompt Language 2 (SPL2)** — a syntactic superset of Python for building reliable LLM and agentic workflows.

SPL2 extends Python with contextual (soft) keywords for LLM calls (`ask`), agentic loops (`agent`), boolean evaluation (`decide`), dynamic prompt constraints (`enforce`, `forbid`), capability sandboxing (`restrict`), and structured program termination (`success`, `failure`), along with built-in tools and Model Context Protocol (MCP) support.

## Compilation & Execution Pipeline

The runtime is distributed as a `pip` package that installs the `spl2` CLI executable and runtime library.

1. **Token-Stream Preprocessor (`tokenize`)**: Because every SPL2 construct is composed of valid Python tokens (`NAME`, `(...)`, `STRING`, `:`), the compiler uses Python's built-in `tokenize` module to rewrite SPL2 contextual keyword forms into valid Python AST-compatible helper calls and context managers while preserving exact line (`lineno`) and column (`col_offset`) coordinates.
2. **AST Validation & Transformation (`ast.NodeTransformer`)**: The preprocessed source is parsed with `ast.parse()`, validated in a static lint stage, and transformed via `ast.NodeTransformer` into equivalent Python AST nodes leaving original Python syntax intact.
   * **Compile-Time Lint Rules** (enforced both during `spl2 --check` and before normal execution, formatted with filename, line, column, source snippet, and caret pointer):
     1. Reject unknown modifier keyword names on `ask(...)`, `agent(...)`, `decide(...)`, or `restrict(...)`.
     2. Enforce mutual exclusion of `fmt` and `schema`.
     3. Validate literal values for `fmt` (`'text' | 'object' | 'array' | 'string' | 'float' | 'int' | 'bool'`) and `thinking` (`'none' | 'low' | 'medium' | 'high' | 'max'`).
     4. Reject negative or non-integer literals for `retries`, `tokens`, and `max_steps`.
     5. Reject agent-only modifiers (`tools`, `mcp`, `max_steps`) when passed to `ask` or `decide`.
     6. Reject empty `restrict()` calls with no arguments or missing prompt/target expressions after `ask`, `agent`, `decide`, `enforce`, or `forbid`.
3. **Bytecode Compilation**: After AST transformations, the result is compiled via `compile()` into plain Python bytecode.
4. **Contextual (Soft) Keywords**: `ask`, `agent`, `decide`, `enforce`, `forbid`, `restrict`, `success`, and `failure` are contextual keywords (like Python's `match`/`case`/`type`). They are only parsed as SPL2 constructs when they appear in their designated syntactic positions, remaining valid variable, parameter, and attribute names everywhere else in `.spl2` files.
5. **CLI & Developer Flags**:
   * `spl2 [options] <script.spl2> [script_args...]` executes `<script.spl2>` and passes `[script_args...]` into standard `sys.argv`.
   * `--check`: Runs the static lint and AST validation stage without executing the script or requiring an API key (exits `0` on valid syntax/modifiers, `1` on lint errors).
   * `--emit-py`: Outputs the transpiled Python source code (preserving original line numbers) for debugging and tooling inspection.

## LLM Provider & Model Configuration

* **OpenAI SDK (`Responses API` & Structured Outputs)**: All model calls use the official `openai` Python package (`client.responses.create` / `client.responses.parse`), supporting OpenAI models as well as any OpenAI-compatible endpoint via `OPENAI_API_KEY` and `OPENAI_BASE_URL`.
* **Model Selection**: Configurable via the `--model` CLI flag, the `OPENAI_MODEL` (or `SPL2_MODEL`) environment variable, or per-call via the `model=` modifier. Precedence: CLI `--model` > per-call `model=` > environment variable > default model.

## Syntax Extensions

### Modifiers

`ask`, `agent`, and `decide` accept keyword modifiers inside parentheses (optional when using defaults):

* `len`: `'word' | 'sentence' | 'paragraph' | 'long'` or custom string — prompt guidance supplied in the system prelude instructing the LLM how long the answer should be (not hard-validated via regex at runtime; use `tokens` for hard limits).
* `fmt`: `'text'` (default) | `'object'` (JSON) | `'array'` (JSON) | `'string'` (JSON) | `'float'` (JSON) | `'int'` (JSON) | `'bool'` (JSON).
* `schema`: Mutually exclusive with `fmt`. Accepts a Pydantic `BaseModel` class (or `TypeAdapter`-compatible Python type) and validates/parses the JSON output into a typed instance using OpenAI Structured Outputs / Pydantic validation.
* `tokens`: Integer hard output token constraint passed to the OpenAI API (`max_output_tokens`).
* `retries`: Integer count of retry attempts (default `0`).
  * For format or `schema` validation failures, retries perform **self-repair** by feeding the validation error back to the LLM.
  * For transient OpenAI API/transport errors (`429` rate limits, `5xx`, network timeouts), retries use exponential backoff.
* `thinking`: `'none' | 'low' | 'medium' | 'high' | 'max'` — reasoning effort mapped to the OpenAI API reasoning configuration. Reasoning tokens/summaries are not appended to the returned value, but are logged at `DEBUG` level (and streamed in `--realtime` mode).
* `files`: Accepts a `str`, `Path`, or `Sequence[str | Path]` (including glob patterns such as `'src/**/*.py'`).
  * File existence is validated before making the API call (failing fast with `status: "failure"` if any path is missing or matches no files).
  * UTF-8 text and source files are inlined into the prompt wrapped in `<file path="...">...</file>` blocks.
  * Images (`.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`) and `.pdf` documents are encoded and attached as native OpenAI `input_image` and `input_file` content blocks.
* `model`: Optional per-call model override string.
* Agent-specific modifiers (for `agent` only):
  * `tools`: Optional allowlist of built-in tools enabled for this agent call (defaults to all built-in tools).
  * `mcp`: Optional allowlist of configured MCP servers/tools (`"server"`, `"server/*"`, or `"server/tool"`).
  * `max_steps`: Maximum number of tool-calling turns in the agent loop (default `25`).

### Prompt Expressions & Strings

`ask`, `agent`, `decide`, `enforce`, and `forbid` accept any Python string literal (including `f'...'` formatted strings, raw strings, and multiline `'''...'''` / `"""..."""` strings) as well as any parenthesized or variable expression evaluating to a `str`.

Standard Python string semantics apply: plain strings (`'...'`) are literal and do not perform implicit `{var}` interpolation (preserving literal JSON snippets in prompts), while `f'...'` strings perform standard Python interpolation.

### Ask

```spl2
result = ask(len='paragraph', fmt='text') 'Funny office story'
```

The `ask` keyword executes a single-turn, tool-free LLM call using the official `openai` library. The response is validated against `fmt` or `schema`; if validation fails, the runtime either performs a self-repair retry (up to `retries`) or fails with a structured error. Unlike `agent`, `ask` never exposes tools or MCP servers.

Pydantic Example:

```spl2
from datetime import date
from typing import Optional
from pydantic import BaseModel, EmailStr, Field


class Person(BaseModel):
    first_name: str = Field(..., min_length=1, max_length=50)
    last_name: str = Field(..., min_length=1, max_length=50)
    age: int = Field(..., ge=0, le=120, description="Age in years")
    email: Optional[EmailStr] = None
    birth_date: date

sample_person = ask(schema=Person, retries=2) 'Generate sample person'
```

### Agent, Built-in Tools & MCP

```spl2
files = agent(fmt='array', thinking='medium', retries=1) 'List all the files in current repository and pass paths to json array'
```

`agent` runs an autonomous tool-calling loop (bounded by `max_steps`, default `25`) to satisfy the user command, with access to built-in tools and configured MCP servers. Both intermediate reasoning and tool invocations/results are logged at `DEBUG` level and displayed live under `--realtime`.

#### Built-in Tools

Agents have access to 5 built-in tools by default (filterable via `tools=`), which are also directly importable for deterministic calls in `.spl2` code via `from spl2.tools import read_file, write_file, shell, web_fetch, web_search`:
* `read_file(path)`: Reads UTF-8 file contents from the workspace.
* `write_file(path, content)`: Writes UTF-8 content to a file, creating parent directories as needed.
* `shell(command)`: Executes a shell command in the platform default shell, returning combined stdout/stderr.
* `web_fetch(url)`: Fetches HTTP(S) content from a URL.
* `web_search(query)`: Performs a zero-config web search using the DuckDuckGo HTML endpoint (`html.duckduckgo.com`, overridable via `SPL2_SEARCH_URL`) and returns top titles, URLs, and snippets. Works identically inside `agent` loops and when called deterministically from Python across any OpenAI-compatible model provider.

#### MCP Configuration

MCP servers are configured via `--mcp <config.json>` on the CLI (or auto-discovered from `.mcp.json` in the working directory if present). Both local (`stdio` with `command`, `args`, `env`, `cwd`) and remote (`http` / `sse` with `url`, `headers`) MCP servers are supported.

### Decide

```spl2
if decide(data='Calculation is 3*3') 'The result of calculation is 9':
    success {'status': 'ok'}
else:
    failure 'LLM made mistake'
```

The `decide` keyword evaluates a natural-language predicate and returns a Python `bool` (`True` or `False`).
* `data=` is optional and accepts any Python value (strings, dicts, lists, Pydantic models, etc., which are automatically serialized into structured evidence in the prompt).
* `decide` also accepts `thinking`, `retries`, `files`, and `model` modifiers.
* The runtime constructs specialized system instructions and enforces a boolean structured output schema so evaluation is deterministic and reliable.

### Enforce / Forbid / Restrict

```spl2
enforce 'Answer in Chinese':
    forbid 'Mentioning word cat':
        result = ask 'Funny story about a pet'

restrict(fs='src', net='*.example.com', exec='git,pytest', mcp='docs/*'):
    summary = agent 'Run tests and summarize failures'
```

Every time the runtime calls the LLM or executes a tool, active scoped policies are read from the runtime state:
* `enforce <expr>:` — appends a mandatory positive constraint (*"You MUST satisfy this constraint"*) to the LLM system instructions.
* `forbid <expr>:` — appends a mandatory negative constraint (*"You MUST NOT do this"*) to the LLM system instructions.
* `restrict(fs=..., net=..., exec=..., mcp=...):` — enforces deterministic capability guardrails on built-in tools and `agent` tool calls within the block:
  * `fs`: Allowed directory/file paths (canonical path containment).
  * `net`: Allowed hostnames or wildcard domains (`*.example.com`) for `web_fetch` / `web_search`.
  * `exec`: Allowed executable names for `shell`.
  * `mcp`: Allowed MCP servers/tools (`"server"`, `"server/*"`, or `"server/tool"`).
  * Nested `restrict` blocks intersect their allowlists (inner blocks can only narrow permissions, never widen them).

`enforce`, `forbid`, and `restrict` blocks are dynamically scoped using Python's `contextvars.ContextVar`, meaning constraints automatically apply to any `ask`, `agent`, `decide`, or tool calls executed inside the block—including across helper functions, `ThreadPoolExecutor` workers, and `asyncio` tasks—and unwind cleanly when exiting the block.

### Concurrency & `async` Support

`ask`, `agent`, and `decide` work both synchronously and asynchronously:
* Standard calls (`result = ask(...) '...'`) execute synchronously using the synchronous `OpenAI` client.
* Preceding a call with `await` inside an `async def` function (`result = await ask(...) '...'`) compiles to an asynchronous call using `AsyncOpenAI`, allowing concurrent execution with `asyncio.gather()`.
* Because runtime scopes (`enforce`, `forbid`, `restrict`) are stored in `contextvars.ContextVar`, concurrent tasks and threads inherit their caller's isolated constraint stack without cross-task bleed.

### Success / Failure & Output Contract

All program executions emit a single structured JSON envelope to `stdout`:

```json
{
  "status": "ok",
  "reason": null,
  "lineno": 123,
  "data": {}
}
```

or on failure:

```json
{
  "status": "failure",
  "reason": "LLM made mistake",
  "lineno": 123,
  "data": null
}
```

* `success <expr>` immediately terminates the program (unwinding the call stack via a dedicated base-exception), serializes `<expr>` into `data`, records `lineno`, and prints the JSON envelope with `"status": "ok"`.
* `failure <expr>` immediately terminates the program, records `<expr>` as `reason` (along with the source `lineno`), and prints the JSON envelope with `"status": "failure"` and a non-zero exit code.
* **Implicit EOF**: If a `.spl2` program finishes execution to the end of the file without executing `success` or `failure`, it exits with `{"status": "ok", "reason": null, "lineno": <last_line>, "data": null}`.
* **Unhandled Exceptions**: Any uncaught Python exception, validation failure after retry exhaustion, or tool failure automatically terminates execution with `"status": "failure"`, populating `reason` with the error message and `lineno` with the originating `.spl2` line number.
* **`print()` Routing**: Standard Python `print()` output and logs are routed to `stderr` so `stdout` remains guaranteed valid JSON for CLI piping and CI automation.

## Runtime

### Caching & Replay (`--trace`)

Passing `--trace` (or `--trace=<optional_file_name>`, defaulting to `<script_name>.trace.jsonl`) enables durable record-and-replay caching:
* All LLM (`ask`, `decide`), `agent`, MCP, and tool calls are recorded as append-only JSONL entries guarded by a thread/async lock.
* **Concurrency-Safe Replay Matching**: Entries are keyed and matched by `(content_hash, occurrence_index)` — where `content_hash` hashes `(operation_kind, prompt, active_enforce_forbid_restrict_stack, modifiers, schema)` and `occurrence_index` tracks the $n$-th invocation of that exact hash during the run. This guarantees deterministic replay even when concurrent `await` tasks (`asyncio.gather`) or `ThreadPoolExecutor` workers complete in different orders across runs.
* **Crash Recovery & Replay**: When re-running with `--trace`, matching entries are replayed from the trace file without invoking the LLM or re-running agent side effects.
  * Completed `agent` calls replay their final output atomically (skipping internal tool executions), while in-progress `agent` calls that crashed mid-loop replay completed internal tool steps and resume from the failure point.
  * When a new unrecorded `content_hash` is encountered (because a prompt or modifier changed), the runtime invalidates/truncates subsequent stale entries and executes live from that point, appending new entries.
* When a program succeeds and is run again unmodified with `--trace`, only deterministic Python logic runs with zero live LLM calls.

### Logging Levels

Standard Python `logging` mechanisms apply. All SPL2 runtime activity—including assembled prompts, active `enforce`/`forbid` constraints, raw LLM responses, reasoning summaries, retry/repair attempts, and tool/MCP calls—is logged at `DEBUG` level to `stderr`. Pass `--log=<level>` (`DEBUG`, `INFO`, `WARNING`, `ERROR`) on the CLI.

### Pretty Printing & Realtime Streaming (`--realtime`)

Running with `--realtime` launches a rich live terminal TUI powered by [Textual](https://textual.textualize.io/):
* Renders the Textual UI to `stderr` (the interactive terminal console) so `stdout` remains clean for the final JSON output contract.
* Streams LLM token deltas, reasoning chunks, step progress, and tool/MCP executions in real time via OpenAI streaming callbacks.
* Uses distinct icons and colors for prompts, reasoning, streaming responses, tool/MCP calls, and deterministic Python logs.
* Intercepts and pretty-prints JSON payloads with 2-space indentation.
* On completion, displays the final pretty-printed JSON result inside the TUI (staying open until `q` or `Enter` is pressed when interactive, or auto-closing if non-TTY) before emitting the final JSON envelope to `stdout`.

## Developer Experience (VS Code Extension)

A VS Code extension for `.spl2` files provides:
* TextMate grammar for syntax highlighting of SPL2 keywords (`ask`, `agent`, `decide`, `enforce`, `forbid`, `restrict`, `success`, `failure`) alongside standard Python syntax.
* Language Server integration that preprocesses `.spl2` buffers through the token-stream mapper so existing Python language servers (Pylance/Pyright) provide autocompletion, type checking (including Pydantic `schema=` return types), hover docs, and SPL2 lint diagnostics with accurate line/column mapping.

## Importing

SPL2 importing uses Python's `importlib.abc.MetaPathFinder` and `SourceLoader` hooks registered by the `spl2` runtime:
* All standard Python modules and third-party packages are importable from `.spl2` using standard `import` / `from ... import ...` syntax.
* `.spl2` modules can import other `.spl2` modules seamlessly (compiled on import via the SPL2 loader).
* `.spl2` files are not directly imported by plain `python` without the `spl2` runtime entry point.
