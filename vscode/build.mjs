import { build } from 'esbuild';
import { chmod, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

await build({
    entryPoints: {
        extension: 'src/extension.ts',
        server: 'src/server.ts',
        ...(process.argv.includes('--test') ? {
            'test/language-server.test': 'test/language-server.test.ts',
        } : {}),
    },
    outdir: 'out',
    outExtension: { '.js': '.cjs' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    external: ['vscode'],
    sourcemap: true,
    logLevel: 'info',
});

const termSh = 'node_modules/vscode-languageclient/lib/node/terminateProcess.sh';
if (existsSync(termSh)) {
    await copyFile(termSh, 'out/terminateProcess.sh');
    await chmod('out/terminateProcess.sh', 0o755);
}
