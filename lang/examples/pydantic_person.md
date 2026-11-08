---
extension: 'semantic-prompt-language'
version: 1
model: 'gpt-4.1'
---

# Generate and Validate a Sample Person

This runnable Markdown workflow combines deterministic `spl2` code blocks (with Pydantic models) and natural-language blockquote agent steps in a single shared scope.

```spl2
from pydantic import BaseModel, Field


class Person(BaseModel):
    first_name: str = Field(..., min_length=1, max_length=50)
    last_name: str = Field(..., min_length=1, max_length=50)
    age: int = Field(..., ge=0, le=120, description="Age in years")
```

> Generate a sample person @validate[Person] and save to @person

```spl2
assert len(person.first_name) >= 1
success person
```
