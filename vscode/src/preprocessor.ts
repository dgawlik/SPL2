import {
    CompletionItem,
    CompletionItemKind,
    Diagnostic,
    DiagnosticSeverity,
    Hover,
    Location,
    MarkupKind,
    Position,
    Range,
    SymbolInformation,
    SymbolKind,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

export const SPL2_KEYWORDS = ['ask', 'agent', 'decide', 'enforce', 'forbid', 'restrict', 'success', 'failure'] as const;
export const COMMON_MODIFIERS = ['len', 'fmt', 'schema', 'tokens', 'retries', 'thinking', 'files', 'model'] as const;
export const AGENT_ONLY_MODIFIERS = ['tools', 'mcp', 'max_steps'] as const;
export const DECIDE_EXTRA_MODIFIERS = ['data'] as const;
export const RESTRICT_MODIFIERS = ['fs', 'net', 'exec', 'mcp'] as const;
export const VALID_FMT_VALUES = ['text', 'object', 'array', 'string', 'float', 'int', 'bool'] as const;
export const VALID_THINKING_VALUES = ['none', 'low', 'medium', 'high', 'max'] as const;
export const BUILTIN_TOOLS = ['read_file', 'write_file', 'shell', 'web_fetch', 'web_search'] as const;

export const KEYWORD_DOCS: Record<string, string> = {
    ask: '**`ask`** — Executes a single-turn, tool-free LLM call using the OpenAI Responses API.\n\n```spl2\nresult = ask(len=\'paragraph\', fmt=\'text\') \'Funny office story\'\n```',
    agent: '**`agent`** — Runs an autonomous tool-calling loop (bounded by `max_steps`, default `25`) with built-in tools and MCP servers.\n\n```spl2\nfiles = agent(fmt=\'array\', thinking=\'medium\', retries=1) \'List all files\'\n```',
    decide: '**`decide`** — Evaluates a natural-language predicate and returns a Python `bool` (`True` or `False`).\n\n```spl2\nif decide(data=\'Calculation is 3*3\') \'The result is 9\':\n    success {\'status\': \'ok\'}\n```',
    enforce: '**`enforce <expr>:`** — Dynamically scopes a mandatory positive constraint (*"You MUST satisfy this constraint"*) to all nested LLM calls.',
    forbid: '**`forbid <expr>:`** — Dynamically scopes a mandatory negative constraint (*"You MUST NOT do this"*) to all nested LLM calls.',
    restrict: '**`restrict(fs=..., net=..., exec=..., mcp=...):`** — Enforces deterministic capability guardrails on built-in tools and `agent` tool calls within the block. Nested blocks intersect allowlists.',
    success: '**`success <expr>`** — Immediately terminates the program and emits `{"status": "ok", "reason": null, "lineno": ..., "data": <expr>}` to `stdout`.',
    failure: '**`failure <expr>`** — Immediately terminates the program with a non-zero exit code and emits `{"status": "failure", "reason": <expr>, "lineno": ..., "data": null}` to `stdout`.',
};

export const MODIFIER_DOCS: Record<string, string> = {
    len: '**`len`** (`\'word\' | \'sentence\' | \'paragraph\' | \'long\'` or custom `str`) — Prompt guidance instructing the LLM how long the answer should be.',
    fmt: '**`fmt`** (`\'text\' | \'object\' | \'array\' | \'string\' | \'float\' | \'int\' | \'bool\'`) — Output format validation and parsing. Mutually exclusive with `schema`.',
    schema: '**`schema`** (`type[BaseModel]` or `TypeAdapter`-compatible type) — Validates and parses JSON output into a typed Pydantic instance. Mutually exclusive with `fmt`.',
    tokens: '**`tokens`** (`int > 0`) — Hard output token limit passed as `max_output_tokens` to the OpenAI Responses API.',
    retries: '**`retries`** (`int >= 0`, default `0`) — Self-repair retry attempts on validation failure and exponential-backoff retries on transient API errors.',
    thinking: '**`thinking`** (`\'none\' | \'low\' | \'medium\' | \'high\' | \'max\'`) — Reasoning effort mapped to the OpenAI reasoning configuration.',
    files: '**`files`** (`str | Path | Sequence[str | Path]`) — Attaches UTF-8 text files (`<file path="...">`), images (`input_image`), and PDFs (`input_file`).',
    model: '**`model`** (`str`) — Per-call model override (`--model` CLI > `model=` > `OPENAI_MODEL` / `SPL2_MODEL` > default).',
    tools: '**`tools`** (`Sequence[str]`, `agent` only) — Allowlist of built-in tools enabled for this `agent` call.',
    mcp: '**`mcp`** (`str | Sequence[str]`) — Allowlist of MCP servers/tools (`"server"`, `"server/*"`, or `"server/tool"`).',
    max_steps: '**`max_steps`** (`int > 0`, default `25`, `agent` only) — Maximum number of tool-calling turns in the agent loop.',
    data: '**`data`** (`Any`, `decide` only) — Structured evidence serialized into the prompt for boolean predicate evaluation.',
    fs: '**`fs`** (`restrict` modifier) — Allowed filesystem directory/file paths (canonical path containment).',
    net: '**`net`** (`restrict` modifier) — Allowed hostnames or wildcard domains (`*.example.com`) for `web_fetch` and `web_search`.',
    exec: '**`exec`** (`restrict` modifier) — Allowed executable names for `shell`.',
};

export const TOOL_DOCS: Record<string, string> = {
    read_file: '**`read_file(path: str | Path) -> str`** — Reads UTF-8 file contents from the workspace (enforcing `restrict(fs=...)`).',
    write_file: '**`write_file(path: str | Path, content: str) -> str`** — Writes UTF-8 content to a file, creating parent directories as needed (enforcing `restrict(fs=...)`).',
    shell: '**`shell(command: str) -> str`** — Executes a shell command in the platform default shell, returning combined stdout/stderr (enforcing `restrict(exec=...)`).',
    web_fetch: '**`web_fetch(url: str) -> str`** — Fetches HTTP(S) content from a URL (enforcing `restrict(net=...)`).',
    web_search: '**`web_search(query: str) -> list[dict[str, str]]`** — Performs a zero-config web search via DuckDuckGo HTML (`SPL2_SEARCH_URL`) returning `[{title, url, snippet}]`.',
};

/** Single-line Python typing stub header so virtual Python documents keep 1-to-1 line numbers (or +1 header line). */
export const PYLANCE_TYPING_HEADER =
    'from typing import Any as _Any, TypeVar as _TypeVar, Literal as _Literal, overload as _overload; ' +
    'from contextlib import AbstractContextManager as _ACM; ' +
    '_T = _TypeVar("_T"); ' +
    '@_overload\ndef __spl2_ask__(*, schema: type[_T], __spl2_prompt__: str = "", **kw: _Any) -> _T: ...\n' +
    '@_overload\ndef __spl2_ask__(*, fmt: _Literal["int"], __spl2_prompt__: str = "", **kw: _Any) -> int: ...\n' +
    '@_overload\ndef __spl2_ask__(*, fmt: _Literal["float"], __spl2_prompt__: str = "", **kw: _Any) -> float: ...\n' +
    '@_overload\ndef __spl2_ask__(*, fmt: _Literal["bool"], __spl2_prompt__: str = "", **kw: _Any) -> bool: ...\n' +
    '@_overload\ndef __spl2_ask__(*, fmt: _Literal["array"], __spl2_prompt__: str = "", **kw: _Any) -> list[_Any]: ...\n' +
    '@_overload\ndef __spl2_ask__(*, fmt: _Literal["object"], __spl2_prompt__: str = "", **kw: _Any) -> dict[str, _Any]: ...\n' +
    '@_overload\ndef __spl2_ask__(*, __spl2_prompt__: str = "", **kw: _Any) -> str: ...\n' +
    'def __spl2_ask__(**kw: _Any) -> _Any: ...\n' +
    '@_overload\ndef __spl2_agent__(*, schema: type[_T], __spl2_prompt__: str = "", **kw: _Any) -> _T: ...\n' +
    '@_overload\ndef __spl2_agent__(*, fmt: _Literal["array"], __spl2_prompt__: str = "", **kw: _Any) -> list[_Any]: ...\n' +
    '@_overload\ndef __spl2_agent__(*, fmt: _Literal["object"], __spl2_prompt__: str = "", **kw: _Any) -> dict[str, _Any]: ...\n' +
    '@_overload\ndef __spl2_agent__(*, __spl2_prompt__: str = "", **kw: _Any) -> str: ...\n' +
    'def __spl2_agent__(**kw: _Any) -> _Any: ...\n' +
    'def __spl2_decide__(**kw: _Any) -> bool: ...\n' +
    'def __spl2_enforce__(expr: _Any = None) -> _ACM[None]: ...\n' +
    'def __spl2_forbid__(expr: _Any = None) -> _ACM[None]: ...\n' +
    'def __spl2_restrict__(**kw: _Any) -> _ACM[_Any]: ...\n' +
    'def __spl2_success__(val: _Any = None) -> None: ...\n' +
    'def __spl2_failure__(reason: _Any = None) -> None: ...\n' +
    'def __spl2_natural__(text: str, **kw: _Any) -> _Any: ...\n';

export const PYLANCE_HEADER_LINE_COUNT = PYLANCE_TYPING_HEADER.split('\n').length - 1;
export const EXTENSION = 'semantic-prompt-language';

export interface MarkdownBlock {
    kind: 'spl2' | 'natural';
    text: string;
    line: number; // 1-based
    endLine: number; // 1-based
}

export interface MarkdownDocument {
    version: number;
    model?: string;
    preamble?: string;
    blocks: MarkdownBlock[];
    code: string;
}

export class SPL2MarkdownError extends Error {
    constructor(
        message: string,
        public readonly line: number = 1,
        public readonly col: number = 1,
    ) {
        super(message);
    }
}

export interface ColumnAnchor {
    genCol: number;
    origCol: number;
}

export interface ClassFieldInfo {
    name: string;
    typeAnnotation: string;
    line: number;
    col: number;
}

export interface SymbolDef {
    name: string;
    kind: SymbolKind;
    line: number;
    col: number;
    endCol: number;
    inferredType?: string;
    fields?: ClassFieldInfo[];
}

export interface SPL2Analysis {
    uri: string;
    version: number;
    originalText: string;
    originalLines: string[];
    preprocessedPython: string;
    virtualPythonWithStubs: string;
    lineAnchors: Map<number, ColumnAnchor[]>;
    diagnostics: Diagnostic[];
    symbols: Map<string, SymbolDef>;
    isMarkdown?: boolean;
    isWorkflow?: boolean;
    blocks?: MarkdownBlock[];
}

function unquoteYamlString(raw: string, line: number): string {
    if (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2) {
        const inner = raw.slice(1, -1);
        if (inner.replace(/''/g, '').includes("'")) {
            throw new SPL2MarkdownError('invalid frontmatter: unescaped single quote in string', line, 1);
        }
        return inner.replace(/''/g, "'");
    }
    if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
        const inner = raw.slice(1, -1);
        let out = '';
        for (let i = 0; i < inner.length; i++) {
            const ch = inner[i];
            if (ch === '\\') {
                if (i + 1 >= inner.length) {
                    throw new SPL2MarkdownError('invalid frontmatter: trailing backslash in double-quoted string', line, 1);
                }
                const nxt = inner[++i];
                const map: Record<string, string> = { n: '\n', r: '\r', t: '\t', '0': '\0', '\\': '\\', '"': '"', '/': '/' };
                out += map[nxt] ?? nxt;
                continue;
            }
            if (ch === '"') {
                throw new SPL2MarkdownError('invalid frontmatter: unescaped double quote in string', line, 1);
            }
            out += ch;
        }
        return out;
    }
    throw new SPL2MarkdownError('invalid frontmatter: unterminated quoted string', line, 1);
}

function stripInlineYamlComment(val: string): string {
    let inQuote: string | null = null;
    for (let i = 0; i < val.length; i++) {
        const ch = val[i];
        if (inQuote) {
            if (ch === '\\' && inQuote === '"') {
                i++;
                continue;
            }
            if (ch === inQuote) inQuote = null;
            continue;
        }
        if (ch === "'" || ch === '"') {
            inQuote = ch;
            continue;
        }
        if (ch === '#' && (i === 0 || val[i - 1] === ' ' || val[i - 1] === '\t')) {
            return val.slice(0, i).trimEnd();
        }
    }
    return val.trim();
}

function parseYamlScalar(rawVal: string, line: number): unknown {
    const val = stripInlineYamlComment(rawVal.trim());
    if (!val) return null;
    if (val[0] === "'" || val[0] === '"') {
        return unquoteYamlString(val, line);
    }
    if (val.startsWith('[') || val.startsWith('{')) {
        if (val.startsWith('[') && val.endsWith(']')) return [];
        if (val.startsWith('{') && val.endsWith('}')) return {};
        throw new SPL2MarkdownError(`invalid frontmatter: malformed collection ${val}`, line, 1);
    }
    const lowered = val.toLowerCase();
    if (lowered === 'true' || lowered === 'yes') return true;
    if (lowered === 'false' || lowered === 'no') return false;
    if (lowered === 'null' || lowered === '~') return null;
    if (/^[+-]?\d+$/.test(val)) return Number.parseInt(val, 10);
    if (/^[+-]?\d+\.\d+$/.test(val)) return Number.parseFloat(val);
    return val;
}

function parseYamlFrontmatter(fmLines: string[]): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    let hasNonEmpty = false;
    let i = 0;
    while (i < fmLines.length) {
        const rawLine = fmLines[i];
        const stripped = rawLine.trim();
        if (!stripped || stripped.startsWith('#')) {
            i++;
            continue;
        }
        hasNonEmpty = true;
        const m = /^(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))[ \t]*:(?:[ \t]+(.*)|[ \t]*)$/.exec(rawLine);
        if (!m) {
            if (Object.keys(result).length === 0 && !rawLine.includes(':')) {
                throw new SPL2MarkdownError('frontmatter must be a mapping', 2, 1);
            }
            throw new SPL2MarkdownError(`invalid frontmatter on line ${i + 2}`, 2, 1);
        }
        const key = m[1] || m[2] || m[3];
        const rest = (m[4] || '').trim();
        if (Object.prototype.hasOwnProperty.call(result, key)) {
            throw new SPL2MarkdownError(`invalid frontmatter: duplicate key '${key}'`, 2, 1);
        }
        const blockMatch = /^([|>])([+-])?(?:[ \t]+#.*)?$/.exec(rest);
        if (blockMatch) {
            const style = blockMatch[1];
            const chomp = blockMatch[2] || '';
            i++;
            const blockLines: string[] = [];
            let blockIndent: number | null = null;
            while (i < fmLines.length) {
                const bLine = fmLines[i];
                if (!bLine.trim()) {
                    blockLines.push('');
                    i++;
                    continue;
                }
                const curIndent = bLine.length - bLine.replace(/^ +/, '').length;
                if (blockIndent === null) {
                    if (curIndent === 0) break;
                    blockIndent = curIndent;
                }
                if (curIndent < blockIndent) break;
                blockLines.push(bLine.slice(blockIndent));
                i++;
            }
            let trailingNewlines = 0;
            while (blockLines.length > 0 && blockLines[blockLines.length - 1] === '') {
                blockLines.pop();
                trailingNewlines++;
            }
            const text = style === '|' ? blockLines.join('\n') : blockLines.join(' ');
            if (chomp === '-') {
                result[key] = text;
            } else if (chomp === '+') {
                result[key] = text ? text + '\n'.repeat(1 + trailingNewlines) : '';
            } else {
                result[key] = text ? text + '\n' : '';
            }
            continue;
        }
        result[key] = parseYamlScalar(rest, 2);
        i++;
    }
    if (!hasNonEmpty) {
        throw new SPL2MarkdownError('frontmatter must be a mapping', 2, 1);
    }
    return result;
}

export function isWorkflowMarkdown(source: string): boolean {
    const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const m = /^---[ \t]*\n([\s\S]*?)\n(?:---|\.\.\.)[ \t]*(?:\n|$)/.exec(normalized);
    if (!m) return false;
    const fmText = m[1];
    try {
        const meta = parseYamlFrontmatter(fmText.split('\n'));
        return meta.extension === EXTENSION;
    } catch {
        return fmText.split('\n').some((line) =>
            /^[ \t]*(?:"extension"|'extension'|extension)[ \t]*:[ \t]*(?:"semantic-prompt-language"|'semantic-prompt-language'|semantic-prompt-language)[ \t]*(?:#.*)?$/.test(line),
        );
    }
}

export function extractMarkdown(source: string): MarkdownDocument {
    const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const lines = normalized.split('\n');
    if (!/^---[ \t]*$/.test(lines[0] ?? '')) {
        throw new SPL2MarkdownError('Markdown workflows require YAML frontmatter', 1, 1);
    }
    const endIdx = lines.findIndex((line, idx) => idx > 0 && /^(?:---|\.\.\.)[ \t]*$/.test(line));
    if (endIdx < 0) {
        throw new SPL2MarkdownError('unterminated YAML frontmatter', 1, 1);
    }
    const metadata = parseYamlFrontmatter(lines.slice(1, endIdx));
    if (metadata.extension !== EXTENSION) {
        throw new SPL2MarkdownError(`frontmatter requires extension: ${EXTENSION}`, 2, 1);
    }
    if (typeof metadata.version !== 'number' || (metadata.version !== 1 && metadata.version !== 2)) {
        throw new SPL2MarkdownError('frontmatter requires version: 1 or 2', 2, 1);
    }
    for (const key of Object.keys(metadata)) {
        if (!['extension', 'version', 'model', 'preamble'].includes(key)) {
            throw new SPL2MarkdownError(`unknown frontmatter field '${key}'`, 2, 1);
        }
    }
    const model = 'model' in metadata ? metadata.model : undefined;
    const preamble = 'preamble' in metadata ? metadata.preamble : undefined;
    if (model !== undefined && (typeof model !== 'string' || !model.trim())) {
        throw new SPL2MarkdownError('frontmatter model must be a non-empty string', 2, 1);
    }
    if (preamble !== undefined && typeof preamble !== 'string') {
        throw new SPL2MarkdownError('frontmatter preamble must be a string', 2, 1);
    }

    const masked = lines.map((l) => ' '.repeat(l.length));
    const blocks: MarkdownBlock[] = [];
    let i = endIdx + 1;
    let inHtmlComment = false;

    while (i < lines.length) {
        const line = lines[i];

        if (inHtmlComment) {
            if (line.includes('-->')) inHtmlComment = false;
            i++;
            continue;
        }
        if (/^ {0,3}<!--/.test(line)) {
            if (!line.includes('-->')) inHtmlComment = true;
            i++;
            continue;
        }

        // Top-level fenced code block (0-3 leading spaces)
        const fenceMatch = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/.exec(line);
        if (fenceMatch) {
            const fenceMarker = fenceMatch[1];
            const fenceChar = fenceMarker[0];
            const info = fenceMatch[2].trim();
            const openLine1 = i + 1;
            const closingRe = new RegExp(`^ {0,3}${fenceChar}{${fenceMarker.length},}[ \\t]*$`);
            let closeIdx = -1;
            for (let j = i + 1; j < lines.length; j++) {
                if (closingRe.test(lines[j])) {
                    closeIdx = j;
                    break;
                }
            }
            if (info === 'spl2') {
                if (closeIdx < 0) {
                    throw new SPL2MarkdownError('unterminated SPL2 fence', openLine1, 1);
                }
                const innerLines = lines.slice(i + 1, closeIdx);
                innerLines.forEach((txt, idx) => {
                    masked[openLine1 + idx] = txt;
                });
                blocks.push({
                    kind: 'spl2',
                    text: innerLines.join('\n'),
                    line: openLine1 + 1,
                    endLine: closeIdx,
                });
            }
            if (closeIdx < 0) {
                break;
            }
            i = closeIdx + 1;
            continue;
        }

        // Top-level blockquote (0-3 leading spaces followed by `>`)
        if (/^ {0,3}>/.test(line)) {
            const startIdx = i;
            const bqRawLines: string[] = [];
            let prevWasContent = true;
            while (i < lines.length) {
                const cur = lines[i];
                if (/^ {0,3}>/.test(cur)) {
                    bqRawLines.push(cur);
                    prevWasContent = cur.replace(/^ {0,3}>[ \t]?/, '').trim().length > 0;
                    i++;
                    continue;
                }
                // Lazy continuation: non-empty line that is not a heading, fence, list item, or thematic break
                if (
                    prevWasContent &&
                    cur.trim().length > 0 &&
                    !/^ {0,3}(?:#|`{3,}|~{3,}|[-*+][ \t]|\d+\.[ \t]|<!--)/.test(cur)
                ) {
                    bqRawLines.push(cur);
                    i++;
                    continue;
                }
                break;
            }
            const strippedBq = bqRawLines.map((l) => l.replace(/^ {0,3}>[ \t]?/, ''));
            blocks.push({
                kind: 'natural',
                text: strippedBq.join('\n'),
                line: startIdx + 1,
                endLine: startIdx + bqRawLines.length,
            });
            continue;
        }

        i++;
    }

    return {
        version: metadata.version,
        model: model as string | undefined,
        preamble: preamble as string | undefined,
        blocks,
        code: masked.join('\n'),
    };
}

function mapColToOrig(anchors: ColumnAnchor[] | undefined, genCol: number): number {
    if (!anchors || anchors.length === 0) return Math.max(0, genCol);
    let bestGen = 0;
    let bestOrig = 0;
    for (const a of anchors) {
        if (a.genCol <= genCol) {
            bestGen = a.genCol;
            bestOrig = a.origCol;
        } else {
            break;
        }
    }
    return Math.max(0, bestOrig + (genCol - bestGen));
}

function mapColToGen(anchors: ColumnAnchor[] | undefined, origCol: number): number {
    if (!anchors || anchors.length === 0) return Math.max(0, origCol);
    let bestGen = 0;
    let bestOrig = 0;
    for (const a of anchors) {
        if (a.origCol <= origCol) {
            bestGen = a.genCol;
            bestOrig = a.origCol;
        } else {
            break;
        }
    }
    return Math.max(0, bestGen + (origCol - bestOrig));
}

export function origToVirtualPosition(analysis: SPL2Analysis, pos: Position): Position {
    const anchors = analysis.lineAnchors.get(pos.line);
    const genChar = mapColToGen(anchors, pos.character);
    return Position.create(pos.line + PYLANCE_HEADER_LINE_COUNT, genChar);
}

export function virtualToOrigPosition(analysis: SPL2Analysis, vPos: Position): Position {
    const origLine = Math.max(0, vPos.line - PYLANCE_HEADER_LINE_COUNT);
    const anchors = analysis.lineAnchors.get(origLine);
    const origChar = mapColToOrig(anchors, vPos.character);
    return Position.create(origLine, origChar);
}

export function virtualToOrigRange(analysis: SPL2Analysis, vRange: Range): Range {
    return Range.create(
        virtualToOrigPosition(analysis, vRange.start),
        virtualToOrigPosition(analysis, vRange.end),
    );
}

interface ParsedModifier {
    name: string;
    rawValue: string;
    nameCol: number;
    valueCol: number;
}

function parseModifierList(modText: string, baseCol: number): {
    isEmpty: boolean;
    positionalCols: number[];
    modifiers: ParsedModifier[];
} {
    const trimmed = modText.trim();
    if (!trimmed) {
        return { isEmpty: true, positionalCols: [], modifiers: [] };
    }
    // Split on top-level commas
    const parts: { text: string; offset: number }[] = [];
    let depth = 0;
    let inQuote: string | null = null;
    let segStart = 0;

    for (let i = 0; i < modText.length; i++) {
        const ch = modText[i];
        if (inQuote) {
            if (ch === '\\') {
                i++;
                continue;
            }
            if (ch === inQuote) inQuote = null;
            continue;
        }
        if (ch === "'" || ch === '"') {
            inQuote = ch;
            continue;
        }
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
        else if (ch === ',' && depth === 0) {
            parts.push({ text: modText.slice(segStart, i), offset: segStart });
            segStart = i + 1;
        }
    }
    if (segStart < modText.length) {
        parts.push({ text: modText.slice(segStart), offset: segStart });
    }

    const positionalCols: number[] = [];
    const modifiers: ParsedModifier[] = [];

    for (const part of parts) {
        const pTrim = part.text.trim();
        if (!pTrim) continue;
        const leadSpaces = part.text.indexOf(pTrim);
        const partCol = baseCol + part.offset + leadSpaces;

        const m = /^([A-Za-z_]\w*)\s*=(?!=)(.*)$/s.exec(pTrim);
        if (!m) {
            positionalCols.push(partCol);
            continue;
        }
        const name = m[1];
        const rawVal = m[2].trim();
        const valOffsetInTrim = pTrim.indexOf(rawVal, name.length + 1);
        modifiers.push({
            name,
            rawValue: rawVal,
            nameCol: partCol,
            valueCol: partCol + Math.max(0, valOffsetInTrim),
        });
    }

    return { isEmpty: false, positionalCols, modifiers };
}

function validateModifiers(
    kind: 'ask' | 'agent' | 'decide' | 'restrict',
    modText: string,
    lineIdx: number,
    openParenCol: number,
    hasPrompt: boolean,
    kwCol: number,
    kwEndCol: number,
    diagnostics: Diagnostic[],
): { schemaType?: string; fmtType?: string } {
    const parsed = parseModifierList(modText, openParenCol + 1);
    const result: { schemaType?: string; fmtType?: string } = {};

    if (kind === 'restrict') {
        if (parsed.isEmpty) {
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: Range.create(lineIdx, kwCol, lineIdx, openParenCol + modText.length + 2),
                message: "Empty 'restrict()' call with no arguments; specify at least one of fs, net, exec, or mcp.",
                source: 'spl2',
                code: 'missing-expression',
            });
            return result;
        }
        for (const posCol of parsed.positionalCols) {
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: Range.create(lineIdx, posCol, lineIdx, posCol + 1),
                message: "Positional arguments are not allowed in 'restrict(...)'; use keyword arguments (fs, net, exec, mcp).",
                source: 'spl2',
                code: 'unknown-modifier',
            });
        }
        for (const mod of parsed.modifiers) {
            if (!(RESTRICT_MODIFIERS as readonly string[]).includes(mod.name)) {
                diagnostics.push({
                    severity: DiagnosticSeverity.Error,
                    range: Range.create(lineIdx, mod.nameCol, lineIdx, mod.nameCol + mod.name.length),
                    message: `Unknown modifier '${mod.name}' on 'restrict(...)'. Allowed modifiers: fs, net, exec, mcp.`,
                    source: 'spl2',
                    code: 'unknown-modifier',
                });
            }
        }
        return result;
    }

    // ask, agent, decide
    const allowedSet = new Set<string>(COMMON_MODIFIERS);
    if (kind === 'agent') {
        for (const m of AGENT_ONLY_MODIFIERS) allowedSet.add(m);
    } else if (kind === 'decide') {
        for (const m of DECIDE_EXTRA_MODIFIERS) allowedSet.add(m);
    }

    for (const posCol of parsed.positionalCols) {
        diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: Range.create(lineIdx, posCol, lineIdx, posCol + 1),
            message: `Positional arguments are not allowed in '${kind}(...)' modifiers; use keyword modifiers (e.g. fmt='text').`,
            source: 'spl2',
            code: 'unknown-modifier',
        });
    }

    const seen = new Map<string, ParsedModifier>();
    for (const mod of parsed.modifiers) {
        seen.set(mod.name, mod);

        // Rule 5: agent-only modifiers on ask or decide
        if ((kind === 'ask' || kind === 'decide') && (AGENT_ONLY_MODIFIERS as readonly string[]).includes(mod.name)) {
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: Range.create(lineIdx, mod.nameCol, lineIdx, mod.nameCol + mod.name.length),
                message: `Modifier '${mod.name}' is an agent-only modifier and cannot be passed to '${kind}'.`,
                source: 'spl2',
                code: 'agent-only-modifier',
            });
            continue;
        }

        // Rule 1: unknown modifier
        if (!allowedSet.has(mod.name)) {
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: Range.create(lineIdx, mod.nameCol, lineIdx, mod.nameCol + mod.name.length),
                message: `Unknown modifier '${mod.name}' on '${kind}(...)'. Allowed modifiers: ${Array.from(allowedSet).sort().join(', ')}.`,
                source: 'spl2',
                code: 'unknown-modifier',
            });
            continue;
        }

        // Rule 3: literal values for fmt and thinking
        if (mod.name === 'fmt') {
            const strMatch = /^(['"])(.*)\1$/.exec(mod.rawValue);
            if (strMatch) {
                const val = strMatch[2];
                result.fmtType = val;
                if (!(VALID_FMT_VALUES as readonly string[]).includes(val)) {
                    diagnostics.push({
                        severity: DiagnosticSeverity.Error,
                        range: Range.create(lineIdx, mod.valueCol, lineIdx, mod.valueCol + mod.rawValue.length),
                        message: `Invalid literal value '${val}' for 'fmt'. Expected one of: ${VALID_FMT_VALUES.map((v) => `'${v}'`).join(', ')}.`,
                        source: 'spl2',
                        code: 'invalid-literal-modifier',
                    });
                }
            } else if (/^(?:\d|True\b|False\b|None\b|\[|\{)/.test(mod.rawValue)) {
                diagnostics.push({
                    severity: DiagnosticSeverity.Error,
                    range: Range.create(lineIdx, mod.valueCol, lineIdx, mod.valueCol + mod.rawValue.length),
                    message: `Invalid literal value ${mod.rawValue} for 'fmt'.`,
                    source: 'spl2',
                    code: 'invalid-literal-modifier',
                });
            }
        } else if (mod.name === 'thinking') {
            const strMatch = /^(['"])(.*)\1$/.exec(mod.rawValue);
            if (strMatch) {
                const val = strMatch[2];
                if (!(VALID_THINKING_VALUES as readonly string[]).includes(val)) {
                    diagnostics.push({
                        severity: DiagnosticSeverity.Error,
                        range: Range.create(lineIdx, mod.valueCol, lineIdx, mod.valueCol + mod.rawValue.length),
                        message: `Invalid literal value '${val}' for 'thinking'. Expected one of: ${VALID_THINKING_VALUES.map((v) => `'${v}'`).join(', ')}.`,
                        source: 'spl2',
                        code: 'invalid-literal-modifier',
                    });
                }
            } else if (/^(?:\d|True\b|False\b|None\b|\[|\{)/.test(mod.rawValue)) {
                diagnostics.push({
                    severity: DiagnosticSeverity.Error,
                    range: Range.create(lineIdx, mod.valueCol, lineIdx, mod.valueCol + mod.rawValue.length),
                    message: `Invalid literal value ${mod.rawValue} for 'thinking'.`,
                    source: 'spl2',
                    code: 'invalid-literal-modifier',
                });
            }
        } else if (mod.name === 'schema') {
            result.schemaType = mod.rawValue;
        } else if (mod.name === 'retries' || mod.name === 'tokens' || mod.name === 'max_steps') {
            // Rule 4: Reject negative or non-integer literals for retries, tokens, and max_steps
            const isBoolOrStrOrFloat =
                /^(?:True|False|None)\b/.test(mod.rawValue) ||
                /^['"\[\{]/.test(mod.rawValue) ||
                /^[+-]?\d+\.\d+/.test(mod.rawValue);
            const intMatch = /^([+-]?\d+)$/.exec(mod.rawValue);
            if (isBoolOrStrOrFloat) {
                diagnostics.push({
                    severity: DiagnosticSeverity.Error,
                    range: Range.create(lineIdx, mod.valueCol, lineIdx, mod.valueCol + mod.rawValue.length),
                    message: `Modifier '${mod.name}' requires an integer literal, got ${mod.rawValue}.`,
                    source: 'spl2',
                    code: 'invalid-numeric-modifier',
                });
            } else if (intMatch) {
                const n = Number.parseInt(intMatch[1], 10);
                if (mod.name === 'retries' && n < 0) {
                    diagnostics.push({
                        severity: DiagnosticSeverity.Error,
                        range: Range.create(lineIdx, mod.valueCol, lineIdx, mod.valueCol + mod.rawValue.length),
                        message: `Modifier 'retries' cannot be negative (got ${n}).`,
                        source: 'spl2',
                        code: 'invalid-numeric-modifier',
                    });
                } else if ((mod.name === 'tokens' || mod.name === 'max_steps') && n <= 0) {
                    diagnostics.push({
                        severity: DiagnosticSeverity.Error,
                        range: Range.create(lineIdx, mod.valueCol, lineIdx, mod.valueCol + mod.rawValue.length),
                        message: `Modifier '${mod.name}' must be a positive integer (got ${n}).`,
                        source: 'spl2',
                        code: 'invalid-numeric-modifier',
                    });
                }
            }
        }
    }

    // Rule 2: mutual exclusion of fmt and schema
    if (seen.has('fmt') && seen.has('schema')) {
        const schemaMod = seen.get('schema')!;
        diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: Range.create(lineIdx, schemaMod.nameCol, lineIdx, schemaMod.nameCol + schemaMod.name.length),
            message: `Modifiers 'fmt' and 'schema' are mutually exclusive on '${kind}(...)'.`,
            source: 'spl2',
            code: 'mutually-exclusive-modifiers',
        });
    }

    // Rule 6: missing prompt expression
    if (!hasPrompt) {
        diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: Range.create(lineIdx, kwCol, lineIdx, kwEndCol),
            message: `Missing prompt expression after '${kind}'.`,
            source: 'spl2',
            code: 'missing-expression',
        });
    }

    return result;
}

const FMT_RETURN_TYPES: Record<string, string> = {
    text: 'str',
    string: 'str',
    int: 'int',
    float: 'float',
    bool: 'bool',
    array: 'list[Any]',
    object: 'dict[str, Any]',
};

function findBlockAtLine(blocks: MarkdownBlock[] | undefined, line0: number): MarkdownBlock | undefined {
    if (!blocks) return undefined;
    const line1 = line0 + 1;
    return blocks.find((b) => line1 >= b.line && line1 <= b.endLine);
}

export function analyzeSPL2Document(document: TextDocument): SPL2Analysis {
    const originalText = document.getText();
    const originalLines = originalText.split(/\r?\n/);
    const lineAnchors = new Map<number, ColumnAnchor[]>();
    const diagnostics: Diagnostic[] = [];
    const symbols = new Map<string, SymbolDef>();
    const outLines: string[] = [];

    const isMarkdown =
        document.languageId === 'markdown' ||
        document.uri.toLowerCase().endsWith('.md') ||
        document.uri.toLowerCase().endsWith('.markdown');

    let blocks: MarkdownBlock[] | undefined;
    let sourceLines = originalLines;

    if (isMarkdown) {
        if (!isWorkflowMarkdown(originalText)) {
            return {
                uri: document.uri,
                version: document.version,
                originalText,
                originalLines,
                preprocessedPython: '',
                virtualPythonWithStubs: '',
                lineAnchors,
                diagnostics: [],
                symbols,
                isMarkdown: true,
                isWorkflow: false,
                blocks: [],
            };
        }

        try {
            const extracted = extractMarkdown(originalText);
            blocks = extracted.blocks;
            sourceLines = extracted.code.split('\n');

            // Validate each spl2 fence independently (e.g., dangling colon header without indented body or unexpected initial indent)
            for (const block of blocks) {
                if (block.kind !== 'spl2') continue;
                const bLines = block.text.split('\n');
                const nonEmpty = bLines
                    .map((text, idx) => ({ text, line0: block.line - 1 + idx }))
                    .filter((item) => item.text.trim() && !item.text.trim().startsWith('#'));
                if (nonEmpty.length === 0) continue;

                const first = nonEmpty[0];
                const firstIndent = first.text.length - first.text.trimStart().length;
                if (firstIndent > 0) {
                    diagnostics.push({
                        severity: DiagnosticSeverity.Error,
                        range: Range.create(first.line0, 0, first.line0, firstIndent),
                        message: 'SyntaxError: unexpected indent at start of SPL2 fence',
                        source: 'spl2',
                        code: 'syntax',
                    });
                }

                const last = nonEmpty[nonEmpty.length - 1];
                const lastCode = findCommentStart(last.text) >= 0 ? last.text.slice(0, findCommentStart(last.text)) : last.text;
                if (/:\s*$/.test(lastCode.trim())) {
                    diagnostics.push({
                        severity: DiagnosticSeverity.Error,
                        range: Range.create(last.line0, 0, last.line0, last.text.length),
                        message: 'SyntaxError: expected an indented block before end of SPL2 fence',
                        source: 'spl2',
                        code: 'syntax',
                    });
                }
            }
        } catch (err) {
            if (err instanceof SPL2MarkdownError) {
                const errLine0 = Math.max(0, Math.min(originalLines.length - 1, err.line - 1));
                const errCol0 = Math.max(0, err.col - 1);
                diagnostics.push({
                    severity: DiagnosticSeverity.Error,
                    range: Range.create(errLine0, errCol0, errLine0, Math.max(errCol0 + 1, (originalLines[errLine0] ?? '').length)),
                    message: err.message,
                    source: 'spl2',
                    code: 'markdown',
                });
                return {
                    uri: document.uri,
                    version: document.version,
                    originalText,
                    originalLines,
                    preprocessedPython: '',
                    virtualPythonWithStubs: '',
                    lineAnchors,
                    diagnostics,
                    symbols,
                    isMarkdown: true,
                    isWorkflow: true,
                    blocks: [],
                };
            }
            throw err;
        }
    }

    // First pass: collect class definitions (including Pydantic models and their fields), functions, and bound variables
    let currentClass: SymbolDef | null = null;
    let currentClassIndent = -1;

    for (let i = 0; i < sourceLines.length; i++) {
        const line = sourceLines[i];
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const indent = line.length - line.trimStart().length;

        if (currentClass && indent <= currentClassIndent) {
            currentClass = null;
            currentClassIndent = -1;
        }

        const classMatch = /^(\s*)class\s+([A-Za-z_]\w*)\b/.exec(line);
        if (classMatch) {
            const col = classMatch[1].length + 6;
            const name = classMatch[2];
            const sym: SymbolDef = {
                name,
                kind: SymbolKind.Class,
                line: i,
                col,
                endCol: col + name.length,
                inferredType: `type[${name}]`,
                fields: [],
            };
            symbols.set(name, sym);
            currentClass = sym;
            currentClassIndent = indent;
            continue;
        }

        if (currentClass && indent > currentClassIndent) {
            const fieldMatch = /^\s*([A-Za-z_]\w*)\s*:\s*([^=#\r\n]+)/.exec(line);
            if (fieldMatch && fieldMatch[1] !== 'def') {
                const fCol = line.indexOf(fieldMatch[1]);
                currentClass.fields?.push({
                    name: fieldMatch[1],
                    typeAnnotation: fieldMatch[2].trim(),
                    line: i,
                    col: fCol,
                });
            }
        }

        const defMatch = /^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/.exec(line);
        if (defMatch) {
            const fnName = defMatch[2];
            const fnCol = line.indexOf(fnName, defMatch[1].length);
            symbols.set(fnName, {
                name: fnName,
                kind: SymbolKind.Function,
                line: i,
                col: fnCol,
                endCol: fnCol + fnName.length,
            });
            // Register parameter names so soft keywords used as params are recognized as bound
            for (const rawParam of defMatch[3].split(',')) {
                const pName = rawParam.trim().replace(/^\*+/, '').split(/[=:]/)[0].trim();
                if (pName && /^[A-Za-z_]\w*$/.test(pName) && !symbols.has(pName)) {
                    const pCol = line.indexOf(pName, fnCol);
                    symbols.set(pName, {
                        name: pName,
                        kind: SymbolKind.Variable,
                        line: i,
                        col: Math.max(0, pCol),
                        endCol: Math.max(0, pCol) + pName.length,
                    });
                }
            }
            continue;
        }

        const assignMatch = /^(\s*)([A-Za-z_]\w*)\s*=(?!=)\s*(.*)$/.exec(line);
        if (assignMatch && indent === 0) {
            const varName = assignMatch[2];
            const varCol = assignMatch[1].length;
            if (!symbols.has(varName)) {
                symbols.set(varName, {
                    name: varName,
                    kind: SymbolKind.Variable,
                    line: i,
                    col: varCol,
                    endCol: varCol + varName.length,
                });
            }
        }
    }

    // Also collect variables saved in Markdown blockquotes (e.g. `save to @var`, `-> @var`, `@var = ...`, with optional `@validate[Schema]`)
    const blockquoteLinePy = new Map<number, string>();
    if (blocks) {
        for (const block of blocks) {
            if (block.kind !== 'natural') continue;
            const valMatch = /@validate\[([A-Za-z_]\w*)\]/.exec(block.text);
            const schemaType = valMatch ? valMatch[1] : undefined;
            const savePatterns = [
                /\bsave\s+(?:it\s+)?to\s+@([A-Za-z_]\w*)/gi,
                /->\s*@([A-Za-z_]\w*)/g,
                /(?:^|\n)\s*@([A-Za-z_]\w*)\s*=/g,
            ];
            let assignedVar: string | undefined;
            for (const pat of savePatterns) {
                for (const m of block.text.matchAll(pat)) {
                    const vName = m[1];
                    assignedVar = vName;
                    if (!symbols.has(vName)) {
                        // Find exact line and column of `@vName` in originalLines within block
                        let foundLine = block.line - 1;
                        let foundCol = 0;
                        for (let lIdx = block.line - 1; lIdx < block.endLine; lIdx++) {
                            const rawL = originalLines[lIdx] ?? '';
                            const atIdx = rawL.indexOf(`@${vName}`);
                            if (atIdx >= 0) {
                                foundLine = lIdx;
                                foundCol = atIdx + 1;
                                break;
                            }
                        }
                        symbols.set(vName, {
                            name: vName,
                            kind: SymbolKind.Variable,
                            line: foundLine,
                            col: foundCol,
                            endCol: foundCol + vName.length,
                            inferredType: schemaType,
                        });
                    } else if (schemaType) {
                        const existing = symbols.get(vName)!;
                        if (!existing.inferredType) existing.inferredType = schemaType;
                    }
                }
            }
            const bqCall = `__spl2_natural__(${JSON.stringify(block.text)}, __lineno__=${block.line})`;
            if (assignedVar) {
                const typeAnnot = schemaType && symbols.has(schemaType) ? `: ${schemaType}` : ': _Any';
                blockquoteLinePy.set(block.line - 1, `${assignedVar}${typeAnnot} = ${bqCall}`);
            } else {
                blockquoteLinePy.set(block.line - 1, bqCall);
            }
        }
    }

    // Second pass: line-by-line token-stream rewrite + lint validation
    for (let i = 0; i < sourceLines.length; i++) {
        if (blockquoteLinePy.has(i)) {
            outLines.push(blockquoteLinePy.get(i)!);
            continue;
        }
        const line = sourceLines[i];
        const commentIdx = findCommentStart(line);
        const codePart = commentIdx >= 0 ? line.slice(0, commentIdx) : line;
        const commentPart = commentIdx >= 0 ? line.slice(commentIdx) : '';
        const trimmed = codePart.trim();

        if (!trimmed) {
            outLines.push(line);
            continue;
        }

        // 1. Check block headers: enforce, forbid, restrict
        const enforceForbidBlock = /^(\s*)(enforce|forbid)\b(.*)$/.exec(codePart);
        if (enforceForbidBlock && !/^\s*=(?!=)/.test(enforceForbidBlock[3])) {
            const indent = enforceForbidBlock[1];
            const kw = enforceForbidBlock[2] as 'enforce' | 'forbid';
            const rest = enforceForbidBlock[3];
            const kwCol = indent.length;
            const colonIdx = rest.lastIndexOf(':');

            if (colonIdx < 0) {
                if (!symbols.has(kw)) {
                    diagnostics.push({
                        severity: DiagnosticSeverity.Error,
                        range: Range.create(i, kwCol, i, kwCol + kw.length),
                        message: `Missing target expression after '${kw}'.`,
                        source: 'spl2',
                        code: 'missing-expression',
                    });
                }
                outLines.push(line);
                continue;
            }

            const exprText = rest.slice(0, colonIdx).trim();
            if (!exprText) {
                diagnostics.push({
                    severity: DiagnosticSeverity.Error,
                    range: Range.create(i, kwCol, i, kwCol + kw.length + 1),
                    message: `Missing target expression after '${kw}'.`,
                    source: 'spl2',
                    code: 'missing-expression',
                });
                outLines.push(`${indent}with __spl2_${kw}__():${commentPart}`);
                continue;
            }

            const exprStartInLine = codePart.indexOf(exprText, kwCol + kw.length);
            const prefix = `${indent}with __spl2_${kw}__(`;
            const genLine = `${prefix}${exprText}):${commentPart}`;
            outLines.push(genLine);
            lineAnchors.set(i, [
                { genCol: 0, origCol: 0 },
                { genCol: indent.length, origCol: kwCol },
                { genCol: prefix.length, origCol: exprStartInLine },
            ]);
            continue;
        }

        const restrictBlock = /^(\s*)(restrict)\b(.*)$/.exec(codePart);
        if (restrictBlock && !/^\s*=(?!=)/.test(restrictBlock[3])) {
            const indent = restrictBlock[1];
            const rest = restrictBlock[3];
            const kwCol = indent.length;
            const parenMatch = /^\s*\((.*)\)\s*:\s*$/.exec(rest);
            if (parenMatch) {
                const modText = parenMatch[1];
                const openParenCol = codePart.indexOf('(', kwCol + 8);
                validateModifiers('restrict', modText, i, openParenCol, true, kwCol, kwCol + 8, diagnostics);
                const prefix = `${indent}with __spl2_restrict__(`;
                const genLine = `${prefix}${modText}):${commentPart}`;
                outLines.push(genLine);
                lineAnchors.set(i, [
                    { genCol: 0, origCol: 0 },
                    { genCol: indent.length, origCol: kwCol },
                    { genCol: prefix.length, origCol: openParenCol + 1 },
                ]);
                continue;
            } else if (/^\s*:\s*$/.test(rest) || /^\s*\(\s*\)\s*$/.test(rest)) {
                diagnostics.push({
                    severity: DiagnosticSeverity.Error,
                    range: Range.create(i, kwCol, i, codePart.trimEnd().length),
                    message: "Empty 'restrict()' call with no arguments; specify at least one of fs, net, exec, or mcp.",
                    source: 'spl2',
                    code: 'missing-expression',
                });
                outLines.push(`${indent}with __spl2_restrict__():${commentPart}`);
                continue;
            }
        }

        // 2. Check termination statements: success, failure
        const termMatch = /^(\s*)(success|failure)\b(?![\s]*[=.,:\[])(.*)$/.exec(codePart);
        if (termMatch) {
            const indent = termMatch[1];
            const kw = termMatch[2];
            const exprRest = termMatch[3].trim();
            if (!(exprRest.startsWith('(') && symbols.get(kw)?.kind === SymbolKind.Function)) {
                const arg = exprRest || (kw === 'success' ? 'None' : "'Failure'");
                const exprCol = exprRest ? codePart.indexOf(exprRest, indent.length + kw.length) : indent.length + kw.length;
                const prefix = `${indent}__spl2_${kw}__(`;
                outLines.push(`${prefix}${arg})${commentPart}`);
                lineAnchors.set(i, [
                    { genCol: 0, origCol: 0 },
                    { genCol: prefix.length, origCol: exprCol },
                ]);
                continue;
            }
        }

        // 3. Check expression keywords: ask, agent, decide
        const cmdWithMods = /^(\s*(?:(?:[A-Za-z_]\w*\s*=\s*)?(?:return\s+)?(?:if\s+|elif\s+)?(?:await\s+)?)?)(ask|agent|decide)\s*\(([^)]*)\)\s*(.*)$/.exec(codePart);
        if (cmdWithMods) {
            const lead = cmdWithMods[1];
            const kw = cmdWithMods[2] as 'ask' | 'agent' | 'decide';
            const modText = cmdWithMods[3];
            let tail = cmdWithMods[4].trim();
            const isIfHeader = /^\s*(?:if|elif)\b/.test(lead) && tail.endsWith(':');
            if (isIfHeader) {
                tail = tail.slice(0, -1).trim();
            }

            const kwCol = lead.length;
            const openParenCol = codePart.indexOf('(', kwCol + kw.length);
            const closeParenCol = openParenCol + 1 + modText.length;

            // Check if single positional parenthesized prompt `ask (prompt_expr)` without keyword args and no trailing prompt
            const parsedMods = parseModifierList(modText, openParenCol + 1);
            if (!tail && !parsedMods.isEmpty && parsedMods.modifiers.length === 0 && parsedMods.positionalCols.length === 1) {
                const prefix = `${lead}__spl2_${kw}__(__spl2_prompt__=(`;
                outLines.push(`${prefix}${modText}))${isIfHeader ? ':' : ''}${commentPart}`);
                lineAnchors.set(i, [
                    { genCol: 0, origCol: 0 },
                    { genCol: prefix.length, origCol: openParenCol + 1 },
                ]);
                continue;
            }

            const hasPrompt = tail.length > 0;
            const { schemaType, fmtType } = validateModifiers(
                kw,
                modText,
                i,
                openParenCol,
                hasPrompt,
                kwCol,
                closeParenCol + 1,
                diagnostics,
            );

            // Record inferred return type on assigned variable if present
            const lhsMatch = /^\s*([A-Za-z_]\w*)\s*=\s*/.exec(lead);
            if (lhsMatch) {
                const lhsVar = lhsMatch[1];
                const sym = symbols.get(lhsVar);
                if (sym) {
                    if (kw === 'decide') {
                        sym.inferredType = 'bool';
                    } else if (schemaType) {
                        sym.inferredType = schemaType;
                    } else if (fmtType && FMT_RETURN_TYPES[fmtType]) {
                        sym.inferredType = FMT_RETURN_TYPES[fmtType];
                    } else {
                        sym.inferredType = 'str';
                    }
                }
            }

            const promptArg = hasPrompt
                ? `${modText.trim() ? ', ' : ''}__spl2_prompt__=${tail}`
                : '';
            const prefix = `${lead}__spl2_${kw}__(`;
            const genLine = `${prefix}${modText}${promptArg})${isIfHeader ? ':' : ''}${commentPart}`;
            outLines.push(genLine);

            const anchors: ColumnAnchor[] = [
                { genCol: 0, origCol: 0 },
                { genCol: lead.length, origCol: kwCol },
                { genCol: prefix.length, origCol: openParenCol + 1 },
            ];
            if (hasPrompt) {
                const promptOrigCol = codePart.indexOf(tail, closeParenCol + 1);
                const promptGenCol = prefix.length + modText.length + (modText.trim() ? 2 : 0) + '__spl2_prompt__='.length;
                anchors.push({ genCol: promptGenCol, origCol: promptOrigCol });
            }
            lineAnchors.set(i, anchors);
            continue;
        }

        const cmdBare = /^(\s*(?:(?:[A-Za-z_]\w*\s*=\s*)?(?:return\s+)?(?:if\s+|elif\s+)?(?:await\s+)?)?)(ask|agent|decide)(?:\s+(.+))?$/.exec(codePart);
        if (cmdBare) {
            const lead = cmdBare[1];
            const kw = cmdBare[2] as 'ask' | 'agent' | 'decide';
            let tail = (cmdBare[3] || '').trim();
            const isIfHeader = /^\s*(?:if|elif)\b/.test(lead) && tail.endsWith(':');
            if (isIfHeader) {
                tail = tail.slice(0, -1).trim();
            }
            const kwCol = lead.length;

            if (!tail) {
                if (!symbols.has(kw)) {
                    diagnostics.push({
                        severity: DiagnosticSeverity.Error,
                        range: Range.create(i, kwCol, i, kwCol + kw.length),
                        message: `Missing prompt/target expression after '${kw}'.`,
                        source: 'spl2',
                        code: 'missing-expression',
                    });
                }
                outLines.push(line);
                continue;
            }

            // Ensure tail starts with a prompt expression starter (not binary operator like `+` or `==`)
            if (/^(?:[fFrRbBuU]{0,2}['"]|[A-Za-z_]\w*|\()/.test(tail)) {
                const lhsMatch = /^\s*([A-Za-z_]\w*)\s*=\s*/.exec(lead);
                if (lhsMatch) {
                    const sym = symbols.get(lhsMatch[1]);
                    if (sym) {
                        sym.inferredType = kw === 'decide' ? 'bool' : 'str';
                    }
                }
                const promptOrigCol = codePart.indexOf(tail, kwCol + kw.length);
                const prefix = `${lead}__spl2_${kw}__(__spl2_prompt__=`;
                outLines.push(`${prefix}${tail})${isIfHeader ? ':' : ''}${commentPart}`);
                lineAnchors.set(i, [
                    { genCol: 0, origCol: 0 },
                    { genCol: lead.length, origCol: kwCol },
                    { genCol: prefix.length, origCol: promptOrigCol },
                ]);
                continue;
            }
        }

        outLines.push(line);
    }

    const preprocessedPython = outLines.join('\n');
    const virtualPythonWithStubs = `${PYLANCE_TYPING_HEADER}${preprocessedPython}`;

    return {
        uri: document.uri,
        version: document.version,
        originalText,
        originalLines,
        preprocessedPython,
        virtualPythonWithStubs,
        lineAnchors,
        diagnostics,
        symbols,
        isMarkdown,
        isWorkflow: isMarkdown ? true : undefined,
        blocks,
    };
}

function findCommentStart(line: string): number {
    let inQuote: string | null = null;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuote) {
            if (ch === '\\') {
                i++;
                continue;
            }
            if (ch === inQuote) inQuote = null;
            continue;
        }
        if (ch === "'" || ch === '"') {
            inQuote = ch;
            continue;
        }
        if (ch === '#') return i;
    }
    return -1;
}

export function getSPL2Completions(analysis: SPL2Analysis, position: Position): CompletionItem[] {
    if (analysis.isMarkdown) {
        if (!analysis.isWorkflow) return [];
        const block = findBlockAtLine(analysis.blocks, position.line);
        if (!block) return [];
        if (block.kind === 'natural') {
            const naturalItems: CompletionItem[] = [];
            for (const sym of analysis.symbols.values()) {
                naturalItems.push({
                    label: sym.name,
                    kind:
                        sym.kind === SymbolKind.Class
                            ? CompletionItemKind.Class
                            : sym.kind === SymbolKind.Function
                            ? CompletionItemKind.Function
                            : CompletionItemKind.Variable,
                    detail: sym.inferredType ? `${sym.name}: ${sym.inferredType}` : sym.name,
                });
            }
            for (const marker of ['ENFORCE', 'FORBID', 'RESTRICT', 'validate', 'success', 'failure']) {
                naturalItems.push({
                    label: marker,
                    kind: CompletionItemKind.Keyword,
                    detail: 'SPL2 blockquote marker',
                });
            }
            return naturalItems;
        }
    }

    const line = analysis.originalLines[position.line] ?? '';
    const beforeCursor = line.slice(0, position.character);
    const items: CompletionItem[] = [];

    // 1. Check if completing member access `var.` where `var` has an inferred Pydantic schema type
    const dotMatch = /([A-Za-z_]\w*)\.\s*([A-Za-z_]\w*)?$/.exec(beforeCursor);
    if (dotMatch) {
        const objName = dotMatch[1];
        const objSym = analysis.symbols.get(objName);
        if (objSym?.inferredType) {
            const classSym = analysis.symbols.get(objSym.inferredType);
            if (classSym?.fields) {
                for (const field of classSym.fields) {
                    items.push({
                        label: field.name,
                        kind: CompletionItemKind.Field,
                        detail: `${field.name}: ${field.typeAnnotation} (${classSym.name})`,
                        documentation: {
                            kind: MarkupKind.Markdown,
                            value: `Pydantic field on \`${classSym.name}\` (inferred from \`schema=${classSym.name}\`).`,
                        },
                    });
                }
                return items;
            }
        }
    }

    // 2. Check if cursor is inside modifier parentheses of `ask(...)`, `agent(...)`, `decide(...)`, or `restrict(...)`
    const callCtx = /(ask|agent|decide|restrict)\s*\(([^)]*)$/.exec(beforeCursor);
    if (callCtx) {
        const kw = callCtx[1] as 'ask' | 'agent' | 'decide' | 'restrict';
        const insideParens = callCtx[2];

        const fmtValMatch = /\bfmt\s*=\s*['"]?([A-Za-z_]*)$/.exec(insideParens);
        if (fmtValMatch) {
            return VALID_FMT_VALUES.map((v) => ({
                label: `'${v}'`,
                insertText: v,
                kind: CompletionItemKind.Value,
                detail: `SPL2 fmt='${v}'`,
            }));
        }

        const thinkingValMatch = /\bthinking\s*=\s*['"]?([A-Za-z_]*)$/.exec(insideParens);
        if (thinkingValMatch) {
            return VALID_THINKING_VALUES.map((v) => ({
                label: `'${v}'`,
                insertText: v,
                kind: CompletionItemKind.Value,
                detail: `SPL2 thinking='${v}'`,
            }));
        }

        const mods: string[] =
            kw === 'restrict'
                ? [...RESTRICT_MODIFIERS]
                : kw === 'agent'
                ? [...COMMON_MODIFIERS, ...AGENT_ONLY_MODIFIERS]
                : kw === 'decide'
                ? [...COMMON_MODIFIERS, ...DECIDE_EXTRA_MODIFIERS]
                : [...COMMON_MODIFIERS];

        for (const m of mods) {
            items.push({
                label: `${m}=`,
                insertText: `${m}=`,
                kind: CompletionItemKind.Property,
                detail: `SPL2 ${kw} modifier`,
                documentation: {
                    kind: MarkupKind.Markdown,
                    value: MODIFIER_DOCS[m] ?? '',
                },
            });
        }
        return items;
    }

    // 3. Top-level SPL2 keywords, built-in tools, and document symbols
    for (const kw of SPL2_KEYWORDS) {
        items.push({
            label: kw,
            kind: CompletionItemKind.Keyword,
            detail: 'SPL2 contextual keyword',
            documentation: {
                kind: MarkupKind.Markdown,
                value: KEYWORD_DOCS[kw] ?? '',
            },
        });
    }

    for (const tool of BUILTIN_TOOLS) {
        items.push({
            label: tool,
            kind: CompletionItemKind.Function,
            detail: 'spl2.tools built-in tool',
            documentation: {
                kind: MarkupKind.Markdown,
                value: TOOL_DOCS[tool] ?? '',
            },
        });
    }

    for (const sym of analysis.symbols.values()) {
        items.push({
            label: sym.name,
            kind:
                sym.kind === SymbolKind.Class
                    ? CompletionItemKind.Class
                    : sym.kind === SymbolKind.Function
                    ? CompletionItemKind.Function
                    : CompletionItemKind.Variable,
            detail: sym.inferredType ? `${sym.name}: ${sym.inferredType}` : sym.name,
        });
    }

    return items;
}

export function getSPL2Hover(analysis: SPL2Analysis, position: Position): Hover | null {
    if (analysis.isMarkdown) {
        if (!analysis.isWorkflow) return null;
        const block = findBlockAtLine(analysis.blocks, position.line);
        if (!block) return null;
    }

    const line = analysis.originalLines[position.line] ?? '';
    const wordInfo = getWordAtPosition(line, position.character);
    if (!wordInfo) return null;

    const { word, startCol, endCol } = wordInfo;
    const range = Range.create(position.line, startCol, position.line, endCol);

    // Check if word is a modifier key (`word=...`)
    const afterWord = line.slice(endCol);
    if (/^\s*=(?!=)/.test(afterWord) && MODIFIER_DOCS[word]) {
        return {
            contents: { kind: MarkupKind.Markdown, value: MODIFIER_DOCS[word] },
            range,
        };
    }

    if (KEYWORD_DOCS[word]) {
        const sym = analysis.symbols.get(word);
        if (!sym) {
            return {
                contents: { kind: MarkupKind.Markdown, value: KEYWORD_DOCS[word] },
                range,
            };
        }
    }

    if (TOOL_DOCS[word]) {
        return {
            contents: { kind: MarkupKind.Markdown, value: TOOL_DOCS[word] },
            range,
        };
    }

    const sym = analysis.symbols.get(word);
    if (sym) {
        let md = `**\`${sym.name}\`**`;
        if (sym.inferredType) {
            md += `: \`${sym.inferredType}\``;
            const schemaClass = analysis.symbols.get(sym.inferredType);
            if (schemaClass?.fields && schemaClass.fields.length > 0) {
                md += `\n\n**Schema Fields (\`${schemaClass.name}\`):**\n` +
                    schemaClass.fields.map((f) => `- \`${f.name}: ${f.typeAnnotation}\``).join('\n');
            }
        }
        return {
            contents: { kind: MarkupKind.Markdown, value: md },
            range,
        };
    }

    return null;
}

export function getSPL2Definition(analysis: SPL2Analysis, position: Position): Location | null {
    if (analysis.isMarkdown) {
        if (!analysis.isWorkflow) return null;
        const block = findBlockAtLine(analysis.blocks, position.line);
        if (!block) return null;
    }

    const line = analysis.originalLines[position.line] ?? '';
    const wordInfo = getWordAtPosition(line, position.character);
    if (!wordInfo) return null;

    const sym = analysis.symbols.get(wordInfo.word);
    if (!sym) return null;

    return Location.create(
        analysis.uri,
        Range.create(sym.line, sym.col, sym.line, sym.endCol),
    );
}

export function getSPL2DocumentSymbols(analysis: SPL2Analysis): SymbolInformation[] {
    if (analysis.isMarkdown && !analysis.isWorkflow) {
        return [];
    }
    const result: SymbolInformation[] = [];
    for (const sym of analysis.symbols.values()) {
        result.push({
            name: sym.name,
            kind: sym.kind,
            location: Location.create(
                analysis.uri,
                Range.create(sym.line, sym.col, sym.line, sym.endCol),
            ),
        });
    }
    return result;
}

function getWordAtPosition(line: string, character: number): { word: string; startCol: number; endCol: number } | null {
    let start = character;
    while (start > 0 && /[A-Za-z0-9_]/.test(line[start - 1])) {
        start--;
    }
    let end = character;
    while (end < line.length && /[A-Za-z0-9_]/.test(line[end])) {
        end++;
    }
    if (start === end) return null;
    return { word: line.slice(start, end), startCol: start, endCol: end };
}
