# Getting started with SPL2

Install the `spl2` runtime, configure your OpenAI or OpenAI-compatible endpoint, and run your first `.spl2` workflow in under two minutes.

## Installation

Install the `spl2` package from the `lang` directory using `pip`:

```bash
pip install -e ./lang
```

Verify that the `spl2` CLI is available:

```bash
spl2 --help
```

## Provider Configuration

SPL2 uses the official `openai` Python SDK (`Responses API` and Structured Outputs) and works with OpenAI as well as any OpenAI-compatible provider:

| Variable | Description |
| --- | --- |
| `OPENAI_API_KEY` | API key used for OpenAI Responses API calls |
| `OPENAI_BASE_URL` | Optional custom endpoint URL for OpenAI-compatible providers |
| `OPENAI_MODEL` / `SPL2_MODEL` | Default model when neither `--model` nor `model=` is specified |
| `SPL2_SEARCH_URL` | Optional DuckDuckGo HTML endpoint override for `web_search` |

Model selection follows strict precedence: CLI `--model` > per-call `model=` modifier > `OPENAI_MODEL` / `SPL2_MODEL` environment variable > default model (`gpt-4.1`).

## Your First Script

Create a file named `hello_ask.spl2`:

`hello_ask.spl2`

```spl2
result = ask(len='paragraph', fmt='text') 'Funny office story'
print('Generated story:', result)
success {'story': result}
```

Validate syntax and modifiers statically without making any API calls:

```bash
spl2 --check hello_ask.spl2
```

Inspect the transpiled Python code:

```bash
spl2 --emit-py hello_ask.spl2
```

Run the script with durable trace caching enabled:

```bash
spl2 --trace hello_ask.spl2
```

Standard `print()` output is routed to `stderr`, while `stdout` emits the structured JSON result envelope:

```json
{
  "status": "ok",
  "reason": null,
  "lineno": 3,
  "data": {
    "story": "..."
  }
}
```
