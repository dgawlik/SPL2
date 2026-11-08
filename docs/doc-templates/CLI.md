# CLI & Runtime Reference

The `spl2` CLI compiles, lints, traces, and executes both `.spl2` scripts and runnable Markdown (`.md`) workflows with built-in record-and-replay caching and a live Textual terminal UI.

## Command-Line Synopsis

```bash
spl2 [options] <script.spl2|workflow.md> [script_args...]
```

All `[script_args...]` following `<script.spl2|workflow.md>` are forwarded into standard Python `sys.argv`.

| Flag | Description |
| --- | --- |
| `--check` | Run static lint and AST validation without executing the script or requiring an API key (`0` on valid, `1` on errors) |
| `--emit-py` | Output the transpiled Python source code (preserving original line numbers) to `stdout` |
| `--model <name>` | Override the OpenAI model for all calls in the run (highest precedence) |
| `--mcp <config.json>` | Load MCP server definitions from `<config.json>` (defaults to `.mcp.json` if present) |
| `--trace [file]` | Enable durable record-and-replay caching (defaults to `<script_name>.trace.jsonl`) |
| `--log <level>` | Set `stderr` logging level (`DEBUG`, `INFO`, `WARNING`, `ERROR`) |
| `--realtime` | Launch the live Textual TUI on `stderr` with real-time token and tool streaming |

## Caching & Replay (`--trace`)

Passing `--trace` records all `ask`, `decide`, `agent`, MCP, and deterministic tool calls as append-only JSONL entries:

* **Concurrency-Safe Replay Matching**: Entries are keyed by `(content_hash, occurrence_index)` where `content_hash` hashes `(operation_kind, prompt, active_enforce_forbid_restrict_stack, modifiers, schema)` and `occurrence_index` tracks the $n$-th invocation of that hash. Concurrent `asyncio.gather()` tasks replay deterministically regardless of completion order.
* **Crash Recovery & Atomic Agent Replay**: Completed `agent` calls replay their final output atomically (skipping internal tool side effects). If an `agent` loop crashed mid-run, re-running with `--trace` replays completed internal tool steps and resumes live from the failure point.
* **Automatic Cache Invalidation**: When a prompt, constraint, or modifier changes, the first unrecorded `content_hash` truncates subsequent stale entries and executes live from that point.

## Live Terminal UI (`--realtime`)

Running with `--realtime` launches an interactive [Textual](https://textual.textualize.io/) terminal UI rendered to `stderr`:

* Streams LLM token deltas, reasoning summaries, agent step progress, and tool/MCP executions in real time.
* Pretty-prints JSON payloads with 2-space indentation.
* Displays the final JSON envelope inside the TUI on completion (waiting for `q` or `Enter` when interactive, or auto-closing when non-TTY) before emitting the JSON envelope to `stdout`.

## VS Code Extension

The SPL2 VS Code extension in `vscode/` provides:

* TextMate syntax highlighting for `.spl2` files and ```` ```spl2 ```` Markdown code blocks.
* Real-time diagnostics for all 6 compile-time lint rules.
* Virtual Python document preprocessing with bidirectional source mapping so Pylance/Pyright provides autocompletion, Pydantic `schema=` return type checking, hover documentation, and go-to-definition.
