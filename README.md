# Semantic Prompt Language v2 (SPL2)

**Semantic Prompt Language v2 (SPL2)** is a syntactic superset of Python for building reliable LLM and agentic workflows in `.spl2` scripts and runnable Markdown (`.md`) documents.

SPL2 extends Python with contextual (soft) keywords for LLM calls (`ask`), agentic loops (`agent`), boolean evaluation (`decide`), dynamic prompt constraints (`enforce`, `forbid`), capability sandboxing (`restrict`), and structured program termination (`success`, `failure`), along with natural-language Markdown blockquotes (`> ...`), built-in tools, and Model Context Protocol (MCP) support.

## Repository Layout

- [`lang/`](./lang) — Python compiler, Markdown workflow parser, linter, runtime library, Textual `--realtime` TUI, and `spl2` CLI package.
- [`vscode/`](./vscode) — VS Code extension providing `.spl2` and runnable `.md` TextMate syntax highlighting, static lint diagnostics, and Pylance/Pyright language server integration.
- [`docs/`](./docs) — Documentation templates (`docs/doc-templates/*.md`) and static HTML documentation generator (`docs/build.mjs`).
