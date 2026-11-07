# End-to-End Examples

Explore complete `.spl2` scripts combining Pydantic structured outputs, autonomous agents, capability restrictions, boolean decisions, and `asyncio` concurrency.

## Structured Extraction with Pydantic

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

## Sandboxed Repository Agent

`repo_agent.spl2`

```spl2
restrict(fs='.', exec='git,pytest'):
    files = agent(fmt='array', thinking='medium', retries=1) 'List all the files in current repository and pass paths to json array'
    success {'files': files}
```

## Scoped Constraints & Boolean Decision Guard

`decide_guard.spl2`

```spl2
enforce 'Answer in Chinese':
    forbid 'Mentioning word cat':
        story = ask 'Funny story about a pet'

if decide(data='Calculation is 3*3') 'The result of calculation is 9':
    success {'status': 'ok', 'story': story}
else:
    failure 'LLM made mistake'
```

## Concurrent `async` / `await` Tasks with Isolated Contexts

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
