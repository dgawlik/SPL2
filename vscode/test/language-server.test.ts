import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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
});
