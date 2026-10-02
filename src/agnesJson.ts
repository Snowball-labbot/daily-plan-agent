import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import { SessionId } from '@deepseek-ai/dsh-session'
import { setApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { finalAssistantText, sessionEvents, type SessionEvent } from './sessionLog.ts'

/**
 * One throwaway, read-only, tool-less Agnes turn that must return JSON.
 *
 * Extracted from the review pipeline (which mirrors the battle-tested flow in
 * dsh-cross-market-review's executor) because a second feature needed exactly
 * the same guarantees: marker-delimited JSON, a hard timeout, one automatic
 * repair retry, an archived session, and every tool disabled.
 *
 * Keeping one copy matters. Two copies of "call a model and trust nothing about
 * the reply" drift, and the drift shows up as one feature quietly losing its
 * timeout or its sandbox.
 */

export interface AgnesJsonOptions {
  readonly provider: string
  readonly model: string
  readonly agentPreset: string
  readonly timeoutMs: number
  readonly workspacePath: string
  readonly signal: AbortSignal
  /** Unique per run — a session log can never be reused. */
  readonly sessionId: string
  /** Shown in warnings, e.g. '排固定安排'. */
  readonly label: string
}

export interface AgnesJsonTurns<T> {
  readonly prompt: string
  /** Prompt for the single retry, given the first parse error. */
  readonly repair: (message: string) => string
  /** Must throw on anything it cannot fully trust. */
  readonly parse: (text: string) => T
}

export type AgnesJsonResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: string; readonly message: string }

function guardReason(name: string): string {
  return `工具 '${name}' 已禁用：这次只做文本整理，不允许读写文件或执行命令。`
}

export async function runAgnesJson<T>(
  ctx: Context,
  options: AgnesJsonOptions,
  turns: AgnesJsonTurns<T>,
): Promise<AgnesJsonResult<T>> {
  if (!ctx.agents) {
    return { ok: false, code: 'no-agent-runtime', message: '当前 profile 没有提供 agent 运行时' }
  }
  if (options.signal.aborted) {
    return { ok: false, code: 'cancelled', message: '已取消' }
  }

  const sessionId = SessionId(options.sessionId)
  const selection = { provider: options.provider, model: options.model }
  let handle: any
  let timeout: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  let wakeAbort: () => void = () => undefined
  const aborted = new Promise<void>((resolve) => { wakeAbort = resolve })
  const onAbort = (): void => {
    handle?.agent?.cancel({ kind: 'hook', reason: 'daily plan request cancelled' })
    wakeAbort()
  }
  options.signal.addEventListener('abort', onAbort, { once: true })
  const boundedIdle = async (): Promise<void> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([handle.agent.whenIdle(), new Promise<void>((resolve) => { timer = setTimeout(resolve, 2000) })])
    } finally { if (timer !== undefined) clearTimeout(timer) }
  }

  const archive = async (): Promise<void> => {
    try {
      if (ctx.workspaceRegistry) await ctx.workspaceRegistry.archiveSession(sessionId)
    } catch (error) {
      ctx.logger?.warn?.(`[dsh-daily-plan] 归档${options.label}会话失败：${String(error)}`)
    }
  }

  try {
    const createOptions = {
      sessionId,
      signal: options.signal,
      meta: { cwd: options.workspacePath, agentPreset: options.agentPreset },
      agentOptions: { provider: selection.provider, model: selection.model },
      setup: async (agentCtx: Context): Promise<void> => {
        if (ctx.agentPresets) await ctx.agentPresets.mount(agentCtx, options.agentPreset)
        installModelSelection(agentCtx, { current: selection, assembled: undefined })
        const agent = (agentCtx as any).agent
        if (agent === undefined) throw new Error(`${options.label}会话没有拿到 scoped Agent`)
        setSandboxMode(agent.session, 'read-only')
        setApprovalPolicy(agent.session, 'never')
        ;(agentCtx as any).tools?.guard?.((execution: ToolExecution) => guardReason(execution.name))
      },
    }
    handle =
      typeof ctx.agents.withoutInitiator === 'function'
        ? await ctx.agents.withoutInitiator(() => ctx.agents.create(createOptions))
        : await ctx.agents.create(createOptions)

    await handle.agent.whenIdle()
    await archive()

    const runTurn = async (prompt: string, limitMs: number): Promise<{ text: string; completed: boolean }> => {
      const firstSeq: number = handle.agent.session.seq
      handle.agent.followup(
        createUserMessage({
          content: [{ type: 'text', text: prompt }],
          source: { kind: 'automation', automationId: 'dsh-daily-plan', runId: String(sessionId) },
        }),
      )
      timedOut = false
      const idle = handle.agent.whenIdle()
      const deadline = new Promise<void>((resolve) => {
        timeout = setTimeout(() => {
          timedOut = true
          handle.agent.cancel({ kind: 'hook', reason: `daily plan ${options.label} timeout` })
          resolve()
        }, limitMs)
      })
      await Promise.race([idle, deadline, aborted])
      if (timedOut || options.signal.aborted) await boundedIdle()
      if (timeout !== undefined) {
        clearTimeout(timeout)
        timeout = undefined
      }
      try {
        if (ctx.sessions) await ctx.sessions.flush(handle.agent.session)
      } catch {
        // Flushing is best-effort.
      }
      await archive()
      const events: readonly SessionEvent[] = sessionEvents(handle.agent.session)
      if (events.length === 0) {
        ctx.logger?.warn?.(
          `[dsh-daily-plan] ${options.label}读不到会话事件（session.log 为空），这一轮会被判定为未完成`,
        )
      }
      return finalAssistantText(events, firstSeq)
    }

    const first = await runTurn(turns.prompt, options.timeoutMs)
    if (options.signal.aborted) return { ok: false, code: 'cancelled', message: '已取消' }
    if (timedOut) {
      return {
        ok: false,
        code: 'timeout',
        message: `Agnes ${options.label}超过 ${String(Math.round(options.timeoutMs / 60_000))} 分钟`,
      }
    }
    if (!first.completed) return { ok: false, code: 'incomplete', message: 'Agnes 没有正常结束这一轮' }

    try {
      return { ok: true, value: turns.parse(first.text) }
    } catch (firstError) {
      const message = firstError instanceof Error ? firstError.message : String(firstError)
      const repair = await runTurn(turns.repair(message), Math.min(options.timeoutMs, 10 * 60_000))
      if (options.signal.aborted) return { ok: false, code: 'cancelled', message: '已取消' }
      if (timedOut || !repair.completed) {
        return {
          ok: false,
          code: 'repair-failed',
          message: 'Agnes 返回的格式不完整，自动纠错未完成。原文已保留，可以再试一次。',
        }
      }
      try {
        return { ok: true, value: turns.parse(repair.text) }
      } catch (repairError) {
        ctx.logger?.warn?.(`[dsh-daily-plan] ${options.label}返回校验失败：${String(repairError)}`)
        return {
          ok: false,
          code: 'parse-failed',
          message: 'Agnes 的返回仍缺少有效信息，这次没有应用安排。原文已保留，请重新整理；详情已记入插件日志。',
        }
      }
    }
  } catch (error) {
    return {
      ok: false,
      code: 'agnes-error',
      message: `Agnes 调用失败：${error instanceof Error ? error.message : String(error)}`,
    }
  } finally {
    options.signal.removeEventListener('abort', onAbort)
    if (timeout !== undefined) clearTimeout(timeout)
    try {
      await handle?.dispose?.()
    } catch {
      // Disposal is best-effort.
    }
  }
}
