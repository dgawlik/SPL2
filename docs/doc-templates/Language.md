# The SPL2 Language

SPL2 is a true syntactic superset of Python 3.10+. Every valid Python construct—classes, decorators, list comprehensions, `try`/`except`, type annotations, and `async`/`await`—works unchanged inside `.spl2` files.

## Contextual Soft Keywords

SPL2 introduces eight contextual (soft) keywords:

| Keyword | Role | Syntactic Form |
| --- | --- | --- |
| `ask` | Single-turn, tool-free LLM call | `ask(...) <prompt>` or `ask <prompt>` |
| `agent` | Autonomous tool-calling loop | `agent(...) <prompt>` or `agent <prompt>` |
| `decide` | Boolean natural-language predicate | `decide(...) <prompt>` or `decide <prompt>` |
| `enforce` | Scoped positive LLM instruction | `enforce <expr>:` |
| `forbid` | Scoped negative LLM instruction | `forbid <expr>:` |
| `restrict` | Scoped capability sandbox | `restrict(fs=..., net=..., exec=..., mcp=...):` |
| `success` | Immediate `"ok"` termination | `success <expr>` |
| `failure` | Immediate `"failure"` termination | `failure <expr>` |

Because these keywords are contextual (like Python's `match` and `case`), they remain valid variable, parameter, function, and attribute names everywhere else:

```spl2
def format_status(ask: str, success: bool = True) -> dict:
    return {'prompt': ask, 'ok': success}

res = format_status('hello', success=True)
success res
```

## Prompt Expressions & Strings

`ask`, `agent`, `decide`, `enforce`, and `forbid` accept any Python string literal as well as any parenthesized or variable expression evaluating to a `str`:

* Plain strings (`'...'`, `"..."`, `'''...'''`) are literal and never perform implicit `{var}` interpolation, preserving literal JSON snippets in prompts.
* Formatted strings (`f'...'`, `f"""..."""`) perform standard Python interpolation.
* Variable or parenthesized expressions (`ask my_prompt` or `ask (prefix + suffix)`) evaluate dynamically at runtime.

## Concurrency & `async` Support

`ask`, `agent`, and `decide` work both synchronously and asynchronously:

* Standard calls (`res = ask(...) '...'`) execute synchronously using `openai.OpenAI`.
* Preceding a call with `await` inside an `async def` function (`res = await ask(...) '...'`) compiles to an asynchronous call using `openai.AsyncOpenAI`.

`async_workflow.spl2`

```spl2
import asyncio


async def summarize_aspect(topic: str, tone: str) -> str:
    enforce f'Write in a {tone} tone':
        return await ask(len='sentence') f'Explain {topic}'


async def main() -> dict:
    formal, playful = await asyncio.gather(
        summarize_aspect('quantum computing', 'formal academic'),
        summarize_aspect('quantum computing', 'playful pirate'),
    )
    return {'formal': formal, 'playful': playful}


success asyncio.run(main())
```

## Importing `.spl2` and Python Modules

SPL2 registers `importlib.abc.MetaPathFinder` and `SourceLoader` hooks when launched via `spl2`:

* Any standard-library or third-party Python package can be imported with `import` or `from ... import ...`.
* `.spl2` modules can import other `.spl2` modules seamlessly; imported `.spl2` files are compiled on the fly via the SPL2 loader.

## Built-in Tools Library

The five built-in agent tools can also be imported and called deterministically from `.spl2` code:

```spl2
from spl2.tools import read_file, write_file, shell, web_fetch, web_search

readme_text = read_file('PRD.md')
success {'characters': len(readme_text)}
```
