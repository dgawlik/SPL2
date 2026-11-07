# Grammar & Compile-Time Lint Rules

SPL2 extends the Python 3.10+ grammar with contextual keyword productions processed by a token-stream mapper (`tokenize`) and validated by an AST linter (`ast.NodeVisitor`).

## EBNF Grammar Extensions

```ebnf
spl2_module      = { python_stmt | spl2_stmt } ;

spl2_stmt        = enforce_stmt
                 | forbid_stmt
                 | restrict_stmt
                 | success_stmt
                 | failure_stmt ;

enforce_stmt     = "enforce" expr ":" suite ;
forbid_stmt      = "forbid" expr ":" suite ;
restrict_stmt    = "restrict" "(" restrict_kwargs ")" ":" suite ;

restrict_kwargs  = restrict_kwarg { "," restrict_kwarg } [ "," ] ;
restrict_kwarg   = ( "fs" | "net" | "exec" | "mcp" ) "=" expr ;

success_stmt     = "success" expr ;
failure_stmt     = "failure" expr ;

spl2_expr        = [ "await" ] ( ask_expr | agent_expr | decide_expr ) ;

ask_expr         = "ask" [ "(" [ modifier_kwargs ] ")" ] prompt_expr ;
agent_expr       = "agent" [ "(" [ agent_kwargs ] ")" ] prompt_expr ;
decide_expr      = "decide" [ "(" [ decide_kwargs ] ")" ] prompt_expr ;

prompt_expr      = STRING | FSTRING | "(" expr ")" | primary_expr ;
```

## Compile-Time Lint Rules

Both `spl2 --check` and normal execution enforce six static lint rules before any code runs, formatting diagnostics with filename, line, column, source snippet, and caret pointer:

1. **Unknown Modifier Rejection (`unknown-modifier`)**: Rejects unknown modifier keyword names or positional arguments on `ask(...)`, `agent(...)`, `decide(...)`, or `restrict(...)`.
2. **Mutual Exclusion (`mutually-exclusive-modifiers`)**: Rejects passing both `fmt` and `schema` on the same call.
3. **Literal Value Validation (`invalid-literal-modifier`)**: Validates literal values for `fmt` (`'text' | 'object' | 'array' | 'string' | 'float' | 'int' | 'bool'`) and `thinking` (`'none' | 'low' | 'medium' | 'high' | 'max'`).
4. **Numeric Modifier Validation (`invalid-numeric-modifier`)**: Rejects negative or non-integer literals (including booleans and floats) for `retries`, `tokens`, and `max_steps`.
5. **Agent-Only Modifier Guard (`agent-only-modifier`)**: Rejects passing `tools`, `mcp`, or `max_steps` to `ask` or `decide`.
6. **Required Expression & Non-Empty Restrict (`missing-expression`)**: Rejects empty `restrict()` calls with no arguments and missing prompt or target expressions after `ask`, `agent`, `decide`, `enforce`, or `forbid`.

Example lint output:

```text
example.spl2:1:9: error [agent-only-modifier]: Modifier 'max_steps' is an agent-only modifier and cannot be passed to 'ask'.
    x = ask(max_steps=5) 'Hello'
            ^~~~~~~~~~~
```
