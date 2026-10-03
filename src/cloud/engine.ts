import { DailyPlanService } from '../service.ts'
import { registerDailyPlanRpc } from '../rpc.ts'
import { dailyPlanDomainSpec } from '../domain.ts'
import type { PortableState, TableName } from '../migration.ts'

export async function createEngine(initial: PortableState, gateway?: (options: any, turns: any) => Promise<any>) {
  const state = structuredClone(initial)
  let handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<any> = async () => { throw new Error('引擎未准备好') }
  const ctx: any = { modelGateway: gateway, logger: { warn() {} }, connection: { rpc: { handle(_channel: string, fn: typeof handler) { handler = fn; return () => undefined } } },
    storageDomain: { async open() { return {
      global: { get: () => structuredClone(state.settings), async set(value: any) { state.settings = structuredClone(value) } },
      table(name: TableName) {
        const rows = state.tables[name]
        return { get: (id: string) => rows[id] ? structuredClone(rows[id]) : undefined,
          async put(id: string, value: any) { rows[id] = structuredClone(dailyPlanDomainSpec.tables[name].valueSchema.parse(value)) },
          async delete(id: string) { delete rows[id] }, entries: () => structuredClone(Object.entries(rows)).values(), keys: () => Object.keys(rows).values(), get size() { return Object.keys(rows).length } }
      }, async close() {},
    } } } }
  const service = await DailyPlanService.open(ctx, { timeZone: 'Asia/Shanghai', workspacePath: '.', provider: 'agnes', model: 'agnes-2.5-flash', agentPreset: 'standard', reviewTimeoutMs: 240000 })
  // Reads never auto-replan; cloud mutations commit the entire state atomically.
  const settings = service.settings()
  ;(service as any).settingsCache = { ...settings, planning: { ...settings.planning, autoPrepareToday: false } }
  registerDailyPlanRpc(ctx, service)
  return { service, state, call: (endpoint: string, payload: unknown = {}, signal = new AbortController().signal) => handler(endpoint, payload, signal), close: () => service.dispose() }
}
