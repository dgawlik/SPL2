import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Registry, parseRawGrammar, INITIAL } from 'vscode-textmate';
import { loadWASM, OnigScanner, OnigString } from 'vscode-oniguruma';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
    analyzeSPL2Document,
    getSPL2Completions,
    getSPL2Definition,
    getSPL2DocumentSymbols,
    getSPL2Hover,
    origToVirtualPosition,
    virtualToOrigPosition,
} from '../src/preprocessor.js';

function makeDoc(content: string, uri = 'file:///workspace/sample.spl2'): TextDocument {
    return TextDocument.create(uri, 'spl2', 1, content);
}

describe('SPL2 VS Code Language Server & Preprocessor', () => {
    it('preprocesses SPL2 constructs and preserves bidirectional line/column mapping', () => {
        const code = [
            "enforce 'Answer in Chinese':",
            "    result = ask(len='paragraph', fmt='text') 'Funny office story'",
            "    success {'story': result}",
        ].join('\n');

        const analysis = analyzeSPL2Document(makeDoc(code));
        assert.equal(analysis.diagnostics.length, 0);
        assert.match(analysis.preprocessedPython, /with __spl2_enforce__\('Answer in Chinese'\):/);
        assert.match(
            analysis.preprocessedPython,
            /__spl2_ask__\(len='paragraph', fmt='text', __spl2_prompt__='Funny office story'\)/,
        );

        // Verify roundtrip position mapping on the prompt string at line 1
        const origPos = { line: 1, character: 46 };
        const vPos = origToVirtualPosition(analysis, origPos);
        const mappedBack = virtualToOrigPosition(analysis, vPos);
        assert.deepEqual(mappedBack, origPos);
    });

    it('enforces all 6 compile-time lint rules with accurate line and column ranges', () => {
        // Rule 1: unknown modifier
        const a1 = analyzeSPL2Document(makeDoc("x = ask(bad_mod=1) 'hi'"));
        assert.equal(a1.diagnostics.length, 1);
        assert.equal(a1.diagnostics[0].code, 'unknown-modifier');

        // Rule 2: mutual exclusion of fmt and schema
        const a2 = analyzeSPL2Document(makeDoc("x = ask(fmt='text', schema=Person) 'hi'"));
        assert.equal(a2.diagnostics.length, 1);
        assert.equal(a2.diagnostics[0].code, 'mutually-exclusive-modifiers');

        // Rule 3: literal values for fmt and thinking
        const a3 = analyzeSPL2Document(makeDoc("x = ask(fmt='xml', thinking='super') 'hi'"));
        assert.equal(a3.diagnostics.length, 2);
        assert.equal(a3.diagnostics[0].code, 'invalid-literal-modifier');
        assert.equal(a3.diagnostics[1].code, 'invalid-literal-modifier');

        // Rule 4: negative or non-integer literals for retries, tokens, max_steps
        const a4 = analyzeSPL2Document(makeDoc("x = agent(retries=-1, tokens=1.5, max_steps=0) 'hi'"));
        assert.equal(a4.diagnostics.length, 3);
        assert.ok(a4.diagnostics.every((d) => d.code === 'invalid-numeric-modifier'));

        // Rule 5: agent-only modifiers on ask or decide
        const a5 = analyzeSPL2Document(makeDoc("x = ask(tools=['shell'], max_steps=5) 'hi'"));
        assert.equal(a5.diagnostics.length, 2);
        assert.ok(a5.diagnostics.every((d) => d.code === 'agent-only-modifier'));

        // Rule 6: empty restrict() and missing prompt/target expressions
        const a6 = analyzeSPL2Document(
            makeDoc(["restrict():", "    pass", "enforce:", "    pass", "x = ask(fmt='text')"].join('\n')),
        );
        assert.equal(a6.diagnostics.length, 3);
        assert.ok(a6.diagnostics.every((d) => d.code === 'missing-expression'));
    });

    it('provides Pydantic schema= type inference, completions, hover, definition, and symbols', () => {
        const code = [
            'from pydantic import BaseModel',
            '',
            'class Person(BaseModel):',
            '    first_name: str',
            '    age: int',
            '',
            "sample_person = ask(schema=Person, retries=2) 'Generate sample person'",
            'sample_person.',
        ].join('\n');

        const analysis = analyzeSPL2Document(makeDoc(code));

        // 1. Check Pydantic field completions on `sample_person.`
        const fieldCompletions = getSPL2Completions(analysis, { line: 7, character: 14 });
        const labels = fieldCompletions.map((c) => c.label);
        assert.ok(labels.includes('first_name'));
        assert.ok(labels.includes('age'));

        // 2. Check modifier completions inside `ask(`
        const modAnalysis = analyzeSPL2Document(makeDoc('x = ask('));
        const modCompletions = getSPL2Completions(modAnalysis, { line: 0, character: 8 });
        assert.ok(modCompletions.some((c) => c.label === 'schema='));
        assert.ok(!modCompletions.some((c) => c.label === 'max_steps='));

        // 3. Check hover on `sample_person` shows inferred `Person` type and fields
        const hoverInfo = getSPL2Hover(analysis, { line: 6, character: 4 });
        assert.ok(hoverInfo);
        const hoverVal = (hoverInfo.contents as { value: string }).value;
        assert.match(hoverVal, /Person/);
        assert.match(hoverVal, /first_name: str/);

        // 4. Check go-to-definition and symbols
        const defLoc = getSPL2Definition(analysis, { line: 6, character: 29 }); // `Person` in `schema=Person`
        assert.ok(defLoc);
        assert.equal(defLoc.range.start.line, 2);

        const symbols = getSPL2DocumentSymbols(analysis);
        assert.ok(symbols.some((s) => s.name === 'Person'));
        assert.ok(symbols.some((s) => s.name === 'sample_person'));
    });

    it('ships a valid TextMate grammar for .spl2 files', () => {
        const grammarPath = path.resolve(process.cwd(), 'syntaxes', 'spl2.tmLanguage.json');
        const grammar = JSON.parse(fs.readFileSync(grammarPath, 'utf8'));
        assert.equal(grammar.scopeName, 'source.spl2');
        assert.ok(grammar.repository['spl2-command-with-modifiers']);
        assert.ok(grammar.repository['spl2-block-restrict']);
    });

    it('preserves multiline prompts and their closing call delimiters', () => {
        for (const quote of ["'''", '"""']) {
            for (const keyword of ['ask', 'agent', 'decide']) {
                for (const modifiers of ['', "(len='paragraph')"]) {
                    const code = [
                        "name = 'Alice'",
                        `result = ${keyword}${modifiers} f${quote}Hello {name}.`,
                        'success is text here # not a comment',
                        `Goodbye {name}.${quote}`,
                        'print(result)',
                    ].join('\n');
                    const analysis = analyzeSPL2Document(makeDoc(code));
                    assert.deepEqual(analysis.diagnostics, [], code);
                    const expected = [
                        "name = 'Alice'",
                        `result = __spl2_${keyword}__(${modifiers ? "len='paragraph', " : ''}__spl2_prompt__=f${quote}Hello {name}.`,
                        'success is text here # not a comment',
                        `Goodbye {name}.${quote})`,
                        'print(result)',
                    ].join('\n');
                    assert.equal(analysis.preprocessedPython, expected);
                    for (const pos of [{ line: 1, character: code.split('\n')[1].indexOf('{name}') }, { line: 3, character: 10 }]) {
                        assert.deepEqual(virtualToOrigPosition(analysis, origToVirtualPosition(analysis, pos)), pos);
                    }
                }
            }
        }
    });

    it('does not rewrite or collect definitions from multiline string contents', () => {
        const code = [
            'text = """Literal code:',
            'class Fake:',
            "    field: str",
            'fake_assignment = 1',
            'import fake_module',
            "ask(bad_mod=1) 'not a call'",
            'failure "not termination"',
            '"""',
            'print(text)',
        ].join('\n');
        const analysis = analyzeSPL2Document(makeDoc(code));
        assert.deepEqual(analysis.diagnostics, []);
        assert.equal(analysis.preprocessedPython, code);
        assert.ok(!analysis.symbols.has('Fake'));
        assert.ok(!analysis.symbols.has('fake_assignment'));
        assert.ok(!analysis.symbols.has('fake_module'));
        const missing = analyzeSPL2Document(makeDoc(code + '\nprint(fake_assignment)'));
        assert.equal(missing.diagnostics.length, 1);
        assert.equal(missing.diagnostics[0].code, 'undefined-name');
        assert.match(missing.diagnostics[0].message, /fake_assignment/);
    });

    it('handles multiline constraints, termination, conditionals, and Markdown fences', () => {
        const cases = [
            ['enforce', 'with __spl2_enforce__('],
            ['forbid', 'with __spl2_forbid__('],
            ['success', '__spl2_success__('],
            ['failure', '__spl2_failure__('],
            ['if decide', 'if __spl2_decide__(__spl2_prompt__='],
        ];
        for (const [keyword, replacement] of cases) {
            const isBlock = ['enforce', 'forbid', 'if decide'].includes(keyword);
            const code = [
                `${keyword} """First line`,
                '',
                `Last line"""${isBlock ? ':' : ''} # comment`,
                ...(isBlock ? ['    pass'] : []),
            ].join('\n');
            const expected = code.replace(keyword + ' ', replacement).replace('""" #', '""")#').replace('""": #', '"""):#');
            for (const markdown of [false, true]) {
                const prefix = markdown ? '---\nextension: semantic-prompt-language\nversion: 2\n---\n```spl2\n' : '';
                const text = prefix + code + (markdown ? '\n```' : '');
                const doc = TextDocument.create(
                    markdown ? 'file:///workspace/multiline.md' : 'file:///workspace/multiline.spl2',
                    markdown ? 'markdown' : 'spl2',
                    1,
                    text.replace(/\n/g, '\r\n'),
                );
                const analysis = analyzeSPL2Document(doc);
                assert.deepEqual(analysis.diagnostics, [], text);
                const offset = markdown ? 5 : 0;
                assert.equal(analysis.preprocessedPython.split('\n').slice(offset, offset + code.split('\n').length).join('\n'), expected);
            }
        }
    });

    it('reports real errors inside multiline f-string interpolations on the original line', () => {
        const analysis = analyzeSPL2Document(makeDoc([
            'result = ask """Plain text {not_a_variable}"""',
            'result = ask f"""First line',
            '{missing_name}',
            'Last line"""',
        ].join('\n')));
        assert.equal(analysis.diagnostics.length, 1);
        assert.equal(analysis.diagnostics[0].code, 'undefined-name');
        assert.match(analysis.diagnostics[0].message, /missing_name/);
        assert.deepEqual(analysis.diagnostics[0].range, {
            start: { line: 2, character: 1 },
            end: { line: 2, character: 13 },
        });
    });

    it('validates f-string expressions spanning lines and preserves error positions', () => {
        const valid = [
            'name = "Alice"',
            'result = ask f"""Literal {{braces}}',
            '{(',
            '    name.upper()',
            ')} and {"quoted text"}',
            'Last line"""',
        ].join('\n');
        assert.deepEqual(analyzeSPL2Document(makeDoc(valid)).diagnostics, []);

        for (const [text, line, character, message] of [
            ['result = ask f"""First line\n{(\nmissing_name\n)}\nLast line"""', 2, 0, /missing_name/],
            ['result = ask f"""First line\n{\nLast line"""', 1, 0, /expecting '}'/],
            ['result = ask f"""First line\n{}\nLast line"""', 1, 0, /empty expression/],
            ['result = ask f"""First line\n}\nLast line"""', 1, 0, /single '}'/],
        ] as const) {
            const analysis = analyzeSPL2Document(makeDoc(text));
            assert.equal(analysis.diagnostics.length, 1, text);
            assert.match(analysis.diagnostics[0].message, message);
            assert.deepEqual(analysis.diagnostics[0].range.start, { line, character });
        }
    });

    it('highlights multiline strings without ending at escaped triple quotes', async () => {
        const wasm = fs.readFileSync(path.resolve(process.cwd(), 'node_modules', 'vscode-oniguruma', 'release', 'onig.wasm'));
        await loadWASM(new Uint8Array(wasm).buffer);
        const grammarPath = path.resolve(process.cwd(), 'syntaxes', 'spl2.tmLanguage.json');
        const registry = new Registry({
            onigLib: Promise.resolve({
                createOnigScanner: (patterns) => new OnigScanner(patterns),
                createOnigString: (text) => new OnigString(text),
            }),
            loadGrammar: async (scope) => scope === 'source.spl2'
                ? parseRawGrammar(fs.readFileSync(grammarPath, 'utf8'), grammarPath)
                : null,
        });
        try {
            const grammar = await registry.loadGrammar('source.spl2');
            assert.ok(grammar);
            for (const quote of ["'''", '"""']) {
                let state = INITIAL;
                for (const line of [
                    `result = ask(len='paragraph') f${quote}Hello`,
                    `escaped \\${quote} still inside the string`,
                    'ask(bad_mod=1) is literal text # not a comment',
                    `Goodbye${quote}`,
                    'print(result)',
                ]) {
                    const result = grammar.tokenizeLine(line, state);
                    state = result.ruleStack;
                    if (line.startsWith('escaped') || line.startsWith('ask(')) {
                        assert.ok(result.tokens.every((token) => token.scopes.includes('string.quoted.triple.spl2')), line);
                    } else if (line.startsWith('print')) {
                        assert.ok(result.tokens.some((token) => token.scopes.includes('support.function.builtin.spl2')));
                        assert.ok(result.tokens.every((token) => !token.scopes.includes('string.quoted.triple.spl2')));
                    }
                }
            }
        } finally {
            registry.dispose();
        }
    });

    it('keeps ordinary Markdown documents quiet and gates features on frontmatter', () => {
        const plain = TextDocument.create(
            'file:///workspace/README.md',
            'markdown',
            1,
            '# Ordinary Markdown\n\n> @success\n\n```spl2\nask(bad_mod=1)\n```',
        );
        const plainAnalysis = analyzeSPL2Document(plain);
        assert.deepEqual(plainAnalysis.diagnostics, []);
        assert.deepEqual(getSPL2DocumentSymbols(plainAnalysis), []);
        assert.deepEqual(getSPL2Completions(plainAnalysis, { line: 2, character: 3 }), []);

        const invalidVer = TextDocument.create(
            'file:///workspace/flow.md',
            'markdown',
            1,
            '---\nextension: semantic-prompt-language\nversion: 99\n---\n\nText',
        );
        const invalidAnalysis = analyzeSPL2Document(invalidVer);
        assert.equal(invalidAnalysis.diagnostics.length, 1);
        assert.match(invalidAnalysis.diagnostics[0].message, /version: 1 or 2/);
    });

    it('preserves positions, Pydantic schema inference, and shared symbols across spl2 fences and blockquotes in Markdown', () => {
        const mdContent = [
            '---',
            'extension: semantic-prompt-language',
            'version: 2',
            '---',
            '',
            '# Person Workflow',
            '',
            '```spl2',
            'from pydantic import BaseModel',
            '',
            'class Person(BaseModel):',
            '    first_name: str',
            '    age: int',
            '```',
            '',
            '> Generate a sample person @validate[Person] and save to @person',
            '',
            'Commentary paragraph outside fences.',
            '',
            '```spl2',
            'person.first_name',
            'success person',
            '```',
        ].join('\n');

        const doc = TextDocument.create('file:///workspace/person.md', 'markdown', 1, mdContent);
        const analysis = analyzeSPL2Document(doc);
        assert.deepEqual(analysis.diagnostics, []);

        // Commentary outside fences/blockquotes has no completions
        assert.deepEqual(getSPL2Completions(analysis, { line: 17, character: 5 }), []);

        // Blockquote has @name completions, hover, and go-to-definition for Person
        const bqCompletions = getSPL2Completions(analysis, { line: 15, character: 28 });
        assert.ok(bqCompletions.some((c) => c.label === 'Person'));
        const defPersonInBq = getSPL2Definition(analysis, { line: 15, character: 39 });
        assert.ok(defPersonInBq);
        assert.equal(defPersonInBq.range.start.line, 10);

        // Second spl2 fence knows `person` has inferred type `Person` from `@validate[Person]` in the blockquote!
        const fieldCompletions = getSPL2Completions(analysis, { line: 20, character: 7 });
        const labels = fieldCompletions.map((c) => c.label);
        assert.ok(labels.includes('first_name'));
        assert.ok(labels.includes('age'));
        assert.ok(labels.includes('model_dump'));

        // Validate that split blocks across fences are rejected
        const splitDoc = TextDocument.create(
            'file:///workspace/split.md',
            'markdown',
            1,
            '---\nextension: semantic-prompt-language\nversion: 2\n---\n\n```spl2\nif True:\n```\n\n```spl2\n    pass\n```',
        );
        const splitAnalysis = analyzeSPL2Document(splitDoc);
        assert.ok(splitAnalysis.diagnostics.length >= 1);
    });

    it('provides Python syntax, built-in, module, and method completions and catches Python syntax & undefined-name errors', () => {
        // 1. Markdown workflow with incomplete `pri` inside ```spl2 fence (like commits.md)
        const commitsMd = [
            '---',
            "extension: 'semantic-prompt-language'",
            'version: 1',
            "model: 'gpt-4.1'",
            '---',
            '',
            '```spl2',
            'pri',
            '```',
        ].join('\n');
        const commitsDoc = TextDocument.create('file:///workspace/commits.md', 'markdown', 1, commitsMd);
        const commitsAnalysis = analyzeSPL2Document(commitsDoc);

        // `pri` is flagged as an undefined name with "Did you mean: 'print'?"
        assert.equal(commitsAnalysis.diagnostics.length, 1);
        assert.equal(commitsAnalysis.diagnostics[0].code, 'undefined-name');
        assert.match(commitsAnalysis.diagnostics[0].message, /name 'pri' is not defined/);
        assert.match(commitsAnalysis.diagnostics[0].message, /Did you mean: 'print'\?/);
        assert.equal(commitsAnalysis.diagnostics[0].range.start.line, 7);
        assert.equal(commitsAnalysis.diagnostics[0].range.start.character, 0);
        assert.equal(commitsAnalysis.diagnostics[0].range.end.character, 3);

        // Completions at `pri` include Python built-in `print`, keywords (`def`, `for`, `import`, etc.), and SPL2 keywords
        const completionsAtPri = getSPL2Completions(commitsAnalysis, { line: 7, character: 3 });
        const priLabels = completionsAtPri.map((c) => c.label);
        assert.ok(priLabels.includes('print'));
        assert.ok(priLabels.includes('len'));
        assert.ok(priLabels.includes('range'));
        assert.ok(priLabels.includes('def'));
        assert.ok(priLabels.includes('for'));
        assert.ok(priLabels.includes('import'));

        // 2. Import and built-in method completions (`from pydantic import `, `lines.`)
        const importDoc = makeDoc(['from pydantic import ', 'lines = ["a", "b"]', 'lines.'].join('\n'));
        const importAnalysis = analyzeSPL2Document(importDoc);
        const pydanticImports = getSPL2Completions(importAnalysis, { line: 0, character: 21 }).map((c) => c.label);
        assert.ok(pydanticImports.includes('BaseModel'));
        assert.ok(pydanticImports.includes('Field'));

        const listMethods = getSPL2Completions(importAnalysis, { line: 2, character: 6 }).map((c) => c.label);
        assert.ok(listMethods.includes('append'));
        assert.ok(listMethods.includes('extend'));

        // 3. Python syntax errors: unclosed paren, missing ':', trailing operator, return outside function, bad indent
        const unclosedParen = analyzeSPL2Document(makeDoc("print('hello'"));
        assert.equal(unclosedParen.diagnostics.length, 1);
        assert.match(unclosedParen.diagnostics[0].message, /'\(' was never closed/);

        const unterminatedStr = analyzeSPL2Document(makeDoc("msg = 'hello"));
        assert.equal(unterminatedStr.diagnostics.length, 1);
        assert.match(unterminatedStr.diagnostics[0].message, /unterminated string literal/);

        const missingColon = analyzeSPL2Document(makeDoc('if True\n    x = 1'));
        assert.ok(missingColon.diagnostics.some((d) => /expected ':'/.test(d.message)));

        const trailingOp = analyzeSPL2Document(makeDoc('x = 1 +'));
        assert.equal(trailingOp.diagnostics.length, 1);
        assert.match(trailingOp.diagnostics[0].message, /SyntaxError: invalid syntax/);

        const returnOutsideFn = analyzeSPL2Document(makeDoc('return 42'));
        assert.equal(returnOutsideFn.diagnostics.length, 1);
        assert.match(returnOutsideFn.diagnostics[0].message, /'return' outside function/);

        const assignLiteral = analyzeSPL2Document(makeDoc('1 = 2'));
        assert.equal(assignLiteral.diagnostics.length, 1);
        assert.match(assignLiteral.diagnostics[0].message, /cannot assign to literal/);

        // Hover on Python built-in `print`
        const printHover = getSPL2Hover(analyzeSPL2Document(makeDoc("print('ok')")), { line: 0, character: 2 });
        assert.ok(printHover);
        assert.match((printHover.contents as { value: string }).value, /print\(/);
    });

    it('validates all shipped .spl2 and .md examples with zero diagnostics', () => {
        const examplesDir = path.resolve(process.cwd(), '..', 'lang', 'examples');
        const shippedExamples = [
            'async_workflow.spl2',
            'code_review.md',
            'decide_guard.spl2',
            'hello_ask.spl2',
            'mock_convesation.spl2',
            'pydantic_person.md',
            'pydantic_person.spl2',
            'repo_agent.spl2',
        ];
        for (const file of shippedExamples) {
            const fullPath = path.join(examplesDir, file);
            const langId = file.endsWith('.md') ? 'markdown' : 'spl2';
            const doc = TextDocument.create(`file:///${file}`, langId, 1, fs.readFileSync(fullPath, 'utf8'));
            const analysis = analyzeSPL2Document(doc);
            assert.deepEqual(analysis.diagnostics, [], `Unexpected diagnostics in ${file}`);
        }
    });
});
