---
extension: 'semantic-prompt-language'
version: 1
model: 'gpt-4.1'
---

# Automated Repository Code Review

Reviews source files with scoped restrictions, validates structured findings against a Pydantic schema, and writes a Markdown report.

> @FORBID suggesting purely stylistic changes
>
> @RESTRICT fs['./src'] exec['git']
>
> List source files with `git ls-files src`.
> Then read the files most likely to contain security problems or correctness bugs, and review only those.
> List each finding with its location, why it matters, and a suggested fix. Save to @notes

```spl2
from typing import Literal
from pydantic import BaseModel


class Finding(BaseModel):
    severity: Literal['low', 'medium', 'high']
    title: str
    location: str
    fix: str


class Review(BaseModel):
    findings: list[Finding]
```

> Convert @notes review into structured findings @validate[Review] and save to @review

```spl2
lines = ['# Review of repository', '']
high = 0
for f in review.findings:
    if f.severity == 'high':
        high += 1
    lines.append(f"- **{f.severity.upper()}** {f.title} ({f.location})")
    lines.append(f"  - Fix: {f.fix}")
lines.append('')
lines.append(f"{len(review.findings)} finding(s), {high} high severity")
```

> @RESTRICT fs['./reports']
>
> Write joined @lines to './reports/review.md'

```spl2
if high > 0:
    failure f'{high} high severity finding(s), see ./reports/review.md'
success '\n'.join(lines)
```
