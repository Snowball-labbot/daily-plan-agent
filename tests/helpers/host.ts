import { build } from 'esbuild'
import type { DailyPlanService } from '../../src/service.ts'
import type { registerDailyPlanRpc } from '../../src/rpc.ts'

// Real domain operations with an isolated per-record store and fake model transport.
const bundled = await build({ stdin: { contents: "export { DailyPlanService } from './src/service.ts'; export { registerDailyPlanRpc } from './src/rpc.ts'", resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{ name: 'fake-model-transport', setup(builder) {
    builder.onResolve({ filter: /agnesJson\.ts$/ }, () => ({ path: 'fake-model', namespace: 'test' }))
    builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: `export async function runAgnesJson(ctx, options, turns) {
      ctx.prompts.push(turns.prompt);
      if (ctx.failAI || options.signal.aborted) return {ok:false,code:'test-offline',message:'模拟 API 不可用'};
      try { return {ok:true,value:turns.parse(ctx.reply)} } catch(error) { return {ok:false,code:'parse-failed',message:String(error)} }
    }`, loader: 'js' }))
  } }] })
const exports = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0]!.text).toString('base64')}`) as {
  DailyPlanService: typeof DailyPlanService; registerDailyPlanRpc: typeof registerDailyPlanRpc;
}

export async function fixture() {
  const stores = new Map<string, Map<string, any>>()
  let settings: any = null
  const ctx: any = {
    prompts: [], failAI: false, rpc: undefined,
    reply: JSON.stringify({ summary: '优先英语，保留机动。', focus: ['推进英语'], tasks: [], unavailable: [], memories: [], energy: null }),
    logger: { warn() {} },
    connection: { rpc: { handle(_channel: string, handler: unknown) { ctx.rpc = handler; return () => undefined } } },
    storageDomain: { async open(spec: any) { return {
      global: { get: () => settings, async set(value: any) { settings = structuredClone(value) } },
      table(name: string) {
        const data = stores.get(name) ?? new Map(); stores.set(name, data)
        return { get: (key: string) => data.has(key) ? structuredClone(data.get(key)) : undefined,
          async put(key: string, value: any) { data.set(key, structuredClone(spec.tables[name].valueSchema.parse(value))) },
          async delete(key: string) { data.delete(key) }, entries: () => structuredClone([...data.entries()]).values(), keys: () => data.keys(), get size() { return data.size } }
      }, async close() {},
    } } },
  }
  const service = await exports.DailyPlanService.open(ctx, { timeZone: 'Asia/Shanghai', workspacePath: '.', provider: 'agnes', model: 'test', agentPreset: 'standard', reviewTimeoutMs: 60000 })
  ;(service as any).now = () => new Date('2026-10-01T00:00:00Z')
  await service.updateSettings({ planning: { autoPrepareToday: false }, periods: Array.from({ length: 8 }, (_, i) => ({ index: i + 1,
    startMinute: 510 + i * 30, endMinute: 540 + i * 30, label: '' })), dayEndPeriod: 8 })
  exports.registerDailyPlanRpc(ctx, service)
  return { service, ctx, stores }
}
