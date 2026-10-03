import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import z from '@deepseek-ai/schemastery'
import { registerDailyPlanRpc } from './rpc.ts'
import { DailyPlanService } from './service.ts'
import { registerDailyPlanTools } from './tools.ts'
import { CloudBridge } from './cloudBridge.ts'

export const name = 'dsh-daily-plan'

export const inject = [
  'storageDomain',
  'agents',
  'sessions',
  'workspaceRegistry',
  'agentDefaultModel',
  'agentPresets',
  'tools',
  'connection',
]

export interface Config {
  readonly enabled?: boolean
  readonly timeZone?: string
  readonly workspacePath?: string
  readonly agentPreset?: string
  readonly provider?: string
  readonly model?: string
  readonly reviewTimeoutMinutes?: number
}

export const Config = z.object({
  enabled: z.boolean().default(true),
  timeZone: z.string().default('Asia/Shanghai'),
  workspacePath: z.string().default(''),
  agentPreset: z.string().default('standard'),
  provider: z.string().default('agnes'),
  model: z.string().default('agnes-2.5-flash'),
  reviewTimeoutMinutes: z.number().step(1).min(1).max(60).default(6),
})

export async function apply(ctx: Context, raw: Config): Promise<void> {
  const config = raw as Required<Config>

  await ctx.effect(async () => {
    const service = await DailyPlanService.open(ctx, {
      timeZone: config.timeZone,
      workspacePath: config.workspacePath,
      provider: config.provider,
      model: config.model,
      agentPreset: config.agentPreset,
      reviewTimeoutMs: config.reviewTimeoutMinutes * 60_000,
    })

    const cloud = new CloudBridge(service)
    await cloud.load()
    const toolDisposers = new Map<object, () => void>()
    let removeRpc: () => unknown = () => undefined
    let stopCreated = (): void => undefined
    let stopDisposed = (): void => undefined

    try {
      const mount = (agent: any): void => {
        if (agent === undefined || agent === null) return
        if (toolDisposers.has(agent)) return
        // Do not attach our own tools to our own background review sessions.
        if (String(agent.id ?? '').startsWith('dsh-daily-plan-')) return
        const roots = typeof ctx.agents?.roots === 'function' ? ctx.agents.roots() : []
        if (!roots.includes(agent)) return
        toolDisposers.set(agent, registerDailyPlanTools(service, agent, cloud))
      }

      for (const agent of typeof ctx.agents?.roots === 'function' ? ctx.agents.roots() : []) mount(agent)
      stopCreated = ctx.on('agent/created', ({ agent }: any) => {
        mount(agent)
      })
      stopDisposed = ctx.on('agent/disposed', ({ agent }: any) => {
        toolDisposers.delete(agent)
      })

      removeRpc = registerDailyPlanRpc(ctx, service, cloud)
      ctx.logger.info(
        `[dsh-daily-plan] ready · workspace=${config.workspacePath || '<unset>'} model=${config.model}`,
      )

      return async () => {
        stopCreated()
        stopDisposed()
        await removeRpc()
        for (const dispose of [...toolDisposers.values()].reverse()) dispose()
        toolDisposers.clear()
        await service.dispose()
      }
    } catch (error) {
      await service.dispose()
      throw error
    }
  }, 'dsh-daily-plan: host service')
}

export type {
  BlockInput,
  PlanSnapshot,
  RollforwardItem,
  ServiceConfig,
} from './service.ts'
export { DailyPlanService } from './service.ts'
