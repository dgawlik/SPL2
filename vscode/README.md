# SPL2 for Visual Studio Code

Official VS Code extension for **Semantic Prompt Language v2 (`.spl2`)**.

## Features

- **TextMate Syntax Highlighting**: Highlights SPL2 contextual keywords (`ask`, `agent`, `decide`, `enforce`, `forbid`, `restrict`, `success`, `failure`), modifiers (`len`, `fmt`, `schema`, `tokens`, `retries`, `thinking`, `files`, `model`, `tools`, `mcp`, `max_steps`, `data`, `fs`, `net`, `exec`), and built-in tools alongside full Python syntax.
- **Compile-Time Lint Diagnostics**: Real-time validation of all 6 SPL2 lint rules with exact line and column ranges.
- **Pylance / Pyright Integration**: Preprocesses `.spl2` buffers through the SPL2 token-stream mapper with bidirectional source mapping so Python language servers provide autocompletion, Pydantic `schema=` return type inference, hover documentation, and go-to-definition.
