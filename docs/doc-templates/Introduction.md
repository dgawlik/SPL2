# Reliable AI workflows in native Python

Semantic Prompt Language v2 (SPL2) is a syntactic superset of Python for building reliable LLM and agentic workflows with typed schemas, dynamic prompt constraints, and deterministic capability sandboxing.

`pydantic_person.spl2`

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
success sample_person
```

## Why SPL2?

1. **Full Python Ecosystem.** Import any Python standard-library module, Pydantic model, or third-party package alongside `.spl2` modules.
2. **Contextual Soft Keywords.** `ask`, `agent`, `decide`, `enforce`, `forbid`, `restrict`, `success`, and `failure` are contextual keywords that compile to Python bytecode while remaining valid variable and parameter names everywhere else.
3. **Compile-Time Linting.** `spl2 --check` validates modifier names, literal formats, numeric bounds, and required expressions before a single token is sent to an LLM.
4. **Dynamic Context Scoping.** `enforce`, `forbid`, and `restrict` blocks use `contextvars.ContextVar` so prompt rules and filesystem/network/shell/MCP guardrails propagate automatically across functions, threads, and `asyncio.gather()` tasks.

## How the Pipeline Works

1. **Token-Stream Preprocessor (`tokenize`).** Rewrites SPL2 contextual keyword forms into AST-compatible helper calls and context managers while preserving exact line (`lineno`) and column (`col_offset`) coordinates.
2. **AST Validation & Transformation (`ast.NodeTransformer`).** Parses the source with `ast.parse()`, enforces the 6 compile-time lint rules, and transforms constructs into synchronous or `async` runtime calls.
3. **Bytecode Execution & JSON Output Contract.** Compiles to native Python bytecode (`compile()`), routes `print()` and logs to `stderr`, and emits a single structured JSON envelope on `stdout`.

## Where Next

* [Getting started](Getting-started.md): install the `spl2` package, configure your OpenAI API key, and run your first script.
* [Language](Language.md): contextual keywords, Python string semantics, `async`/`await` concurrency, and `.spl2` module imports.
* [LLM & Agent calls](LLM-commands.md): `ask`, `agent`, `decide`, modifiers, Pydantic `schema=`, file attachments, and MCP tools.
* [Policies & sandboxing](Safety.md): `enforce`, `forbid`, `restrict` intersection, and `success` / `failure` output contracts.
* [CLI & runtime](CLI.md): `--check`, `--emit-py`, `--trace` record-and-replay caching, and `--realtime` Textual TUI.
* [Grammar & lint rules](Grammar.md): formal EBNF grammar and the 6 compile-time lint rules.
* [Examples](Examples.md): end-to-end SPL2 workflows.
