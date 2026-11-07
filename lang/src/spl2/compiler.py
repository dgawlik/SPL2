"""SPL2 Token-Stream Preprocessor, Static Linter, and AST Transformer."""

from __future__ import annotations

import ast
import io
import keyword
import tokenize
from dataclasses import dataclass, field
from typing import Any

SPL2_KEYWORDS = frozenset(
    {"ask", "agent", "decide", "enforce", "forbid", "restrict", "success", "failure"}
)
EXPR_KEYWORDS = frozenset({"ask", "agent", "decide"})
BLOCK_KEYWORDS = frozenset({"enforce", "forbid", "restrict"})
TERM_KEYWORDS = frozenset({"success", "failure"})

COMMON_MODIFIERS = frozenset(
    {"len", "fmt", "schema", "tokens", "retries", "thinking", "files", "model"}
)
AGENT_ONLY_MODIFIERS = frozenset({"tools", "mcp", "max_steps"})
DECIDE_EXTRA_MODIFIERS = frozenset({"data"})
RESTRICT_MODIFIERS = frozenset({"fs", "net", "exec", "mcp"})

ALLOWED_MODIFIERS: dict[str, frozenset[str]] = {
    "ask": COMMON_MODIFIERS,
    "agent": COMMON_MODIFIERS | AGENT_ONLY_MODIFIERS,
    "decide": COMMON_MODIFIERS | DECIDE_EXTRA_MODIFIERS,
    "restrict": RESTRICT_MODIFIERS,
}

VALID_FMT_VALUES = frozenset(
    {"text", "object", "array", "string", "float", "int", "bool"}
)
VALID_THINKING_VALUES = frozenset({"none", "low", "medium", "high", "max"})

FSTRING_START = getattr(tokenize, "FSTRING_START", None)
FSTRING_MIDDLE = getattr(tokenize, "FSTRING_MIDDLE", None)
FSTRING_END = getattr(tokenize, "FSTRING_END", None)
TSTRING_START = getattr(tokenize, "TSTRING_START", None)
TSTRING_MIDDLE = getattr(tokenize, "TSTRING_MIDDLE", None)
TSTRING_END = getattr(tokenize, "TSTRING_END", None)

NON_SIG_TOKENS = frozenset(
    {
        tokenize.NL,
        tokenize.COMMENT,
        tokenize.ENCODING,
    }
)

AUG_ASSIGN_OPS = frozenset(
    {
        "=",
        "+=",
        "-=",
        "*=",
        "/=",
        "//=",
        "%=",
        "**=",
        "&=",
        "|=",
        "^=",
        ">>=",
        "<<=",
        "@=",
    }
)

CLAUSE_STOP_KEYWORDS = frozenset(
    {
        "and",
        "or",
        "if",
        "else",
        "elif",
        "for",
        "in",
        "is",
        "as",
        "while",
        "with",
        "except",
        "finally",
        "return",
        "yield",
        "pass",
        "break",
        "continue",
        "raise",
        "del",
        "global",
        "nonlocal",
        "assert",
        "import",
        "from",
        "def",
        "class",
        "try",
        "lambda",
    }
)


@dataclass(frozen=True)
class LintDiagnostic:
    """Represents a compile-time SPL2 lint or syntax diagnostic."""

    filename: str
    lineno: int
    col_offset: int  # 1-based column for human display
    message: str
    rule: str = "syntax"
    source_line: str = ""
    end_lineno: int | None = None
    end_col_offset: int | None = None

    def format(self) -> str:
        col = max(1, self.col_offset)
        header = f"{self.filename}:{self.lineno}:{col}: error [{self.rule}]: {self.message}"
        if not self.source_line:
            return header
        stripped_line = self.source_line.rstrip("\r\n")
        caret_pos = max(0, min(col - 1, len(stripped_line)))
        span_len = 1
        if (
            self.end_lineno == self.lineno
            and self.end_col_offset is not None
            and self.end_col_offset > col
        ):
            span_len = max(1, self.end_col_offset - col)
        pointer = " " * caret_pos + "^" + ("~" * (span_len - 1))
        return f"{header}\n    {stripped_line}\n    {pointer}"


class SPL2SyntaxError(Exception):
    """Raised when one or more SPL2 compile-time lint or syntax errors occur."""

    def __init__(self, diagnostics: list[LintDiagnostic]) -> None:
        self.diagnostics = diagnostics
        self.lineno = diagnostics[0].lineno if diagnostics else 1
        self.col_offset = diagnostics[0].col_offset if diagnostics else 1
        self.filename = diagnostics[0].filename if diagnostics else "<spl2>"
        super().__init__("\n".join(d.format() for d in diagnostics))


@dataclass
class ColumnAnchor:
    """Maps a generated Python column back to the original .spl2 column on a line."""

    gen_col: int
    orig_col: int


@dataclass
class PreprocessedResult:
    """Output of the SPL2 token-stream preprocessor."""

    source: str
    original_lines: list[str]
    line_anchors: dict[int, list[ColumnAnchor]] = field(default_factory=dict)

    def map_col_to_orig(self, lineno: int, gen_col: int) -> int:
        """Convert 0-based generated column to 0-based original .spl2 column."""
        anchors = self.line_anchors.get(lineno)
        if not anchors:
            return max(0, gen_col)
        best_gen = 0
        best_orig = 0
        for anchor in anchors:
            if anchor.gen_col <= gen_col:
                best_gen = anchor.gen_col
                best_orig = anchor.orig_col
            else:
                break
        return max(0, best_orig + (gen_col - best_gen))

    def map_col_to_gen(self, lineno: int, orig_col: int) -> int:
        """Convert 0-based original .spl2 column to 0-based generated column."""
        anchors = self.line_anchors.get(lineno)
        if not anchors:
            return max(0, orig_col)
        best_gen = 0
        best_orig = 0
        for anchor in anchors:
            if anchor.orig_col <= orig_col:
                best_gen = anchor.gen_col
                best_orig = anchor.orig_col
            else:
                break
        return max(0, best_gen + (orig_col - best_orig))


@dataclass
class _SpanEdit:
    """Represents a surgical edit on the source string at (row, col) coordinates."""

    start_row: int  # 1-based
    start_col: int  # 0-based
    end_row: int  # 1-based
    end_col: int  # 0-based
    replacement: str
    order: int = 0


def _is_expr_starter(tok: tokenize.TokenInfo) -> bool:
    """Return True if tok can begin a prompt expression after ask/agent/decide."""
    if tok.type == tokenize.STRING:
        return True
    if FSTRING_START is not None and tok.type == FSTRING_START:
        return True
    if TSTRING_START is not None and tok.type == TSTRING_START:
        return True
    if tok.type == tokenize.NUMBER:
        return True
    if tok.type == tokenize.OP and tok.string in {"(", "[", "{", "~"}:
        return True
    if tok.type == tokenize.NAME:
        if tok.string in {"True", "False", "None", "not", "await"}:
            return True
        if tok.string in CLAUSE_STOP_KEYWORDS or keyword.iskeyword(tok.string):
            return False
        return True
    return False


def _next_sig_index(tokens: list[tokenize.TokenInfo], idx: int) -> int:
    """Return index of the next significant token at or after idx, or len(tokens)."""
    n = len(tokens)
    while idx < n and tokens[idx].type in NON_SIG_TOKENS:
        idx += 1
    return idx


def _prev_sig_index(tokens: list[tokenize.TokenInfo], idx: int) -> int:
    """Return index of the previous significant token at or before idx, or -1."""
    while idx >= 0 and tokens[idx].type in NON_SIG_TOKENS:
        idx -= 1
    return idx


def _find_matching_paren(tokens: list[tokenize.TokenInfo], open_idx: int) -> int:
    """Given index of '(', '[', or '{', return index of matching closer or -1."""
    depth = 0
    for i in range(open_idx, len(tokens)):
        t = tokens[i]
        if t.type == tokenize.OP:
            if t.string in {"(", "[", "{"}:
                depth += 1
            elif t.string in {")", "]", "}"}:
                depth -= 1
                if depth == 0:
                    return i
    return -1


def _parens_inspect(
    tokens: list[tokenize.TokenInfo], open_idx: int, close_idx: int
) -> tuple[bool, bool, int, bool]:
    """Inspect tokens inside (...) between open_idx and close_idx.

    Returns (is_empty, has_keyword_or_star_arg, top_level_comma_count, ends_with_comma).
    """
    sig_indices: list[int] = []
    depth = 0
    has_kw = False
    comma_count = 0
    for i in range(open_idx + 1, close_idx):
        t = tokens[i]
        if t.type in NON_SIG_TOKENS:
            continue
        sig_indices.append(i)
        if t.type == tokenize.OP:
            if t.string in {"(", "[", "{"}:
                depth += 1
                continue
            if t.string in {")", "]", "}"}:
                depth -= 1
                continue
            if depth == 0:
                if t.string == ",":
                    comma_count += 1
                elif t.string == "**":
                    has_kw = True
                elif t.string == "=" and len(sig_indices) >= 2:
                    prev_tok = tokens[sig_indices[-2]]
                    if prev_tok.type == tokenize.NAME:
                        has_kw = True
    is_empty = len(sig_indices) == 0
    ends_with_comma = bool(sig_indices and tokens[sig_indices[-1]].type == tokenize.OP and tokens[sig_indices[-1]].string == ",")
    return is_empty, has_kw, comma_count, ends_with_comma


def _scan_prompt_end(tokens: list[tokenize.TokenInfo], start_idx: int) -> int:
    """Scan a prompt expression starting at start_idx and return the last significant token index."""
    depth = 0
    fstring_depth = 0
    last_sig = start_idx
    i = start_idx
    n = len(tokens)
    while i < n:
        t = tokens[i]
        if t.type in NON_SIG_TOKENS:
            i += 1
            continue
        if FSTRING_START is not None and t.type == FSTRING_START:
            fstring_depth += 1
            last_sig = i
            i += 1
            continue
        if FSTRING_END is not None and t.type == FSTRING_END:
            fstring_depth = max(0, fstring_depth - 1)
            last_sig = i
            i += 1
            continue
        if depth == 0 and fstring_depth == 0:
            if t.type in {tokenize.NEWLINE, tokenize.ENDMARKER, tokenize.INDENT, tokenize.DEDENT}:
                break
            if t.type == tokenize.OP and t.string in {";", ",", ":", ")", "]", "}"}:
                break
            if t.type == tokenize.NAME and t.string in CLAUSE_STOP_KEYWORDS and i > start_idx:
                break
        if t.type == tokenize.OP:
            if t.string in {"(", "[", "{"}:
                depth += 1
            elif t.string in {")", "]", "}"}:
                depth -= 1
        last_sig = i
        i += 1
    return last_sig


def _is_in_def_params_or_import(tokens: list[tokenize.TokenInfo], idx: int) -> bool:
    """Check if token at idx is a parameter name in `def ...(...)` or part of an `import` statement."""
    # Walk backwards to start of current logical statement
    depth = 0
    j = idx - 1
    while j >= 0:
        t = tokens[j]
        if t.type in NON_SIG_TOKENS:
            j -= 1
            continue
        if t.type in {tokenize.NEWLINE, tokenize.INDENT, tokenize.DEDENT} and depth == 0:
            break
        if t.type == tokenize.OP and t.string == ";" and depth == 0:
            break
        if t.type == tokenize.OP:
            if t.string in {")", "]", "}"}:
                depth += 1
            elif t.string in {"(", "[", "{"}:
                if depth > 0:
                    depth -= 1
                else:
                    # We are inside an unclosed '(' at depth -1
                    prev_i = _prev_sig_index(tokens, j - 1)
                    if prev_i >= 0 and tokens[prev_i].type == tokenize.NAME:
                        prev_prev = _prev_sig_index(tokens, prev_i - 1)
                        if prev_prev >= 0 and tokens[prev_prev].type == tokenize.NAME and tokens[prev_prev].string == "def":
                            # Inside def foo(...): check if idx is before '=' in parameter
                            prev_Immediate = _prev_sig_index(tokens, idx - 1)
                            if prev_Immediate >= 0 and tokens[prev_Immediate].type == tokenize.OP and tokens[prev_Immediate].string in {"(", ",", "*", "**"}:
                                return True
        if depth == 0 and t.type == tokenize.NAME and t.string in {"import", "from"}:
            return True
        j -= 1
    return False


def _collect_defined_names(source: str, tokens: list[tokenize.TokenInfo]) -> set[str]:
    """Heuristically collect user-defined/bound SPL2 keyword names in the file.

    Used so that if a user explicitly defines e.g. `ask = ...` or `def ask(...):`,
    bare `ask` or `ask(x)` without a trailing prompt is recognized as a normal Python symbol.
    """
    bound: set[str] = set()
    n = len(tokens)
    for i, t in enumerate(tokens):
        if t.type == tokenize.NAME and t.string in SPL2_KEYWORDS:
            prev_i = _prev_sig_index(tokens, i - 1)
            next_i = _next_sig_index(tokens, i + 1)
            if prev_i >= 0 and tokens[prev_i].type == tokenize.NAME and tokens[prev_i].string in {"def", "class", "as", "for", "import"}:
                bound.add(t.string)
                continue
            if next_i < n and tokens[next_i].type == tokenize.OP and tokens[next_i].string in AUG_ASSIGN_OPS:
                # Check if this '=' is an assignment (not a keyword arg inside ask(...)/agent(...)/decide(...)/restrict(...))
                # If preceded by '(' or ',' inside a call, it's a keyword argument, unless it's a def parameter!
                if prev_i >= 0 and tokens[prev_i].type == tokenize.OP and tokens[prev_i].string in {"(", ",", "*", "**"}:
                    if _is_in_def_params_or_import(tokens, i):
                        bound.add(t.string)
                else:
                    bound.add(t.string)
    return bound


def preprocess_spl2(source: str, filename: str = "<spl2>") -> PreprocessedResult:
    """Preprocess SPL2 source code into valid Python source while preserving line numbers and column mappings."""
    original_lines = source.splitlines(keepends=True)
    if not original_lines:
        original_lines = [""]

    try:
        tokens = list(tokenize.generate_tokens(io.StringIO(source).readline))
    except tokenize.TokenError as exc:
        msg, (lineno, col) = exc.args
        line_text = original_lines[lineno - 1] if 1 <= lineno <= len(original_lines) else ""
        raise SPL2SyntaxError(
            [
                LintDiagnostic(
                    filename=filename,
                    lineno=lineno,
                    col_offset=max(1, col),
                    message=f"Token error: {msg}",
                    rule="syntax",
                    source_line=line_text,
                )
            ]
        ) from exc
    except IndentationError as exc:
        lineno = exc.lineno or 1
        col = exc.offset or 1
        line_text = original_lines[lineno - 1] if 1 <= lineno <= len(original_lines) else ""
        raise SPL2SyntaxError(
            [
                LintDiagnostic(
                    filename=filename,
                    lineno=lineno,
                    col_offset=max(1, col),
                    message=f"Indentation error: {exc.msg}",
                    rule="syntax",
                    source_line=line_text,
                )
            ]
        ) from exc

    user_bound_names = _collect_defined_names(source, tokens)
    edits: list[_SpanEdit] = []
    edit_counter = 0

    def add_edit(
        srow: int, scol: int, erow: int, ecol: int, replacement: str
    ) -> None:
        nonlocal edit_counter
        edit_counter += 1
        edits.append(_SpanEdit(srow, scol, erow, ecol, replacement, edit_counter))

    def is_statement_start(idx: int) -> bool:
        prev_i = _prev_sig_index(tokens, idx - 1)
        if prev_i < 0:
            return True
        pt = tokens[prev_i]
        if pt.type in {tokenize.NEWLINE, tokenize.INDENT, tokenize.DEDENT}:
            return True
        if pt.type == tokenize.OP and pt.string == ";":
            return True
        return False

    def is_simple_stmt_start(idx: int) -> bool:
        if is_statement_start(idx):
            return True
        prev_i = _prev_sig_index(tokens, idx - 1)
        if prev_i >= 0 and tokens[prev_i].type == tokenize.OP and tokens[prev_i].string == ":":
            # Check if this ':' is a suite header colon (e.g. `if cond: success 1` or `else: failure 'x'`)
            # Walk back to start of statement to see if it starts with if/elif/else/for/while/try/except/finally/with/def
            j = prev_i - 1
            depth = 0
            while j >= 0:
                tj = tokens[j]
                if tj.type in NON_SIG_TOKENS:
                    j -= 1
                    continue
                if tj.type in {tokenize.NEWLINE, tokenize.INDENT, tokenize.DEDENT} and depth == 0:
                    break
                if tj.type == tokenize.OP:
                    if tj.string in {")", "]", "}"}:
                        depth += 1
                    elif tj.string in {"(", "[", "{"}:
                        depth -= 1
                j -= 1
            stmt_first = _next_sig_index(tokens, j + 1)
            if stmt_first < prev_i and tokens[stmt_first].type == tokenize.NAME and tokens[stmt_first].string in {
                "if", "elif", "else", "for", "while", "try", "except", "finally", "with", "def", "async",
                "enforce", "forbid", "restrict",
            }:
                return True
        return False

    def find_header_colon(start_idx: int) -> tuple[int, bool]:
        """Find top-level ':' ending a block header starting at start_idx.

        Returns (colon_token_index, has_top_level_assign).
        """
        depth = 0
        has_assign = False
        i = start_idx
        n = len(tokens)
        while i < n:
            t = tokens[i]
            if t.type in NON_SIG_TOKENS:
                i += 1
                continue
            if depth == 0:
                if t.type in {tokenize.NEWLINE, tokenize.ENDMARKER}:
                    return -1, has_assign
                if t.type == tokenize.OP and t.string == ";":
                    return -1, has_assign
                if t.type == tokenize.OP and t.string in AUG_ASSIGN_OPS:
                    has_assign = True
                if t.type == tokenize.OP and t.string == ":":
                    # Check if there is a '=' after ':' at depth 0 on the same line (annotated assignment `enforce: int = 1`)
                    k = _next_sig_index(tokens, i + 1)
                    d2 = 0
                    while k < n:
                        tk = tokens[k]
                        if tk.type in NON_SIG_TOKENS:
                            k += 1
                            continue
                        if d2 == 0 and tk.type in {tokenize.NEWLINE, tokenize.ENDMARKER}:
                            break
                        if d2 == 0 and tk.type == tokenize.OP and tk.string == "=":
                            return -1, True
                        if tk.type == tokenize.OP:
                            if tk.string in {"(", "[", "{"}:
                                d2 += 1
                            elif tk.string in {")", "]", "}"}:
                                d2 -= 1
                        k += 1
                    return i, has_assign
            if t.type == tokenize.OP:
                if t.string in {"(", "[", "{"}:
                    depth += 1
                elif t.string in {")", "]", "}"}:
                    depth -= 1
            i += 1
        return -1, has_assign

    n = len(tokens)
    i = 0
    while i < n:
        tok = tokens[i]
        if tok.type != tokenize.NAME or tok.string not in SPL2_KEYWORDS:
            i += 1
            continue

        kw = tok.string
        prev_i = _prev_sig_index(tokens, i - 1)
        next_i = _next_sig_index(tokens, i + 1)

        # Never rewrite after '.', 'def', 'class', 'import', 'from', 'except', 'as', 'for'
        if prev_i >= 0:
            pt = tokens[prev_i]
            if pt.type == tokenize.OP and pt.string == ".":
                i += 1
                continue
            if pt.type == tokenize.NAME and pt.string in {
                "def",
                "class",
                "import",
                "from",
                "except",
                "as",
                "for",
            }:
                i += 1
                continue

        if _is_in_def_params_or_import(tokens, i):
            i += 1
            continue

        # Never rewrite when followed by '=' or augmented assignment (e.g. `ask = 1` or `foo(ask=1)`)
        if next_i < n and tokens[next_i].type == tokenize.OP and tokens[next_i].string in AUG_ASSIGN_OPS:
            i += 1
            continue

        # 1. Handle BLOCK_KEYWORDS: enforce, forbid, restrict
        if kw in BLOCK_KEYWORDS and is_statement_start(i):
            colon_idx, has_assign = find_header_colon(i + 1)
            if colon_idx >= 0 and (not has_assign or kw == "restrict"):
                srow, scol = tok.start
                erow, ecol = tok.end
                colon_tok = tokens[colon_idx]
                if kw in {"enforce", "forbid"}:
                    if next_i == colon_idx:
                        # Missing target expression: `enforce:` or `forbid:`
                        add_edit(srow, scol, colon_tok.start[0], colon_tok.start[1], f"with __spl2_{kw}__()")
                    else:
                        first_expr_tok = tokens[next_i]
                        add_edit(
                            srow,
                            scol,
                            first_expr_tok.start[0],
                            first_expr_tok.start[1],
                            f"with __spl2_{kw}__(",
                        )
                        add_edit(
                            colon_tok.start[0],
                            colon_tok.start[1],
                            colon_tok.start[0],
                            colon_tok.start[1],
                            ")",
                        )
                    i = next_i
                    continue
                elif kw == "restrict":
                    if next_i == colon_idx:
                        # `restrict:` with no parens
                        add_edit(srow, scol, colon_tok.start[0], colon_tok.start[1], "with __spl2_restrict__()")
                        i = colon_idx + 1
                        continue
                    elif tokens[next_i].type == tokenize.OP and tokens[next_i].string == "(":
                        close_p = _find_matching_paren(tokens, next_i)
                        if close_p >= 0 and _next_sig_index(tokens, close_p + 1) == colon_idx:
                            add_edit(srow, scol, erow, ecol, "with __spl2_restrict__")
                            i = next_i + 1
                            continue
                    # `restrict <something>:` without parens
                    first_expr_tok = tokens[next_i]
                    add_edit(
                        srow,
                        scol,
                        first_expr_tok.start[0],
                        first_expr_tok.start[1],
                        "with __spl2_restrict__(",
                    )
                    add_edit(
                        colon_tok.start[0],
                        colon_tok.start[1],
                        colon_tok.start[0],
                        colon_tok.start[1],
                        ")",
                    )
                    i = next_i
                    continue

        # 2. Handle TERM_KEYWORDS: success, failure
        if kw in TERM_KEYWORDS and is_simple_stmt_start(i):
            if next_i < n:
                nt = tokens[next_i]
                # Check if normal Python construct (e.g. `success.foo()`, `success[0] = 1`, `success: int = 1`, `success, failure = 1, 2`)
                if nt.type == tokenize.OP and nt.string in {".", ":", ","}:
                    i += 1
                    continue
                if nt.type == tokenize.OP and nt.string == "[":
                    # Distinguish `success [1, 2]` (SPL2 list literal) from `success[0] = 1`
                    close_b = _find_matching_paren(tokens, next_i)
                    after_b = _next_sig_index(tokens, close_b + 1) if close_b >= 0 else -1
                    if after_b >= 0 and after_b < n and tokens[after_b].type == tokenize.OP and tokens[after_b].string in AUG_ASSIGN_OPS:
                        i += 1
                        continue
                    if tok.end == nt.start and kw in user_bound_names:
                        i += 1
                        continue
                if nt.type == tokenize.OP and nt.string == "(" and kw in user_bound_names and tok.end == nt.start:
                    # User defined `def success(...)` and called `success(...)`
                    i += 1
                    continue

                srow, scol = tok.start
                erow, ecol = tok.end
                if nt.type in {tokenize.NEWLINE, tokenize.ENDMARKER, tokenize.DEDENT} or (
                    nt.type == tokenize.OP and nt.string == ";"
                ):
                    if kw not in user_bound_names:
                        default_arg = "None" if kw == "success" else "'Failure'"
                        add_edit(srow, scol, erow, ecol, f"__spl2_{kw}__({default_arg})")
                    i += 1
                    continue

                # Scan until end of simple statement (depth 0 NEWLINE, ';', or ENDMARKER)
                depth = 0
                last_sig = next_i
                k = next_i
                while k < n:
                    tk = tokens[k]
                    if tk.type in NON_SIG_TOKENS:
                        k += 1
                        continue
                    if depth == 0 and (
                        tk.type in {tokenize.NEWLINE, tokenize.ENDMARKER, tokenize.DEDENT}
                        or (tk.type == tokenize.OP and tk.string == ";")
                    ):
                        break
                    if tk.type == tokenize.OP:
                        if tk.string in {"(", "[", "{"}:
                            depth += 1
                        elif tk.string in {")", "]", "}"}:
                            depth -= 1
                    last_sig = k
                    k += 1

                add_edit(srow, scol, nt.start[0], nt.start[1], f"__spl2_{kw}__(")
                end_tok = tokens[last_sig]
                add_edit(end_tok.end[0], end_tok.end[1], end_tok.end[0], end_tok.end[1], ")")
                # Continue scanning inside the expression so nested `ask`/`agent`/`decide` are also preprocessed!
                i = next_i
                continue

        # 3. Handle EXPR_KEYWORDS: ask, agent, decide
        if kw in EXPR_KEYWORDS and next_i < n:
            nt = tokens[next_i]
            srow, scol = tok.start
            erow, ecol = tok.end

            # Case 3a: Followed by '(' -> either modifier parens `ask(...) <prompt>` or parenthesized prompt `ask (...)`
            if nt.type == tokenize.OP and nt.string == "(":
                close_p = _find_matching_paren(tokens, next_i)
                if close_p >= 0:
                    after_p = _next_sig_index(tokens, close_p + 1)
                    has_trailing_prompt = after_p < n and _is_expr_starter(tokens[after_p])
                    is_empty, has_kw, comma_count, ends_with_comma = _parens_inspect(
                        tokens, next_i, close_p
                    )

                    if has_trailing_prompt:
                        # Definitely `ask(<modifiers>) <prompt_expr>`
                        prompt_end_idx = _scan_prompt_end(tokens, after_p)
                        prompt_first_tok = tokens[after_p]
                        prompt_last_tok = tokens[prompt_end_idx]
                        close_p_tok = tokens[close_p]

                        add_edit(srow, scol, erow, ecol, f"__spl2_{kw}__")
                        prefix = (
                            "__spl2_prompt__="
                            if (is_empty or ends_with_comma)
                            else ", __spl2_prompt__="
                        )
                        add_edit(
                            close_p_tok.start[0],
                            close_p_tok.start[1],
                            prompt_first_tok.start[0],
                            prompt_first_tok.start[1],
                            prefix,
                        )
                        add_edit(
                            prompt_last_tok.end[0],
                            prompt_last_tok.end[1],
                            prompt_last_tok.end[1] and prompt_last_tok.end[0] or prompt_last_tok.end[0],
                            prompt_last_tok.end[1],
                            ")",
                        )
                        i = next_i + 1
                        continue
                    else:
                        # No trailing prompt after ')'
                        if kw in user_bound_names and not has_kw:
                            # Normal call to user-defined function `ask(...)`
                            i += 1
                            continue
                        if not is_empty and not has_kw and comma_count == 0:
                            # Single positional parenthesized expression: `ask (prompt_expr)`
                            open_p_tok = tokens[next_i]
                            add_edit(
                                srow,
                                scol,
                                open_p_tok.end[0],
                                open_p_tok.end[1],
                                f"__spl2_{kw}__(__spl2_prompt__=(",
                            )
                            close_p_tok = tokens[close_p]
                            add_edit(
                                close_p_tok.end[0],
                                close_p_tok.end[1],
                                close_p_tok.end[0],
                                close_p_tok.end[1],
                                ")",
                            )
                            i = next_i + 1
                            continue
                        else:
                            # `ask()` or `ask(fmt='text')` or `ask(1, 2)` without a trailing prompt!
                            # Rewrite to `__spl2_ask__(...)` without `__spl2_prompt__` so Lint Rule 6 (and 1-5) catches it!
                            add_edit(srow, scol, erow, ecol, f"__spl2_{kw}__")
                            i = next_i + 1
                            continue

            # Case 3b: Followed directly by a prompt expression without modifier parens: `ask 'prompt'`
            elif _is_expr_starter(nt):
                prompt_end_idx = _scan_prompt_end(tokens, next_i)
                prompt_last_tok = tokens[prompt_end_idx]
                add_edit(
                    srow,
                    scol,
                    nt.start[0],
                    nt.start[1],
                    f"__spl2_{kw}__(__spl2_prompt__=",
                )
                add_edit(
                    prompt_last_tok.end[0],
                    prompt_last_tok.end[1],
                    prompt_last_tok.end[0],
                    prompt_last_tok.end[1],
                    ")",
                )
                i = next_i
                continue

        i += 1

    if not edits:
        return PreprocessedResult(source=source, original_lines=original_lines)

    # Apply edits while maintaining per-line column anchors
    # Note: all edits generated above are single-line or same-line-whitespace span replacements!
    # Wait: what if `ask(mods)\n 'prompt'` has a newline between `)` and `'prompt'`?
    # Let's handle multi-line span edits cleanly so line count never changes!
    line_edits: dict[int, list[_SpanEdit]] = {}
    for e in edits:
        if e.start_row == e.end_row:
            line_edits.setdefault(e.start_row, []).append(e)
        else:
            # Split across start_row and end_row so every intermediate newline is preserved!
            start_line_len = len(original_lines[e.start_row - 1].rstrip("\r\n"))
            line_edits.setdefault(e.start_row, []).append(
                _SpanEdit(e.start_row, e.start_col, e.start_row, start_line_len, e.replacement, e.order)
            )
            for mid_row in range(e.start_row + 1, e.end_row):
                mid_len = len(original_lines[mid_row - 1].rstrip("\r\n"))
                line_edits.setdefault(mid_row, []).append(
                    _SpanEdit(mid_row, 0, mid_row, mid_len, "", e.order)
                )
            line_edits.setdefault(e.end_row, []).append(
                _SpanEdit(e.end_row, 0, e.end_row, e.end_col, "", e.order)
            )

    out_lines: list[str] = []
    line_anchors: dict[int, list[ColumnAnchor]] = {}

    for row_idx, orig_line in enumerate(original_lines, start=1):
        row_es = line_edits.get(row_idx)
        if not row_es:
            out_lines.append(orig_line)
            continue
        # Sort by (start_col, end_col, order)
        row_es.sort(key=lambda x: (x.start_col, x.end_col, x.order))
        body = orig_line.rstrip("\r\n")
        ending = orig_line[len(body) :]
        parts: list[str] = []
        anchors: list[ColumnAnchor] = [ColumnAnchor(0, 0)]
        cursor = 0
        gen_cursor = 0
        for e in row_es:
            if e.start_col > cursor:
                unchanged = body[cursor : e.start_col]
                parts.append(unchanged)
                gen_cursor += len(unchanged)
                cursor = e.start_col
            anchors.append(ColumnAnchor(gen_cursor, e.start_col))
            parts.append(e.replacement)
            gen_cursor += len(e.replacement)
            cursor = max(cursor, e.end_col)
            anchors.append(ColumnAnchor(gen_cursor, cursor))
        if cursor < len(body):
            parts.append(body[cursor:])
        out_lines.append("".join(parts) + ending)
        line_anchors[row_idx] = anchors

    return PreprocessedResult(
        source="".join(out_lines),
        original_lines=original_lines,
        line_anchors=line_anchors,
    )


def _extract_literal_value(node: ast.AST) -> tuple[bool, Any]:
    """If node is a compile-time literal (Constant or UnaryOp(-/+ Constant)), return (True, value)."""
    if isinstance(node, ast.Constant):
        return True, node.value
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)):
        if isinstance(node.operand, ast.Constant) and isinstance(
            node.operand.value, (int, float)
        ) and not isinstance(node.operand.value, bool):
            val = -node.operand.value if isinstance(node.op, ast.USub) else +node.operand.value
            return True, val
    if isinstance(node, (ast.List, ast.Tuple, ast.Dict, ast.Set)):
        # Non-scalar literal
        return True, node
    return False, None


class _ScopeCollector(ast.NodeVisitor):
    """Collects all variable/function/class/import/parameter names bound anywhere in the AST."""

    def __init__(self) -> None:
        self.bound_names: set[str] = set()

    def visit_Name(self, node: ast.Name) -> None:
        if isinstance(node.ctx, (ast.Store, ast.Param)):
            self.bound_names.add(node.id)
        self.generic_visit(node)

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self.bound_names.add(node.name)
        for arg in (
            node.args.posonlyargs
            + node.args.args
            + node.args.kwonlyargs
            + ([node.args.vararg] if node.args.vararg else [])
            + ([node.args.kwarg] if node.args.kwarg else [])
        ):
            self.bound_names.add(arg.arg)
        self.generic_visit(node)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self.bound_names.add(node.name)
        for arg in (
            node.args.posonlyargs
            + node.args.args
            + node.args.kwonlyargs
            + ([node.args.vararg] if node.args.vararg else [])
            + ([node.args.kwarg] if node.args.kwarg else [])
        ):
            self.bound_names.add(arg.arg)
        self.generic_visit(node)

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        self.bound_names.add(node.name)
        self.generic_visit(node)

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            self.bound_names.add(alias.asname or alias.name.split(".")[0])

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        for alias in node.names:
            self.bound_names.add(alias.asname or alias.name)

    def visit_ExceptHandler(self, node: ast.ExceptHandler) -> None:
        if node.name:
            self.bound_names.add(node.name)
        self.generic_visit(node)


class _SPL2LintVisitor(ast.NodeVisitor):
    """Validates the 6 SPL2 compile-time lint rules on the preprocessed AST."""

    def __init__(
        self,
        filename: str,
        prep: PreprocessedResult,
        bound_names: set[str],
    ) -> None:
        self.filename = filename
        self.prep = prep
        self.bound_names = bound_names
        self.diagnostics: list[LintDiagnostic] = []

    def _add_diag(
        self,
        node: ast.AST,
        message: str,
        rule: str,
        col_override: int | None = None,
    ) -> None:
        lineno = getattr(node, "lineno", 1)
        gen_col = col_override if col_override is not None else getattr(node, "col_offset", 0)
        orig_col0 = self.prep.map_col_to_orig(lineno, gen_col)
        end_lineno = getattr(node, "end_lineno", lineno)
        gen_end_col = getattr(node, "end_col_offset", None)
        orig_end_col1 = (
            self.prep.map_col_to_orig(end_lineno, gen_end_col) + 1
            if gen_end_col is not None and end_lineno == lineno
            else None
        )
        source_line = (
            self.prep.original_lines[lineno - 1]
            if 1 <= lineno <= len(self.prep.original_lines)
            else ""
        )
        self.diagnostics.append(
            LintDiagnostic(
                filename=self.filename,
                lineno=lineno,
                col_offset=orig_col0 + 1,
                message=message,
                rule=rule,
                source_line=source_line,
                end_lineno=end_lineno,
                end_col_offset=orig_end_col1,
            )
        )

    def _validate_llm_call(self, kind: str, node: ast.Call) -> None:
        allowed = ALLOWED_MODIFIERS[kind]
        has_prompt = False
        seen_modifiers: dict[str, ast.keyword] = {}

        # Positional arguments are not valid modifiers in ask(...)/agent(...)/decide(...)
        for pos_arg in node.args:
            self._add_diag(
                pos_arg,
                f"Positional arguments are not allowed in '{kind}(...)' modifiers; use keyword modifiers (e.g. fmt='text').",
                "unknown-modifier",
            )

        for kw in node.keywords:
            if kw.arg == "__spl2_prompt__":
                has_prompt = True
                continue
            if kw.arg is None:
                self._add_diag(
                    kw.value,
                    f"Keyword unpacking (**kwargs) is not supported in '{kind}(...)' modifiers.",
                    "unknown-modifier",
                )
                continue

            mod_name = kw.arg
            seen_modifiers[mod_name] = kw

            # Rule 5: Reject agent-only modifiers (tools, mcp, max_steps) when passed to ask or decide
            if kind in {"ask", "decide"} and mod_name in AGENT_ONLY_MODIFIERS:
                self._add_diag(
                    kw,
                    f"Modifier '{mod_name}' is an agent-only modifier and cannot be passed to '{kind}'.",
                    "agent-only-modifier",
                )
                continue

            # Rule 1: Reject unknown modifier keyword names
            if mod_name not in allowed:
                self._add_diag(
                    kw,
                    f"Unknown modifier '{mod_name}' on '{kind}(...)'. Allowed modifiers: {', '.join(sorted(allowed))}.",
                    "unknown-modifier",
                )
                continue

            # Rule 3: Validate literal values for fmt and thinking
            if mod_name == "fmt":
                is_lit, val = _extract_literal_value(kw.value)
                if is_lit and (not isinstance(val, str) or val not in VALID_FMT_VALUES):
                    self._add_diag(
                        kw.value,
                        f"Invalid literal value {val!r} for 'fmt'. Expected one of: {', '.join(repr(x) for x in sorted(VALID_FMT_VALUES))}.",
                        "invalid-literal-modifier",
                    )
            elif mod_name == "thinking":
                is_lit, val = _extract_literal_value(kw.value)
                if is_lit and (not isinstance(val, str) or val not in VALID_THINKING_VALUES):
                    self._add_diag(
                        kw.value,
                        f"Invalid literal value {val!r} for 'thinking'. Expected one of: {', '.join(repr(x) for x in sorted(VALID_THINKING_VALUES))}.",
                        "invalid-literal-modifier",
                    )

            # Rule 4: Reject negative or non-integer literals for retries, tokens, and max_steps
            elif mod_name in {"retries", "tokens", "max_steps"}:
                is_lit, val = _extract_literal_value(kw.value)
                if is_lit:
                    if isinstance(val, bool) or not isinstance(val, int):
                        self._add_diag(
                            kw.value,
                            f"Modifier '{mod_name}' requires an integer literal, got {type(val).__name__}.",
                            "invalid-numeric-modifier",
                        )
                    elif mod_name == "retries" and val < 0:
                        self._add_diag(
                            kw.value,
                            f"Modifier 'retries' cannot be negative (got {val}).",
                            "invalid-numeric-modifier",
                        )
                    elif mod_name in {"tokens", "max_steps"} and val <= 0:
                        self._add_diag(
                            kw.value,
                            f"Modifier '{mod_name}' must be a positive integer (got {val}).",
                            "invalid-numeric-modifier",
                        )

        # Rule 2: Enforce mutual exclusion of fmt and schema
        if "fmt" in seen_modifiers and "schema" in seen_modifiers:
            self._add_diag(
                seen_modifiers["schema"],
                f"Modifiers 'fmt' and 'schema' are mutually exclusive on '{kind}(...)'.",
                "mutually-exclusive-modifiers",
            )

        # Rule 6: Missing prompt expression after ask, agent, decide
        if not has_prompt:
            self._add_diag(
                node,
                f"Missing prompt expression after '{kind}'.",
                "missing-expression",
            )

    def _validate_restrict_call(self, node: ast.Call) -> None:
        # Rule 6: Reject empty restrict() calls with no arguments
        if not node.args and not node.keywords:
            self._add_diag(
                node,
                "Empty 'restrict()' call with no arguments; specify at least one of fs, net, exec, or mcp.",
                "missing-expression",
            )
            return

        for pos_arg in node.args:
            self._add_diag(
                pos_arg,
                "Positional arguments are not allowed in 'restrict(...)'; use keyword arguments (fs, net, exec, mcp).",
                "unknown-modifier",
            )

        for kw in node.keywords:
            if kw.arg is None or kw.arg not in RESTRICT_MODIFIERS:
                self._add_diag(
                    kw,
                    f"Unknown modifier '{kw.arg}' on 'restrict(...)'. Allowed modifiers: fs, net, exec, mcp.",
                    "unknown-modifier",
                )

    def visit_Call(self, node: ast.Call) -> None:
        if isinstance(node.func, ast.Name):
            fn = node.func.id
            if fn in {"__spl2_ask__", "__spl2_agent__", "__spl2_decide__"}:
                kind = fn.removeprefix("__spl2_").removesuffix("__")
                self._validate_llm_call(kind, node)
            elif fn == "__spl2_restrict__" or (
                fn == "restrict" and "restrict" not in self.bound_names
            ):
                self._validate_restrict_call(node)
            elif fn in {"__spl2_enforce__", "__spl2_forbid__"}:
                kind = fn.removeprefix("__spl2_").removesuffix("__")
                if not node.args and not node.keywords:
                    self._add_diag(
                        node,
                        f"Missing target expression after '{kind}'.",
                        "missing-expression",
                    )
        self.generic_visit(node)

    def visit_Name(self, node: ast.Name) -> None:
        if (
            isinstance(node.ctx, ast.Load)
            and node.id in {"ask", "agent", "decide", "enforce", "forbid", "restrict"}
            and node.id not in self.bound_names
        ):
            if node.id == "restrict":
                self._add_diag(
                    node,
                    "Empty 'restrict' without arguments; specify at least one of fs, net, exec, or mcp.",
                    "missing-expression",
                )
            else:
                self._add_diag(
                    node,
                    f"Missing prompt/target expression after '{node.id}'.",
                    "missing-expression",
                )
        self.generic_visit(node)


class _SPL2ASTTransformer(ast.NodeTransformer):
    """Transforms validated __spl2_*__ AST helpers into runtime calls."""

    def _transform_helper_call(self, node: ast.Call, is_async: bool = False) -> ast.AST:
        if not isinstance(node.func, ast.Name):
            return self.generic_visit(node)

        fn = node.func.id
        if fn in {"__spl2_ask__", "__spl2_agent__", "__spl2_decide__"}:
            kind = fn.removeprefix("__spl2_").removesuffix("__")
            runtime_fn = f"{kind}_{'async' if is_async else 'sync'}"
            prompt_expr: ast.expr = ast.Constant(value="")
            new_keywords: list[ast.keyword] = []
            for kw in node.keywords:
                if kw.arg == "__spl2_prompt__":
                    prompt_expr = self.visit(kw.value)
                else:
                    new_keywords.append(
                        ast.copy_location(
                            ast.keyword(arg=kw.arg, value=self.visit(kw.value)),
                            kw,
                        )
                    )
            new_keywords.append(
                ast.copy_location(
                    ast.keyword(
                        arg="__lineno__",
                        value=ast.Constant(value=getattr(node, "lineno", 1)),
                    ),
                    node,
                )
            )
            call_node = ast.Call(
                func=ast.Attribute(
                    value=ast.Name(id="__spl2_runtime__", ctx=ast.Load()),
                    attr=runtime_fn,
                    ctx=ast.Load(),
                ),
                args=[prompt_expr],
                keywords=new_keywords,
            )
            return ast.copy_location(call_node, node)

        if fn in {"__spl2_enforce__", "__spl2_forbid__"}:
            kind = fn.removeprefix("__spl2_").removesuffix("__")
            args = [self.visit(a) for a in node.args]
            call_node = ast.Call(
                func=ast.Attribute(
                    value=ast.Name(id="__spl2_runtime__", ctx=ast.Load()),
                    attr=f"{kind}_scope",
                    ctx=ast.Load(),
                ),
                args=args,
                keywords=[],
            )
            return ast.copy_location(call_node, node)

        if fn == "__spl2_restrict__":
            keywords = [
                ast.copy_location(
                    ast.keyword(arg=kw.arg, value=self.visit(kw.value)),
                    kw,
                )
                for kw in node.keywords
            ]
            call_node = ast.Call(
                func=ast.Attribute(
                    value=ast.Name(id="__spl2_runtime__", ctx=ast.Load()),
                    attr="restrict_scope",
                    ctx=ast.Load(),
                ),
                args=[],
                keywords=keywords,
            )
            return ast.copy_location(call_node, node)

        if fn in {"__spl2_success__", "__spl2_failure__"}:
            kind = fn.removeprefix("__spl2_").removesuffix("__")
            args = [self.visit(a) for a in node.args]
            keywords = [
                ast.copy_location(
                    ast.keyword(
                        arg="lineno",
                        value=ast.Constant(value=getattr(node, "lineno", 1)),
                    ),
                    node,
                )
            ]
            call_node = ast.Call(
                func=ast.Attribute(
                    value=ast.Name(id="__spl2_runtime__", ctx=ast.Load()),
                    attr=f"trigger_{kind}",
                    ctx=ast.Load(),
                ),
                args=args,
                keywords=keywords,
            )
            return ast.copy_location(call_node, node)

        return self.generic_visit(node)

    def visit_Await(self, node: ast.Await) -> ast.AST:
        if (
            isinstance(node.value, ast.Call)
            and isinstance(node.value.func, ast.Name)
            and node.value.func.id in {"__spl2_ask__", "__spl2_agent__", "__spl2_decide__"}
        ):
            transformed_call = self._transform_helper_call(node.value, is_async=True)
            return ast.copy_location(ast.Await(value=transformed_call), node)
        return self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> ast.AST:
        return self._transform_helper_call(node, is_async=False)


def parse_and_validate_spl2(
    source: str, filename: str = "<spl2>"
) -> tuple[ast.Module, PreprocessedResult, list[LintDiagnostic]]:
    """Preprocess, parse with ast.parse, and run static lint rules on SPL2 source."""
    try:
        prep = preprocess_spl2(source, filename=filename)
    except SPL2SyntaxError as exc:
        return ast.Module(body=[], type_ignores=[]), PreprocessedResult(source, source.splitlines(keepends=True)), exc.diagnostics

    try:
        tree = ast.parse(prep.source, filename=filename)
    except SyntaxError as exc:
        lineno = exc.lineno or 1
        gen_col0 = max(0, (exc.offset or 1) - 1)
        orig_col0 = prep.map_col_to_orig(lineno, gen_col0)
        line_text = (
            prep.original_lines[lineno - 1]
            if 1 <= lineno <= len(prep.original_lines)
            else (exc.text or "")
        )
        diag = LintDiagnostic(
            filename=filename,
            lineno=lineno,
            col_offset=orig_col0 + 1,
            message=f"SyntaxError: {exc.msg}",
            rule="syntax",
            source_line=line_text,
        )
        return ast.Module(body=[], type_ignores=[]), prep, [diag]

    scope_collector = _ScopeCollector()
    scope_collector.visit(tree)

    linter = _SPL2LintVisitor(
        filename=filename,
        prep=prep,
        bound_names=scope_collector.bound_names,
    )
    linter.visit(tree)
    return tree, prep, linter.diagnostics


def lint_spl2(source: str, filename: str = "<spl2>") -> list[LintDiagnostic]:
    """Run static lint and AST validation on SPL2 source, returning any diagnostics."""
    _, _, diagnostics = parse_and_validate_spl2(source, filename=filename)
    return diagnostics


def transform_spl2_ast(tree: ast.Module) -> ast.Module:
    """Transform validated SPL2 AST into executable Python AST."""
    transformer = _SPL2ASTTransformer()
    transformed = transformer.visit(tree)
    assert isinstance(transformed, ast.Module)
    # Inject `import spl2.runtime as __spl2_runtime__` at line 1 so it works both via CLI and importer
    import_node = ast.Import(
        names=[ast.alias(name="spl2.runtime", asname="__spl2_runtime__")],
        lineno=1,
        col_offset=0,
    )
    # Keep `from __future__ import ...` first if present
    insert_pos = 0
    for idx, stmt in enumerate(transformed.body):
        if isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Constant) and isinstance(stmt.value.value, str):
            insert_pos = idx + 1
            continue
        if isinstance(stmt, ast.ImportFrom) and stmt.module == "__future__":
            insert_pos = idx + 1
            continue
        break
    transformed.body.insert(insert_pos, import_node)
    ast.fix_missing_locations(transformed)
    return transformed


def compile_spl2(source: str, filename: str = "<spl2>"):
    """Compile SPL2 source code into Python bytecode after static lint and AST transformation."""
    tree, _, diagnostics = parse_and_validate_spl2(source, filename=filename)
    if diagnostics:
        raise SPL2SyntaxError(diagnostics)
    transformed = transform_spl2_ast(tree)
    return compile(transformed, filename=filename, mode="exec")


def transpile_spl2(source: str, filename: str = "<spl2>") -> str:
    """Transpile SPL2 source code into executable Python source while preserving original line numbers."""
    tree, prep, diagnostics = parse_and_validate_spl2(source, filename=filename)
    if diagnostics:
        raise SPL2SyntaxError(diagnostics)

    # Also rewrite `await __spl2_ask__(...)` in prep.source to `await __spl2_async_ask__(...)`
    # so the transpiled source has exact 1-to-1 line alignment with the original .spl2 file!
    lines = prep.source.splitlines(keepends=True)
    # Replace `__spl2_ask__(` preceded by `await` with `__spl2_async_ask__(` etc.
    import re

    transpiled_body = "".join(lines)
    transpiled_body = re.sub(
        r"\bawait(\s+)__spl2_(ask|agent|decide)__\(",
        r"await\1__spl2_async_\2__(",
        transpiled_body,
    )
    prelude = (
        "from spl2.runtime import (\n"
        "    _emit_py_ask as __spl2_ask__,\n"
        "    _emit_py_async_ask as __spl2_async_ask__,\n"
        "    _emit_py_agent as __spl2_agent__,\n"
        "    _emit_py_async_agent as __spl2_async_agent__,\n"
        "    _emit_py_decide as __spl2_decide__,\n"
        "    _emit_py_async_decide as __spl2_async_decide__,\n"
        "    enforce_scope as __spl2_enforce__,\n"
        "    forbid_scope as __spl2_forbid__,\n"
        "    restrict_scope as __spl2_restrict__,\n"
        "    trigger_success as __spl2_success__,\n"
        "    trigger_failure as __spl2_failure__,\n"
        ")  # fmt: skip\n"
    )
    # To preserve exact line numbers in the emitted file, put the prelude on line 1 if possible or comment-indexed:
    single_line_prelude = (
        "from spl2.runtime import _emit_py_ask as __spl2_ask__, _emit_py_async_ask as __spl2_async_ask__, "
        "_emit_py_agent as __spl2_agent__, _emit_py_async_agent as __spl2_async_agent__, "
        "_emit_py_decide as __spl2_decide__, _emit_py_async_decide as __spl2_async_decide__, "
        "enforce_scope as __spl2_enforce__, forbid_scope as __spl2_forbid__, "
        "restrict_scope as __spl2_restrict__, trigger_success as __spl2_success__, "
        "trigger_failure as __spl2_failure__; "
    )
    if transpiled_body.startswith("#!") or transpiled_body.lstrip().startswith("from __future__"):
        return prelude + transpiled_body
    return single_line_prelude + transpiled_body
