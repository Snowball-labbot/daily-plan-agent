import type { Context } from '@deepseek-ai/cordis'
import type { BodyPartValue, CategoryValue, ReviewRecord } from './domain.ts'
import type { BlockInput, DailyPlanService, RollforwardItem } from './service.ts'
import { probeAgnes } from './review.ts'
import type { CloudBridge } from './cloudBridge.ts'

const CHANNEL = '/dsh-daily-plan'

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function str(value: unknown, label: string): string {
  if (typeof value !== 'string' || value === '') throw new Error(`${label} 不能为空`)
  return value
}

function optStr(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function num(value: unknown, label: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`${label} 必须是数字`)
  return parsed
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function list(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是数组`)
  return value.map((item) => String(item))
}

function blockInput(value: unknown): BlockInput {
  const source = record(value)
  // Built imperatively: with exactOptionalPropertyTypes a conditional spread
  // widens optional props to include undefined, which then fails to assign.
  const out: {
    id?: string
    title: string
    category?: CategoryValue
    startPeriod: number
    endPeriod: number
    source?: 'course' | 'backlog' | 'manual' | 'carry'
    colorKey: string
    backlogId: string | null
    gymDate: string | null
    note: string
  } = {
    title: str(source['title'], 'block.title'),
    startPeriod: num(source['startPeriod'], 'block.startPeriod'),
    endPeriod: num(source['endPeriod'], 'block.endPeriod'),
    colorKey: typeof source['colorKey'] === 'string' ? source['colorKey'] : '',
    backlogId: optStr(source['backlogId']) ?? null,
    gymDate: optStr(source['gymDate']) ?? null,
    note: typeof source['note'] === 'string' ? source['note'] : '',
  }
  const id = optStr(source['id'])
  if (id !== undefined) out.id = id
  const category = optStr(source['category'])
  if (category !== undefined) out.category = category as CategoryValue
  const blockSource = optStr(source['source'])
  if (blockSource !== undefined) out.source = blockSource as 'course' | 'backlog' | 'manual' | 'carry'
  return out
}

function rollforwardItems(value: unknown): RollforwardItem[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const source = record(item)
    return {
      blockId: optStr(source['blockId']) ?? null,
      title: str(source['title'], 'carryOver.title'),
      category: (optStr(source['category']) ?? 'study') as CategoryValue,
      periods: Number.isFinite(Number(source['periods'])) ? Math.max(1, Number(source['periods'])) : 2,
      suggestDate: str(source['suggestDate'], 'carryOver.suggestDate'),
    }
  })
}

export function registerDailyPlanRpc(ctx: Context, service: DailyPlanService, cloud?: CloudBridge): () => unknown {
  return ctx.connection.rpc.handle(
    CHANNEL,
    async (endpoint: string, raw: unknown, signal: AbortSignal): Promise<unknown> => {
      try {
        if (signal?.aborted === true) throw new Error('请求已取消')
        const payload = record(raw)
        if (cloud && (endpoint.startsWith('cloud.') || cloud.enabled)) return await cloud.call(endpoint,payload,signal)

        // ── plan ──────────────────────────────────────────────────────────
        if (endpoint === 'snapshot') {
          void service.prepareToday().catch(() => undefined)
          return ok(service.snapshot(optStr(payload['date']), optStr(payload['weekKey'])))
        }
        if (endpoint === 'workflow.context') return ok(service.workflowContext(optStr(payload['weekKey'])))
        if (endpoint === 'workflow.history') return ok(service.workflowHistory(optStr(payload['weekKey'])))
        if (endpoint === 'workflow.status') return ok(service.workflowStatus(str(payload['id'], 'id')))
        if (endpoint === 'workflow.cancel') return ok(await service.workflowCancel(str(payload['id'], 'id')))
        if (endpoint === 'workflow.start') {
          if (!['plan', 'replan', 'weekly', 'review'].includes(String(payload['mode']))) throw new Error('无效的工作流模式')
          const input: any = { ...payload, text: typeof payload['text'] === 'string' ? payload['text'] : '', apply: bool(payload['apply']) }
          return ok(await service.workflowStart(input))
        }
        if (endpoint === 'workflow.run') {
          const mode = payload['mode']
          if (!['plan', 'replan', 'weekly', 'review'].includes(String(mode))) throw new Error('无效的工作流模式')
          const weekKey = optStr(payload['weekKey'])
          return ok(await service.workflowRun({ text: typeof payload['text'] === 'string' ? payload['text'] : '',
            mode: mode as 'plan' | 'replan' | 'weekly' | 'review', ...(weekKey ? { weekKey } : {}),
            ...(optStr(payload['rangeStart']) ? { rangeStart: optStr(payload['rangeStart'])! } : {}),
            ...(optStr(payload['planStart']) ? { planStart: optStr(payload['planStart'])! } : {}),
            ...(optStr(payload['planEnd']) ? { planEnd: optStr(payload['planEnd'])! } : {}),
            replaceConflicts: bool(payload['replaceConflicts']),
            ...(optStr(payload['rangeEnd']) ? { rangeEnd: optStr(payload['rangeEnd'])! } : {}), apply: bool(payload['apply']), signal }))
        }
        if (endpoint === 'workflow.apply') return ok(await service.workflowApply(str(payload['id'], 'id'), typeof payload['replaceConflicts'] === 'boolean' ? payload['replaceConflicts'] : undefined))
        if (endpoint === 'workflow.draft.update') return ok(await service.workflowEditDraft(str(payload['id'], 'id'), payload['edits'], optStr(payload['expectedUpdatedAt'])))
        if (endpoint === 'workflow.schedule.update') return ok(await service.workflowEditSchedule(str(payload['id'], 'id'), payload['edits'], optStr(payload['expectedUpdatedAt'])))
        if (endpoint === 'workflow.replan') return ok(await service.replan(optStr(payload['fromDate'])))
        if (endpoint === 'workflow.memory.remove') return ok(await service.removeMemory(str(payload['id'], 'id')))
        if (endpoint === 'plan.day') return ok(service.dayPlan(str(payload['date'], 'date')))
        if (endpoint === 'plan.generate-week') {
          return ok(await service.generateWeek(str(payload['weekKey'], 'weekKey')))
        }
        if (endpoint === 'plan.generate-term') return ok(await service.generateTerm())
        if (endpoint === 'routines.draft') {
          return ok(await service.draftRoutines(str(payload['description'], 'description')))
        }
        if (endpoint === 'plan.clear-week') {
          return ok(await service.clearWeek(str(payload['weekKey'], 'weekKey')))
        }
        if (endpoint === 'plan.block.upsert') {
          return ok(await service.upsertBlock(str(payload['date'], 'date'), blockInput(payload['block'])))
        }
        if (endpoint === 'plan.block.remove') {
          return ok(await service.removeBlock(str(payload['date'], 'date'), str(payload['blockId'], 'blockId')))
        }
        if (endpoint === 'plan.block.move') {
          return ok(
            await service.moveBlock(
              str(payload['date'], 'date'),
              str(payload['blockId'], 'blockId'),
              str(payload['toDate'], 'toDate'),
              num(payload['startPeriod'], 'startPeriod'),
              num(payload['endPeriod'], 'endPeriod'),
            ),
          )
        }
        if (endpoint === 'plan.block.toggle') {
          return ok(
            await service.toggleBlock(
              str(payload['date'], 'date'),
              str(payload['blockId'], 'blockId'),
              bool(payload['done'], true),
            ),
          )
        }
        if (endpoint === 'plan.block.feedback') {
          return ok(await service.feedbackBlock(str(payload['date'],'date'),str(payload['blockId'],'blockId'),payload))
        }
        if (endpoint === 'plan.block.reorder-day') {
          return ok(
            await service.reorderDay(str(payload['date'], 'date'), list(payload['orderedIds'], 'orderedIds')),
          )
        }
        if (endpoint === 'plan.snap-gap') {
          return ok(
            service.snapGap(
              str(payload['weekKey'], 'weekKey'),
              num(payload['weekday'], 'weekday'),
              num(payload['period'], 'period'),
            ),
          )
        }
        if (endpoint === 'plan.rollforward') {
          return ok(await service.rollforward(str(payload['fromDate'], 'fromDate'), rollforwardItems(payload['items'])))
        }

        // ── courses ───────────────────────────────────────────────────────
        if (endpoint === 'courses.list') return ok(service.listCourses())
        if (endpoint === 'courses.upsert') {
          const course = record(payload['course'])
          return ok(await service.upsertCourse({ ...course, name: str(course['name'], 'course.name') } as never))
        }
        if (endpoint === 'courses.remove') return ok(await service.removeCourse(str(payload['id'], 'id')))
        if (endpoint === 'courses.parse-paste') return ok(service.parseCourses(str(payload['text'], 'text')))
        if (endpoint === 'courses.import') {
          const rows = Array.isArray(payload['rows']) ? (payload['rows'] as never[]) : []
          return ok(await service.importCourses(rows, bool(payload['replace'], false)))
        }

        // ── backlog ───────────────────────────────────────────────────────
        if (endpoint === 'backlog.list') return ok(service.listBacklog())
        if (endpoint === 'backlog.upsert') {
          const item = record(payload['item'])
          return ok(await service.upsertBacklog({ ...item, title: str(item['title'], 'item.title') } as never))
        }
        if (endpoint === 'backlog.remove') return ok(await service.removeBacklog(str(payload['id'], 'id')))

        // ── gym ───────────────────────────────────────────────────────────
        if (endpoint === 'gym.exercises') {
          const list = service.listExercises()
          // An empty library is never a legitimate state — it means seeding
          // failed. Self-heal here so the failure surfaces as an error the page
          // can show, instead of a blank panel the user can only stare at.
          if (list.length > 0) return ok(list)
          return ok(await service.resetExerciseSeed())
        }
        if (endpoint === 'gym.exercise.upsert') {
          const exercise = record(payload['exercise'])
          return ok(
            await service.upsertExercise({
              ...exercise,
              name: str(exercise['name'], 'exercise.name'),
              part: str(exercise['part'], 'exercise.part') as BodyPartValue,
            } as never),
          )
        }
        if (endpoint === 'gym.exercise.remove') return ok(await service.removeExercise(str(payload['id'], 'id')))
        if (endpoint === 'gym.exercise.reset-seed') return ok(await service.resetExerciseSeed())
        if (endpoint === 'gym.session') return ok(service.gymSession(str(payload['date'], 'date')))
        if (endpoint === 'gym.performance') return ok(service.gymPerformance(optStr(payload['date'])))
        if (endpoint === 'gym.set.log') return ok(await service.logGymSet(str(payload['date'], 'date'), str(payload['itemId'], 'itemId'),
          record(payload['set']) as never, optStr(payload['requestId'])))
        if (endpoint === 'gym.set.remove') return ok(await service.removeGymSet(str(payload['date'], 'date'), str(payload['itemId'], 'itemId'), str(payload['setId'], 'setId')))
        if (endpoint === 'gym.focus.suggest') return ok(service.suggestGymFocus(str(payload['date'], 'date')))
        if (endpoint === 'gym.focus.set') {
          return ok(
            await service.setGymFocus(
              str(payload['date'], 'date'),
              list(payload['focus'], 'focus') as BodyPartValue[],
              bool(payload['rotate'], false),
            ),
          )
        }
        if (endpoint === 'gym.item.add') {
          const atIndex = payload['atIndex'] === undefined ? undefined : num(payload['atIndex'], 'atIndex')
          return ok(
            await service.addGymItem(
              str(payload['date'], 'date'),
              str(payload['exerciseId'], 'exerciseId'),
              atIndex,
            ),
          )
        }
        if (endpoint === 'gym.item.update') {
          return ok(
            await service.updateGymItem(
              str(payload['date'], 'date'),
              str(payload['itemId'], 'itemId'),
              record(payload['patch']) as never,
            ),
          )
        }
        if (endpoint === 'gym.item.remove') {
          return ok(await service.removeGymItem(str(payload['date'], 'date'), str(payload['itemId'], 'itemId')))
        }
        if (endpoint === 'gym.item.reorder') {
          return ok(
            await service.reorderGymItems(str(payload['date'], 'date'), list(payload['orderedIds'], 'orderedIds')),
          )
        }
        if (endpoint === 'gym.apply-last') {
          const part = optStr(payload['part'])
          return ok(
            await service.applyLastGymSession(str(payload['date'], 'date'), (part ?? null) as BodyPartValue | null),
          )
        }
        if (endpoint === 'gym.session.plan') {
          return ok(await service.queueGymSession(str(payload['date'], 'date')))
        }
        if (endpoint === 'gym.session.finish') {
          const feeling = payload['feeling'] === undefined || payload['feeling'] === null
            ? null
            : num(payload['feeling'], 'feeling')
          return ok(await service.finishGymSession(str(payload['date'], 'date'), feeling))
        }

        // ── review ────────────────────────────────────────────────────────
        if (endpoint === 'review.get') return ok(service.review(str(payload['date'], 'date')))
        if (endpoint === 'review.history') {
          const limit = payload['limit'] === undefined ? 120 : num(payload['limit'], 'limit')
          return ok(service.reviewHistory(limit))
        }
        if (endpoint === 'review.draft.save') {
          const rawInput = record(payload['raw'])
          const used = Array.isArray(rawInput['usedPrompts']) ? rawInput['usedPrompts'] : []
          return ok(
            await service.saveDraft(str(payload['date'], 'date'), {
              text: typeof rawInput['text'] === 'string' ? rawInput['text'] : '',
              usedPrompts: used.filter((item): item is 'did' | 'missed' | 'adjust' =>
                item === 'did' || item === 'missed' || item === 'adjust',
              ),
            }),
          )
        }
        if (endpoint === 'review.structure') {
          return ok(await service.structure(str(payload['date'], 'date'), bool(payload['force'], false)))
        }
        if (endpoint === 'review.commit') {
          return ok(
            await service.commitReview(
              str(payload['date'], 'date'),
              (payload['structured'] ?? null) as ReviewRecord['structured'],
              rollforwardItems(payload['plan'] ?? payload['carryOver']),
            ),
          )
        }
        if (endpoint === 'review.remove') return ok(await service.removeReview(str(payload['date'], 'date')))

        // ── stats ─────────────────────────────────────────────────────────
        if (endpoint === 'stats.range') {
          return ok(service.statsRange(str(payload['from'], 'from'), str(payload['to'], 'to')))
        }
        if (endpoint === 'stats.summary') {
          return ok(service.statsSummary(str(payload['from'], 'from'), str(payload['to'], 'to')))
        }
        if (endpoint === 'stats.day') return ok(service.statsDay(str(payload['date'], 'date')))

        // ── reading ───────────────────────────────────────────────────────
        if (endpoint === 'reading.list') return ok(service.listReading())
        if (endpoint === 'reading.upsert') {
          const item = record(payload['item'])
          return ok(await service.upsertReading({ ...item, title: str(item['title'], 'item.title') } as never))
        }
        if (endpoint === 'reading.remove') return ok(await service.removeReading(str(payload['id'], 'id')))
        if (endpoint === 'reading.progress') {
          return ok(
            await service.setReadingProgress(
              str(payload['id'], 'id'),
              num(payload['value'], 'value'),
              optStr(payload['date']),
            ),
          )
        }
        if (endpoint === 'reading.archive') {
          const item = record(payload['item'])
          return ok(await service.upsertReading({ ...item, title: str(item['title'], 'item.title') } as never))
        }

        // ── learning ──────────────────────────────────────────────────────
        if (endpoint === 'learning.list') return ok(service.listLearning())
        if (endpoint === 'learning.upsert') {
          const item = record(payload['item'])
          return ok(await service.upsertLearning({ ...item, title: str(item['title'], 'item.title') } as never))
        }
        if (endpoint === 'learning.remove') return ok(await service.removeLearning(str(payload['id'], 'id')))
        if (endpoint === 'learning.count') {
          return ok(
            await service.setLearningCount(
              str(payload['id'], 'id'),
              num(payload['value'], 'value'),
              optStr(payload['date']),
            ),
          )
        }
        if (endpoint === 'learning.bump') {
          const id = str(payload['id'], 'id')
          const delta = num(payload['delta'], 'delta')
          const date = optStr(payload['date'])
          const current = service.listLearning().find((item) => item.id === id)
          if (current === undefined) throw new Error('没有这条学习记录')
          const last = date === undefined ? current.done : (current.log.find((entry) => entry.date === date)?.value ?? current.done)
          return ok(await service.setLearningCount(id, last + delta, date))
        }
        if (endpoint === 'learn.week-stats') {
          return ok(service.learnWeekStats(str(payload['from'], 'from'), str(payload['to'], 'to')))
        }
        if (endpoint === 'learn.streak') return ok({ streak: service.learnStreak() })

        // ── settings / data ───────────────────────────────────────────────
        if (endpoint === 'settings.get') return ok(service.settings())
        if (endpoint === 'settings.update') return ok(await service.updateSettings(record(payload['patch'])))
        if (endpoint === 'settings.agnes.check') {
          const settings = service.settings()
          return ok({
            provider: settings.agnes.provider,
            model: settings.agnes.model,
            agentPreset: settings.agnes.agentPreset,
            timeoutMinutes: settings.agnes.timeoutMinutes,
            rosterDiscoverable: false,
            note: '本机无法静态列出 agent preset 名册；standard 与 cordis 是已知可用的两个。',
          })
        }
        if (endpoint === 'settings.agnes.probe') {
          const settings = service.settings()
          return ok(
            await probeAgnes(ctx, {
              provider: settings.agnes.provider,
              model: settings.agnes.model,
              agentPreset: settings.agnes.agentPreset,
              workspacePath: service.workspacePath(),
              timeoutMs: 90_000,
            }),
          )
        }
        if (endpoint === 'export.json') return ok(service.exportAll())
        if (endpoint === 'import.json') {
          const mode = payload['mode'] === 'replace' ? 'replace' : 'merge'
          return ok(await service.importAll(record(payload['payload']), mode))
        }

        throw new Error(`unknown endpoint '${endpoint}'`)
      } catch (error) {
        return {
          ok: false,
          error: {
            code: 'daily-plan-error',
            message: error instanceof Error ? error.message : String(error),
            details: { endpoint },
          },
        }
      }
    },
    { authority: 'loopback' },
  )
}

function ok(value: unknown): unknown {
  return { ok: true, value }
}

export { CHANNEL }
