import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { LanguageClient, TransportKind } from 'vscode-languageclient/node';
import { TextDocument as LspTextDocument } from 'vscode-languageserver-textdocument';
import {
    analyzeSPL2Document,
    getSPL2Completions,
    isWorkflowMarkdown,
    origToVirtualPosition,
    virtualToOrigRange,
    type SPL2Analysis,
} from './preprocessor.js';

const execFileAsync = promisify(execFile);
const VIRTUAL_SCHEME = 'spl2-virtual-py';

let client: LanguageClient | undefined;

function resolvePythonPath(docUri: vscode.Uri): string {
    const configured = vscode.workspace.getConfiguration('spl2', docUri).get<string>('pythonPath', 'python');
    if (configured && configured !== 'python') return configured;
    const wsFolder = vscode.workspace.getWorkspaceFolder(docUri)?.uri.fsPath;
    const searchDirs = [
        ...(wsFolder ? [wsFolder, path.dirname(wsFolder)] : []),
        path.dirname(docUri.fsPath),
        path.resolve(path.dirname(docUri.fsPath), '..'),
        path.resolve(path.dirname(docUri.fsPath), '..', '..'),
    ];
    for (const dir of searchDirs) {
        const winVenv = path.join(dir, '.venv', 'Scripts', 'python.exe');
        if (fs.existsSync(winVenv)) return winVenv;
        const unixVenv = path.join(dir, '.venv', 'bin', 'python');
        if (fs.existsSync(unixVenv)) return unixVenv;
    }
    return configured || 'python';
}

function isRunnableSPL2Document(doc: vscode.TextDocument): boolean {
    if (doc.languageId === 'spl2') return true;
    if (doc.languageId === 'markdown') return isWorkflowMarkdown(doc.getText());
    return false;
}

class SPL2VirtualPythonProvider implements vscode.TextDocumentContentProvider {
    private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this._onDidChange.event;
    private readonly _cache = new Map<string, SPL2Analysis>();

    update(doc: vscode.TextDocument): SPL2Analysis {
        const lspDoc = LspTextDocument.create(doc.uri.toString(), doc.languageId, doc.version, doc.getText());
        const analysis = analyzeSPL2Document(lspDoc);
        const vUri = this.toVirtualUri(doc.uri);
        this._cache.set(vUri.toString(), analysis);
        this._onDidChange.fire(vUri);
        return analysis;
    }

    getAnalysis(docUri: vscode.Uri): SPL2Analysis | undefined {
        return this._cache.get(this.toVirtualUri(docUri).toString());
    }

    toVirtualUri(docUri: vscode.Uri): vscode.Uri {
        return vscode.Uri.parse(`${VIRTUAL_SCHEME}:${docUri.path}.py`);
    }

    provideTextDocumentContent(uri: vscode.Uri): string {
        return this._cache.get(uri.toString())?.virtualPythonWithStubs ?? '';
    }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const outputChannel = vscode.window.createOutputChannel('SPL2 Language Server');
    context.subscriptions.push(outputChannel);

    const virtualProvider = new SPL2VirtualPythonProvider();
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider(VIRTUAL_SCHEME, virtualProvider),
    );

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument((doc) => {
            if (isRunnableSPL2Document(doc)) virtualProvider.update(doc);
        }),
        vscode.workspace.onDidChangeTextDocument((e) => {
            if (isRunnableSPL2Document(e.document)) virtualProvider.update(e.document);
        }),
    );

    // Bridge completions and hover from Pylance/Pyright on the preprocessed virtual Python document
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            [{ language: 'spl2' }, { language: 'markdown' }],
            {
                async provideCompletionItems(document, position) {
                    if (!isRunnableSPL2Document(document)) return [];
                    const analysis = virtualProvider.update(document);
                    const vUri = virtualProvider.toVirtualUri(document.uri);
                    const vPos = origToVirtualPosition(analysis, position);
                    try {
                        await vscode.workspace.openTextDocument(vUri);
                        const list = await vscode.commands.executeCommand<vscode.CompletionList>(
                            'vscode.executeCompletionItemProvider',
                            vUri,
                            new vscode.Position(vPos.line, vPos.character),
                        );
                        if (!list?.items) return [];
                        const lspLabels = new Set(
                            getSPL2Completions(analysis, {
                                line: position.line,
                                character: position.character,
                            }).map((it) => it.label),
                        );
                        return list.items.filter((item) => {
                            const label = typeof item.label === 'string' ? item.label : item.label.label;
                            if (label.startsWith('__spl2_') || ['_Any', '_TypeVar', '_Literal', '_overload', '_ACM', '_T'].includes(label)) {
                                return false;
                            }
                            return !lspLabels.has(label);
                        });
                    } catch {
                        return [];
                    }
                },
            },
            '.',
        ),
        vscode.languages.registerHoverProvider(
            [{ language: 'spl2' }, { language: 'markdown' }],
            {
                async provideHover(document, position) {
                    if (!isRunnableSPL2Document(document)) return null;
                    const analysis = virtualProvider.update(document);
                    const vUri = virtualProvider.toVirtualUri(document.uri);
                    const vPos = origToVirtualPosition(analysis, position);
                    try {
                        const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
                            'vscode.executeHoverProvider',
                            vUri,
                            new vscode.Position(vPos.line, vPos.character),
                        );
                        if (!hovers || hovers.length === 0) return null;
                        const first = hovers[0];
                        if (first.range) {
                            const mapped = virtualToOrigRange(analysis, {
                                start: { line: first.range.start.line, character: first.range.start.character },
                                end: { line: first.range.end.line, character: first.range.end.character },
                            });
                            return new vscode.Hover(
                                first.contents,
                                new vscode.Range(
                                    mapped.start.line,
                                    mapped.start.character,
                                    mapped.end.line,
                                    mapped.end.character,
                                ),
                            );
                        }
                        return first;
                    } catch {
                        return null;
                    }
                },
            },
        ),
    );

    // Register CLI commands
    context.subscriptions.push(
        vscode.commands.registerCommand('spl2.checkCurrentFile', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || !isRunnableSPL2Document(editor.document)) return;
            await editor.document.save();
            const pythonPath = resolvePythonPath(editor.document.uri);
            try {
                await execFileAsync(pythonPath, ['-m', 'spl2.cli', '--check', editor.document.fileName]);
                void vscode.window.showInformationMessage('SPL2 check passed with no errors.');
            } catch (err: unknown) {
                const stderr = (err as { stderr?: string }).stderr || String(err);
                outputChannel.appendLine(stderr);
                outputChannel.show(true);
                void vscode.window.showErrorMessage('SPL2 check failed. See SPL2 Language Server output.');
            }
        }),
        vscode.commands.registerCommand('spl2.emitPython', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || !isRunnableSPL2Document(editor.document)) return;
            const analysis = virtualProvider.update(editor.document);
            const doc = await vscode.workspace.openTextDocument({
                language: 'python',
                content: analysis.preprocessedPython,
            });
            await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
        }),
        vscode.commands.registerCommand('spl2.runFile', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || !isRunnableSPL2Document(editor.document)) return;
            await editor.document.save();
            const pythonPath = resolvePythonPath(editor.document.uri);
            const terminal = vscode.window.createTerminal('SPL2 Run');
            terminal.show();
            terminal.sendText(`"${pythonPath}" -m spl2.cli "${editor.document.fileName}"`);
        }),
    );

    client = new LanguageClient(
        'spl2',
        'SPL2 Language Server',
        {
            module: context.asAbsolutePath('out/server.cjs'),
            transport: TransportKind.ipc,
        },
        {
            documentSelector: [{ language: 'spl2' }, { language: 'markdown' }],
            outputChannel,
        },
    );

    await client.start();
}

export async function deactivate(): Promise<void> {
    await client?.stop();
    client = undefined;
}
