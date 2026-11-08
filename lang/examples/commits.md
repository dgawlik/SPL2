---
extension: 'semantic-prompt-language'
version: 1
model: 'gpt-6-luna'
---

```spl2
from pydantic import BaseModel, Field

class Commit(BaseModel):
    hash: str
    title: str
```

> List 10 latest commits in this repository @validate[Commit] retry on failure and save to @commits 

```spl2 

hashes = []

for c in commits:
    print(f'\n Commit {c.hash}: \n' 
        + f"{c.title}\n\n")
    hashes.append(c.hash)

success {'hashes': hashes}
```