# LLM & Agent Calls

SPL2 provides three specialized LLM execution keywords—`ask`, `agent`, and `decide`—backed by the OpenAI Responses API, Pydantic Structured Outputs, built-in tools, and Model Context Protocol (MCP) servers.

## Modifiers Reference

`ask`, `agent`, and `decide` accept optional keyword modifiers inside parentheses:

| Modifier | Applies To | Type / Values | Description |
| --- | --- | --- | --- |
| `len` | `ask`, `agent`, `decide` | `'word' \| 'sentence' \| 'paragraph' \| 'long'` or `str` | System prompt guidance instructing target response length |
| `fmt` | `ask`, `agent`, `decide` | `'text' \| 'object' \| 'array' \| 'string' \| 'float' \| 'int' \| 'bool'` | Output format validation and parsing (mutually exclusive with `schema`) |
| `schema` | `ask`, `agent`, `decide` | `type[BaseModel]` or `TypeAdapter` type | Validates and parses JSON output into a typed Python/Pydantic instance |
| `tokens` | `ask`, `agent`, `decide` | `int > 0` | Hard output token limit (`max_output_tokens`) |
| `retries` | `ask`, `agent`, `decide` | `int >= 0` (default `0`) | Self-repair retries on validation error and exponential backoff on transient API errors |
| `thinking` | `ask`, `agent`, `decide` | `'none' \| 'low' \| 'medium' \| 'high' \| 'max'` | Reasoning effort mapped to OpenAI reasoning configuration |
| `files` | `ask`, `agent`, `decide` | `str \| Path \| Sequence[str \| Path]` | Attaches UTF-8 text (`<file>`), images (`input_image`), and PDFs (`input_file`) |
| `model` | `ask`, `agent`, `decide` | `str` | Per-call model override |
| `data` | `decide` | `Any` | Structured evidence serialized into the predicate prompt |
| `tools` | `agent` only | `Sequence[str]` or comma-separated `str` | Allowlist of built-in tools enabled for this agent call |
| `mcp` | `agent` only | `str \| Sequence[str]` | Allowlist of MCP servers/tools (`"server"`, `"server/*"`, or `"server/tool"`) |
| `max_steps` | `agent` only | `int > 0` (default `25`) | Maximum tool-calling turns in the agent loop |

## `ask` — Single-Turn LLM Calls

`ask` executes a single-turn, tool-free LLM call. When `schema=` or `fmt=` is provided, the response is validated and parsed automatically; if validation fails and `retries > 0`, SPL2 feeds the validation error back to the model for self-repair.

```spl2
story = ask(len='paragraph', fmt='text') 'Funny office story'
numbers = ask(fmt='array', retries=1) 'Return the first 5 prime numbers as a JSON array'
```

## `agent` — Autonomous Tool Loops & MCP

`agent` runs an autonomous tool-calling loop bounded by `max_steps` (default `25`). By default, agents have access to five built-in tools:

* `read_file(path)`: Reads UTF-8 file contents from the workspace.
* `write_file(path, content)`: Writes UTF-8 content to a file, creating parent directories as needed.
* `shell(command)`: Executes a shell command in the platform default shell, returning combined stdout/stderr.
* `web_fetch(url)`: Fetches HTTP(S) content from a URL.
* `web_search(query)`: Performs a zero-config web search using the DuckDuckGo HTML endpoint (`html.duckduckgo.com`, overridable via `SPL2_SEARCH_URL`).

`repo_agent.spl2`

```spl2
restrict(fs='.', exec='git,pytest'):
    files = agent(fmt='array', thinking='medium', retries=1) 'List all the files in current repository and pass paths to json array'
    success {'files': files}
```

### MCP Configuration

Configure local (`stdio`) and remote (`http` / `sse`) MCP servers via `--mcp <config.json>` or `.mcp.json` in the working directory:

```json
{
  "mcpServers": {
    "docs": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    },
    "remoteApi": {
      "url": "https://mcp.example.com/sse",
      "headers": {
        "Authorization": "Bearer token"
      }
    }
  }
}
```

## `decide` — Boolean Predicate Evaluation

`decide` evaluates a natural-language predicate against optional structured `data=` evidence and returns a Python `bool` (`True` or `False`):

```spl2
if decide(data={'latency_ms': 42, 'slo_ms': 100}) 'The service latency is within the SLO':
    success {'healthy': True}
else:
    failure 'SLO breached'
```
