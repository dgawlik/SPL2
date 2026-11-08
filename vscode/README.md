# SPL2 for Visual Studio Code

Official VS Code extension for **Semantic Prompt Language v2 (`.spl2`)**.

## Features

- **TextMate Syntax Highlighting**: Highlights SPL2 contextual keywords (`ask`, `agent`, `decide`, `enforce`, `forbid`, `restrict`, `success`, `failure`), modifiers (`len`, `fmt`, `schema`, `tokens`, `retries`, `thinking`, `files`, `model`, `tools`, `mcp`, `max_steps`, `data`, `fs`, `net`, `exec`), and built-in tools alongside full Python syntax, including multiline strings with escaped quotes.
- **Compile-Time Lint & Python Syntax/Name Diagnostics**: Real-time validation of all 6 SPL2 lint rules plus Python syntax, indentation, f-string interpolation, and undefined variable (`NameError`) diagnostics with exact line and column ranges. Multiline triple-quoted prompts and f-strings preserve their contents and source positions.
- **Python & SPL2 Autocompletion**: Context-aware completions for Python keywords, built-in functions/types/exceptions (`print`, `len`, `range`, etc.), standard library and `pydantic` imports, built-in type and `BaseModel` methods, and SPL2 keywords/modifiers across `.spl2` files and runnable `.md` workflows.
- **Pylance / Pyright Integration**: Preprocesses `.spl2` buffers through the SPL2 token-stream mapper with bidirectional source mapping so Python language servers provide autocompletion, Pydantic `schema=` return type inference, hover documentation, and go-to-definition.
