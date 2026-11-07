import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import javascript from 'highlight.js/lib/languages/javascript';
import python from 'highlight.js/lib/languages/python';
import powershell from 'highlight.js/lib/languages/powershell';
import ebnf from 'highlight.js/lib/languages/ebnf';
import markdown from 'highlight.js/lib/languages/markdown';

hljs.registerLanguage('spl2', (engine) => {
    const keywords = {
        keyword:
            'ask agent decide enforce forbid restrict success failure ' +
            'def async await class if elif else for in while return yield try except finally raise with as ' +
            'import from pass break continue lambda and or not is assert del global nonlocal match case',
        literal: 'True False None',
        built_in:
            'read_file write_file shell web_fetch web_search ' +
            'print len str int float bool list dict set tuple range enumerate zip any all min max sum sorted BaseModel Field EmailStr Optional',
    };
    const string = {
        scope: 'string',
        variants: [
            { begin: /[fFrRbBuU]{0,2}'''/, end: /'''/ },
            { begin: /[fFrRbBuU]{0,2}"""/, end: /"""/ },
            { begin: /[fFrRbBuU]{0,2}'/, end: /'|$/ },
            { begin: /[fFrRbBuU]{0,2}"/, end: /"|$/ },
        ],
        contains: [engine.BACKSLASH_ESCAPE],
    };
    const expression = [
        engine.HASH_COMMENT_MODE,
        string,
        {
            match: [/\b(?:async\s+)?def\b/, /\s+/, /[A-Za-z_]\w*/],
            scope: { 1: 'keyword', 3: 'title.function' },
        },
        {
            match: [/\bclass\b/, /\s+/, /[A-Za-z_]\w*/],
            scope: { 1: 'keyword', 3: 'title.class' },
        },
        {
            scope: 'attr',
            match: /\b(?:len|fmt|schema|tokens|retries|thinking|files|model|tools|mcp|max_steps|data|fs|net|exec)\b(?=\s*=(?!=))/,
        },
        { scope: 'number', match: /\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/ },
        { scope: 'operator', match: /\/\/=|\*\*|\/\/|==|!=|<=|>=|->|[-+*/%<>=]=?/ },
    ];
    return { name: 'SPL2', aliases: ['spl'], keywords, contains: expression };
});

for (const [name, grammar] of Object.entries({
    bash,
    sh: bash,
    json,
    js: javascript,
    javascript,
    python,
    py: python,
    powershell,
    ebnf,
    markdown,
})) {
    hljs.registerLanguage(name, grammar);
}

export default hljs;
