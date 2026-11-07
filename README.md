# Semantic Prompt Language v2 (SPL2)

**Semantic Prompt Language v2 (SPL2)** is a syntactic superset of Python for building reliable LLM and agentic workflows.

SPL2 extends Python with contextual (soft) keywords for LLM calls (`ask`), agentic loops (`agent`), boolean evaluation (`decide`), dynamic prompt constraints (`enforce`, `forbid`), capability sandboxing (`restrict`), and structured program termination (`success`, `failure`), along with built-in tools and Model Context Protocol (MCP) support.

## Repository Layout

- [`lang/`](./lang) — Python compiler, linter, runtime library, Textual `--realtime` TUI, and `spl2` CLI package.
- [`vscode/`](./vscode) — VS Code extension providing `.spl2` TextMate syntax highlighting, static lint diagnostics, and Pylance/Pyright language server integration.
- [`doc/`](./doc) — Documentation templates (`doc/doc-templates/*.md`) and static HTML documentation generator (`doc/build.mjs`).
