# SPL2 Runtime (`spl2`)

**Semantic Prompt Language v2 (SPL2)** is a syntactic superset of Python for building reliable LLM and agentic workflows.

## Installation

```bash
pip install -e ./lang
```

## CLI Usage

```bash
spl2 script.spl2 [args...]
spl2 --check script.spl2
spl2 --emit-py script.spl2
spl2 --trace script.spl2
spl2 --realtime script.spl2
```

## Conversation Example

[`mock_convesation.spl2`](./examples/mock_convesation.spl2) alternates three messages
each from Alice and Bob. Each speaker's generator is created once before the loop,
so it retains its position and stops after three messages. Prompts use multiline
f-strings to include the conversation so far.
