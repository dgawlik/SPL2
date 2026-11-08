import {
    createConnection,
    ProposedFeatures,
    TextDocuments,
    TextDocumentSyncKind,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
    analyzeSPL2Document,
    getSPL2Completions,
    getSPL2Definition,
    getSPL2DocumentSymbols,
    getSPL2Hover,
    type SPL2Analysis,
} from './preprocessor.js';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const analyses = new Map<string, SPL2Analysis>();

connection.onInitialize(() => ({
    capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        completionProvider: {
            triggerCharacters: ['(', ',', '=', '.', "'", '"', '@', ' '],
        },
        hoverProvider: true,
        definitionProvider: true,
        documentSymbolProvider: true,
    },
    serverInfo: {
        name: 'SPL2 Language Server',
        version: '2.0.0',
    },
}));

documents.onDidChangeContent(({ document }) => {
    try {
        const analysis = analyzeSPL2Document(document);
        analyses.set(document.uri, analysis);
        connection.sendDiagnostics({
            uri: document.uri,
            version: document.version,
            diagnostics: analysis.diagnostics,
        });
    } catch (error) {
        analyses.delete(document.uri);
        connection.console.error(
            `SPL2 analysis failed for ${document.uri}: ${error instanceof Error ? error.stack : String(error)}`,
        );
        connection.sendDiagnostics({
            uri: document.uri,
            version: document.version,
            diagnostics: [],
        });
    }
});

documents.onDidClose(({ document }) => {
    analyses.delete(document.uri);
    connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
});

connection.onCompletion(({ textDocument, position }) => {
    const analysis = analyses.get(textDocument.uri);
    return analysis ? getSPL2Completions(analysis, position) : [];
});

connection.onHover(({ textDocument, position }) => {
    const analysis = analyses.get(textDocument.uri);
    return analysis ? getSPL2Hover(analysis, position) : null;
});

connection.onDefinition(({ textDocument, position }) => {
    const analysis = analyses.get(textDocument.uri);
    return analysis ? getSPL2Definition(analysis, position) : null;
});

connection.onDocumentSymbol(({ textDocument }) => {
    const analysis = analyses.get(textDocument.uri);
    return analysis ? getSPL2DocumentSymbols(analysis) : [];
});

documents.listen(connection);
connection.listen();
