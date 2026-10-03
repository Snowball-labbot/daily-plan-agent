import { build } from 'esbuild'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
await mkdir(path.join(root, 'apps/web/generated'), { recursive: true })
await copyFile(path.join(root,'apps/web/app/web.css'),path.join(root,'apps/web/public/mobile.css'))
await build({ absWorkingDir: root, entryPoints: ['src/cloud/engine.ts'], outfile: 'apps/web/generated/engine.mjs', bundle: true, platform: 'node', format: 'esm', target: 'node22', plugins: [{ name: 'cloud-model', setup(builder) {
  builder.onResolve({ filter: /agnesJson\.ts$/ }, () => ({ path: path.join(root, 'src/cloud/model.ts') }))
} }] })
await build({ absWorkingDir: root, entryPoints: ['src/migration.ts'], outfile: 'apps/web/generated/migration.mjs', bundle: true, platform: 'node', format: 'esm', target: 'node22' })
await build({ absWorkingDir: root, entryPoints: ['src/client/web.tsx'], outfile: 'apps/web/generated/client.mjs', bundle: true, platform: 'browser', format: 'esm', target: 'es2022', external: ['react', 'react/jsx-runtime', 'react-dom'] })
await writeFile(path.join(root, 'apps/web/generated/client.d.mts'), `import type { ComponentType } from 'react';\nexport const PlannerWeb: ComponentType<{owner: string; email: string; onLogout: () => Promise<void>}>;\n`)
await writeFile(path.join(root, 'apps/web/generated/engine.d.mts'), `export function createEngine(initial: any, gateway?: any): Promise<{service: any; state: any; call: (endpoint: string, payload?: any, signal?: AbortSignal) => Promise<any>; close: () => Promise<void>}>;\n`)
await writeFile(path.join(root, 'apps/web/generated/migration.d.mts'), `export function emptyState(): any;\nexport function mergeBackup(state: any, backup: any): any;\nexport function validateBackup(value: any): any;\nexport function migrationReport(state: any): any;\nexport function stateChecksum(state: any): string;\n`)
console.log('Cloud engine and shared mobile client built')
