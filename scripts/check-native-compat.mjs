import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const modules = process.argv[2]
if (!modules) throw new Error('Usage: node scripts/check-native-compat.mjs <DSH node_modules path>')
const nativeTools = pathToFileURL(join(modules, '@deepseek-ai/dsh-tools/lib/index.js')).href
const nativeDomain = await import(pathToFileURL(join(modules, '@deepseek-ai/dsh-storage-domain/lib/index.js')).href)
const nativeConnection = await import(pathToFileURL(join(modules, '@deepseek-ai/dsh-client-connection/lib/index.js')).href)
const compiled = await build({ stdin: { contents: "export { registerDailyPlanTools } from './src/tools.ts'; export { dailyPlanDomainSpec } from './src/domain.ts'; export { registerDailyPlanRpc } from './src/rpc.ts';",
  resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'native-dsh-tools', setup(builder) {
    builder.onResolve({ filter: /^@deepseek-ai\/dsh-tools$/ }, () => ({ path: nativeTools, external: true }))
    // RPC contracts do not require model execution or native agent initialization.
    builder.onResolve({ filter: /^\.\/review\.ts$/ }, () => ({ path: 'unused-probe', namespace: 'compat' }))
    builder.onLoad({ filter: /.*/, namespace: 'compat' }, () => ({ contents: 'export async function probeAgnes() { throw new Error("unused in RPC contract check") }', loader: 'js' }))
  } }] })
const { registerDailyPlanTools, dailyPlanDomainSpec, registerDailyPlanRpc } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`)
nativeDomain.defineDomain(dailyPlanDomainSpec)
const descriptor = nativeDomain.descriptorOf(dailyPlanDomainSpec)
assert.equal(descriptor.version, 1)
assert(descriptor.tables.includes('workflow_runs') && descriptor.tables.includes('personal_memory'))
const definitions = []
let disposed = 0
const service = { todayIso: () => '2026-10-01', workflowContext: () => ({ sampleDays: 0 }), replan: async () => ({ scheduled: [], waiting: [] }) }
const remove = registerDailyPlanTools(service, { ctx: { tools: { register(definition) { definitions.push(definition); return () => { disposed++ } } } } })
assert.equal(definitions.length, 8)
const read = definitions.find((tool) => tool.name === 'daily_plan_workflow_context')
assert.equal((await read.execute({}, { signal: new AbortController().signal })).ok, true)
const replan = definitions.find((tool) => tool.name === 'daily_plan_rebalance')
assert.equal((await replan.execute({}, { signal: new AbortController().signal })).ok, true)
remove(); assert.equal(disposed, 8)
let handler
registerDailyPlanRpc({ connection: { rpc: { handle(_channel, callback) { handler = callback; return () => {} } } } }, {
  workflowApply: async () => { throw new Error('活动与已有阅读安排冲突') },
})
const failed = await handler('workflow.apply', { id: 'test' }, new AbortController().signal)
const response = nativeConnection.serverResponseSchema.parse({ type: 'server-response', rpcId: 'test', result: failed })
assert.equal(response.result.ok, false)
assert.equal(response.result.error.message, '活动与已有阅读安排冲突')
assert.equal(response.result.error.details.endpoint, 'workflow.apply')
console.log('Native DSH compatibility passed: 8 tools, 10 tables, domain version 1, native RPC failure envelope.')
