import { useEffect, useMemo, useRef, useState } from 'react'
import { addDays, isoDate, isoWeekKey, parseIsoDate, todayIso, weekdayZh } from '../../clock.ts'
import { activeBlock, flexibleBlock } from '../../adaptive.ts'
import type { StatsDayPayload } from '../wire.ts'
import type { CarryOverRecord, ReviewRecord, StructuredReviewRecord } from '../../domain.ts'
import { Icon } from '../icons.tsx'
import { Card, Dots, Empty, PageShell } from '../ui/kit.tsx'
import type { PageProps } from './types.ts'

type PromptKey = 'did' | 'missed' | 'adjust'

const PROMPTS: readonly { key: PromptKey; label: string }[] = [
  { key: 'did', label: 'review.promptDid' },
  { key: 'missed', label: 'review.promptMissed' },
  { key: 'adjust', label: 'review.promptAdjust' },
]

function emptyStructured(): StructuredReviewRecord {
  return {
    summary: '',
    achievements: [],
    blockers: [],
    adjustments: [],
    plan: [],
    learning: [],
    energy: null,
    mood: null,
    tags: [],
  }
}

export function ReviewPage({ t, state, runtime }: PageProps): JSX.Element {
  const snapshot = state.snapshot
  /**
   * The day being reviewed. Defaults to today, but any date can be opened —
   * from here, or by clicking a cell on the Record page.
   */
  const date = state.reviewDate ?? snapshot?.todayIso ?? todayIso()
  const [stored, setStored] = useState<ReviewRecord | null>(null)
  const [dayData, setDayData] = useState<StatsDayPayload | null>(null)
  const [loadedDate, setLoadedDate] = useState<string | null>(null)

  // `nowIso` moves on every snapshot reload (which every mutation triggers), so
  // this keeps the record in step without threading reloads through the actions.
  useEffect(() => {
    let cancelled = false
    void (runtime.statsDay(date) as Promise<StatsDayPayload>).then((data) => {
      if (cancelled) return
      setStored(data.review); setDayData(data); setLoadedDate(date)
    }).catch((error) => { if (!cancelled) runtime.notify(error instanceof Error ? error.message : String(error)) })
    return () => { cancelled = true }
  }, [runtime, date, snapshot?.nowIso])

  const [text, setText] = useState('')
  const [used, setUsed] = useState<PromptKey[]>([])
  const [busy, setBusy] = useState(false)
  /** Unticked progress updates are not applied. Absent = ticked. */
  const [learningOn, setLearningOn] = useState<Record<string, boolean>>({})
  const [structured, setStructured] = useState<StructuredReviewRecord | null>(null)
  const [selected, setSelected] = useState<Record<string, string>>({})
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const hydratedFor = useRef<string | null>(null)

  // Hydrate once per date, then let the user own the buffer.
  useEffect(() => {
    if (snapshot === null || loadedDate !== date || hydratedFor.current === date) return
    hydratedFor.current = date
    setText(stored?.raw.text ?? '')
    setUsed(stored?.raw.usedPrompts ?? [])
    setStructured(stored?.structured ?? null)
    const defaults: Record<string, string> = {}
    for (const item of stored?.structured?.plan ?? []) {
      const anchor = item.blockId ?? item.title
      defaults[anchor] = item.suggestDate
    }
    setSelected(defaults)
    setLearningOn({})
  }, [snapshot, date, stored, loadedDate])

  const openBlocks = useMemo(
    () => dayData?.date === date ? dayData.plan.blocks.filter((block) => activeBlock(block) && flexibleBlock(block) && !block.done) : [],
    [dayData, date],
  )

  if (snapshot === null) {
    return (
      <PageShell title={t('nav.review')}>
        <Empty title={t('common.loading')} />
      </PageShell>
    )
  }

  const autoGrow = (): void => {
    const el = textareaRef.current
    if (el === null) return
    el.style.height = 'auto'
    el.style.height = `${String(Math.max(160, el.scrollHeight))}px`
  }

  const insertPrompt = (key: PromptKey): void => {
    const label = t(`review.prompt${key === 'did' ? 'Did' : key === 'missed' ? 'Missed' : 'Adjust'}`)
    const el = textareaRef.current
    const at = el === null ? text.length : (el.selectionStart ?? text.length)
    const before = text.slice(0, at)
    const after = text.slice(at)
    const separator = before === '' || before.endsWith('\n') ? '' : '\n'
    const insert = `${separator}${label}\n`
    setText(`${before}${insert}${after}`)
    setUsed((prev) => (prev.includes(key) ? prev : [...prev, key]))
    requestAnimationFrame(() => {
      const node = textareaRef.current
      if (node === null) return
      const caret = at + insert.length
      node.focus()
      node.setSelectionRange(caret, caret)
      autoGrow()
    })
  }

  const save = async (): Promise<void> => {
    await runtime.saveDraft(date, { text, usedPrompts: used })
    await runtime.refresh()
  }

  const runStructure = async (): Promise<void> => {
    if (text.trim() === '') {
      runtime.notify(t('review.needText'))
      return
    }
    setBusy(true)
    try {
      await runtime.saveDraft(date, { text, usedPrompts: used })
      const result = (await runtime.structureReview(date, false)) as ReviewRecord
      setStructured(result.structured)
      const defaults: Record<string, string> = {}
      for (const item of result.structured?.plan ?? []) {
        defaults[item.blockId ?? item.title] = item.suggestDate
      }
      setSelected(defaults)
      await runtime.refresh()
      if (result.status === 'failed') runtime.notify(t('review.failed'))
      else runtime.notify(t('review.done'))
    } catch (error) {
      runtime.notify(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const keyOf = (item: { readonly ref: string | null; readonly title: string }): string =>
    item.ref ?? item.title

  const commit = async (): Promise<void> => {
    if (structured === null) return
    const plan = structured.plan.map((item) => ({
      ...item,
      suggestDate: selected[item.blockId ?? item.title] ?? item.suggestDate,
    }))
    // Unticked progress updates are dropped here rather than in the host: the
    // user's tick is the decision, and the review record should reflect it.
    const learning = structured.learning.filter((item) => learningOn[keyOf(item)] !== false)
    setBusy(true)
    try {
      await runtime.commitReview(date, { ...structured, learning }, plan)
      await runtime.refresh()
      runtime.notify(t('review.archived'))
    } catch (error) {
      runtime.notify(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const patch = (next: Partial<StructuredReviewRecord>): void => {
    setStructured((prev) => ({ ...(prev ?? emptyStructured()), ...next }))
  }

  return (
    <PageShell
      title="复盘记录"
      sub={`${date} · ${stored === null ? '随时复盘，不必每天填写' : t(`review.status.${stored.status}`)}`}
      actions={
        <>
          {/* A review is a record: any day can be reopened, not just today. */}
          <span className="dp-daynav">
            <button
              type="button"
              className="dp-btn dp-btn--sm dp-btn--icon"
              aria-label={t('review.prevDay')}
              disabled={busy}
              onClick={() => {
                runtime.setReviewDate(isoDate(addDays(parseIsoDate(date), -1)))
              }}
            >
              <Icon name="chevronLeft" size={14} />
            </button>
            <button
              type="button"
              className="dp-btn dp-btn--sm"
              disabled={busy || date === snapshot?.todayIso}
              onClick={() => {
                runtime.setReviewDate(null)
              }}
            >
              {date === snapshot?.todayIso ? t('gym.isToday') : t('gym.backToToday')}
            </button>
            <button
              type="button"
              className="dp-btn dp-btn--sm dp-btn--icon"
              aria-label={t('review.nextDay')}
              disabled={busy}
              onClick={() => {
                runtime.setReviewDate(isoDate(addDays(parseIsoDate(date), 1)))
              }}
            >
              <Icon name="chevronRight" size={14} />
            </button>
          </span>
        </>
      }
    >
      
      
      <details className="dp-workflow-disclosure dp-journal-archive" open><summary><Icon name="review" size={16} />当日原文与手动编辑记录<span className="dp-faint">需要时再展开</span></summary>
      <div className="dp-btnrow"><button type="button" className="dp-btn dp-btn--sm" disabled={busy || loadedDate !== date} onClick={() => { void save() }}>保存当日草稿</button>
        <button type="button" className="dp-btn dp-btn--sm" disabled={busy || loadedDate !== date} onClick={() => { void runStructure() }}>{busy ? t('review.structuring') : '仅整理这份记录'}</button>
      </div>
      {stored?.rangeStart && stored.rangeStart !== date && <p className="dp-faint">这份原文覆盖 {stored.rangeStart} — {stored.rangeEnd}；各项实际进度按明确日期保存。</p>}
      <div className="dp-split">
        <div>
          <div className="dp-prompts">
            <span className="dp-faint">{t('review.promptHint')}</span>
            {PROMPTS.map((prompt) => (
              <button
                key={prompt.key}
                type="button"
                className="dp-chip"
                data-on={used.includes(prompt.key) ? 'true' : undefined}
                onClick={() => {
                  insertPrompt(prompt.key)
                }}
              >
                {t(prompt.label)}
              </button>
            ))}
          </div>
          <textarea
            ref={textareaRef}
            className="dp-review-input"
            value={text}
            disabled={busy || loadedDate !== date}
            placeholder={t('review.placeholder')}
            onChange={(event) => {
              setText(event.target.value)
              autoGrow()
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                void runStructure()
              }
            }}
          />

          {stored?.status === 'failed' && stored.error !== null && (
            <div className="dp-error" role="alert">
              <Icon name="warn" size={13} />
              <span>
                {t('review.errorWhy')}：{stored.error.message}
                <span className="dp-faint"> ({stored.error.code})</span>
              </span>
              <span className="dp-spacer" />
              <button
                type="button"
                className="dp-btn dp-btn--sm"
                disabled={busy}
                onClick={() => {
                  void runStructure()
                }}
              >
                {t('review.retry')}
              </button>
            </div>
          )}
          {(stored?.applyWarnings ?? []).map((message) => <div key={message} className="dp-error" role="alert">{message}</div>)}

          {structured !== null && (
            <>
              <div className="dp-subhead">
                <span>{t('review.result')}</span>
                <span className="dp-faint">{t('review.editable')}</span>
              </div>
              <Card>
                <label className="dp-label" htmlFor="dp-summary">
                  {t('review.summary')}
                </label>
                <textarea
                  id="dp-summary"
                  className="dp-review-summary"
                  rows={2}
                  value={structured.summary}
                  onChange={(event) => {
                    patch({ summary: event.target.value })
                  }}
                />
                {/* Empty sections are not rendered: three blank boxes with a "+"
                    in each read as a form to fill in, which is the opposite of
                    "hand it to Agnes and get your own thinking tidied up". */}
                {structured.achievements.length > 0 && (
                  <ListEditor
                    label={t('review.achievements')}
                    tone="good"
                    items={structured.achievements}
                    onChange={(items) => {
                      patch({ achievements: items })
                    }}
                  />
                )}
                {structured.blockers.length > 0 && (
                  <ListEditor
                    label={t('review.blockers')}
                    tone="bad"
                    items={structured.blockers}
                    onChange={(items) => {
                      patch({ blockers: items })
                    }}
                  />
                )}
                {structured.adjustments.length > 0 && (
                  <ListEditor
                    label={t('review.adjustments')}
                    tone="warn"
                    items={structured.adjustments}
                    onChange={(items) => {
                      patch({ adjustments: items })
                    }}
                  />
                )}
                <div className="dp-addrow-bar">
                  <span className="dp-faint">{t('review.addTo')}</span>
                  {(
                    [
                      ['achievements', t('review.achievements')],
                      ['blockers', t('review.blockers')],
                      ['adjustments', t('review.adjustments')],
                    ] as const
                  ).map(([field, label]) => (
                    <button
                      key={field}
                      type="button"
                      className="dp-btn dp-btn--sm"
                      onClick={() => {
                        patch({ [field]: [...structured[field], ''] } as Partial<StructuredReviewRecord>)
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="dp-score-row">
                  <span>{t('review.energy')}</span>
                  <Dots
                    total={5}
                    filled={structured.energy ?? 0}
                    label={t('review.energy')}
                    onPick={(value) => {
                      patch({ energy: value === 0 ? null : value })
                    }}
                  />
                  <span>{t('review.mood')}</span>
                  <Dots
                    total={5}
                    filled={structured.mood ?? 0}
                    label={t('review.mood')}
                    onPick={(value) => {
                      patch({ mood: value === 0 ? null : value })
                    }}
                  />
                  <span className="dp-spacer" />
                  <input
                    style={{ width: 200 }}
                    placeholder={t('review.tagsPlaceholder')}
                    value={structured.tags.join(' ')}
                    onChange={(event) => {
                      patch({
                        tags: event.target.value
                          .split(/\s+/u)
                          .map((tag) => tag.replace(/^#/u, '').trim())
                          .filter((tag) => tag !== '')
                          .slice(0, 8),
                      })
                    }}
                  />
                </div>
              </Card>
            </>
          )}

          {structured !== null && structured.learning.length > 0 && (
            <>
              <div className="dp-subhead">
                <span>{t('review.learningTitle')}</span>
                <span className="dp-faint">{t('review.learningHint')}</span>
              </div>
              <div className="dp-learning-updates">
                {structured.learning.map((item) => {
                  const key = keyOf(item)
                  const on = learningOn[key] !== false
                  return (
                    <label key={key} className="dp-learning-row" data-on={on ? 'true' : undefined}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => {
                          setLearningOn((prev) => ({ ...prev, [key]: !on }))
                        }}
                      />
                      <Icon name={item.kind === 'reading' ? 'list' : 'target'} size={12} />
                      <span className="dp-learning-title">{item.title}</span>
                      <span className="dp-learning-delta">
                        {item.mode === 'total'
                          ? t('review.learningTotal', { value: String(item.value) })
                          : t('review.learningDelta', { value: String(item.value) })}
                      </span>
                    </label>
                  )
                })}
              </div>
            </>
          )}

          {structured !== null && <button type="button" className="dp-btn dp-btn--primary" disabled={busy || loadedDate !== date} onClick={() => { void commit() }}>
            归档并联动学习与计划
          </button>}
          <div className="dp-subhead">
            <span>{t('review.carryTitle')}</span>
            <span className="dp-faint">{t('review.carryHint')}</span>
          </div>
          {structured !== null && structured.plan.length > 0 ? (
            <div className="dp-carry">
              {(['carry', 'new'] as const).map((group) => {
                const items = structured.plan.filter((item) => item.kind === group)
                if (items.length === 0) return null
                return (
                  <div key={group} className="dp-carry-group">
                    <div className="dp-carry-group-head">
                      <Icon name={group === 'carry' ? 'clock' : 'sparkle'} size={12} />
                      {group === 'carry' ? t('review.groupCarry') : t('review.groupNew')}
                      <span className="dp-faint">{String(items.length)}</span>
                    </div>
                    {items.map((item, index) => (
                      <CarryRow
                        key={`${item.blockId ?? item.title}-${String(index)}`}
                        t={t}
                        item={item}
                        date={date}
                        value={selected[item.blockId ?? item.title] ?? item.suggestDate}
                        onChange={(next) => {
                          setSelected((prev) => ({ ...prev, [item.blockId ?? item.title]: next }))
                        }}
                      />
                    ))}
                  </div>
                )
              })}
            </div>
          ) : (
            <CarryFallback
              t={t}
              blocks={openBlocks}
              date={date}
              onApply={(items, dates) => {
                const carry: CarryOverRecord[] = items.map((block) => ({
                  kind: 'carry' as const,
                  blockId: block.id,
                  title: block.title,
                  category: block.category,
                  suggestDate: dates[block.id] ?? isoDate(addDays(parseIsoDate(date), 1)),
                  periods: block.endPeriod - block.startPeriod + 1,
                  reason: '',
                }))
                patch({ plan: carry })
                const next: Record<string, string> = {}
                for (const item of carry) next[item.blockId ?? item.title] = item.suggestDate
                setSelected(next)
              }}
            />
          )}
        </div>

        <div className="dp-side">
          <Card>
            <span className="dp-label">{date} · 当日记录</span>
            {(() => {
              const blocks = dayData?.date === date ? dayData.plan.blocks : []
              const done = blocks.filter((block) => block.done).length
              const logged = (dayData?.date === date ? dayData.session?.items ?? [] : []).reduce(
                (sum, item) => sum + Math.min(item.doneSets, item.sets),
                0,
              )
              const total = (dayData?.date === date ? dayData.session?.items ?? [] : []).reduce((sum, item) => sum + item.sets, 0)
              return (
                <div className="dp-muted" style={{ lineHeight: 1.9 }}>
                  {t('review.planLine', { done, total: blocks.length })}
                  <br />
                  {t('review.gymLine', { logged, total })}
                </div>
              )
            })()}
          </Card>
          <Card>
            <span className="dp-label">{t('review.toRecord')}</span>
            <div className="dp-muted">{snapshot.settings.reminder.reviewTime}</div>
            <button
              type="button"
              className="dp-btn dp-btn--sm"
              style={{ marginTop: 8 }}
              onClick={() => {
                runtime.setPage('record')
              }}
            >
              {t('review.seeRecord')}
            </button>
          </Card>
        </div>
      </div>
      </details>
    </PageShell>
  )
}

function ListEditor({
  label,
  tone,
  items,
  onChange,
}: {
  readonly label: string
  readonly tone: 'good' | 'bad' | 'warn'
  readonly items: readonly string[]
  readonly onChange: (items: string[]) => void
}): JSX.Element {
  return (
    <div className="dp-listedit">
      <span className={`dp-listedit-tag dp-tone-${tone}`}>{label}</span>
      <div className="dp-listedit-body">
        {items.map((item, index) => (
          <div key={`${String(index)}-${item}`} className="dp-listedit-row">
            <input
              value={item}
              onChange={(event) => {
                const next = [...items]
                next[index] = event.target.value
                onChange(next)
              }}
            />
            <button
              type="button"
              className="dp-gym-del"
              aria-label="删除"
              onClick={() => {
                onChange(items.filter((_, position) => position !== index))
              }}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="dp-addrow"
          onClick={() => {
            onChange([...items, ''])
          }}
        >
          +
        </button>
      </div>
    </div>
  )
}

function CarryRow({
  t,
  item,
  date,
  value,
  onChange,
}: {
  readonly t: PageProps['t']
  readonly item: CarryOverRecord
  readonly date: string
  readonly value: string
  readonly onChange: (next: string) => void
}): JSX.Element {
  const base = parseIsoDate(date)
  const options = [1, 2, 3, 4, 5, 6, 7].map((offset) => isoDate(addDays(base, offset)))
  return (
    <div className="dp-carry-row">
      <Icon name={item.kind === 'new' ? 'sparkle' : 'check'} size={13} />
      <span className="dp-carry-title">{item.title}</span>
      <span className="dp-faint">
        {String(item.periods)} {t('gym.sets')}
      </span>
      <span className="dp-spacer" />
      <select
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
        }}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option.slice(5)}
          </option>
        ))}
      </select>
    </div>
  )
}

function CarryFallback({
  t,
  blocks,
  date,
  onApply,
}: {
  readonly t: PageProps['t']
  readonly blocks: readonly {
    readonly id: string
    readonly title: string
    readonly category: CarryOverRecord['category']
    readonly startPeriod: number
    readonly endPeriod: number
  }[]
  readonly date: string
  readonly onApply: (
    items: readonly {
      readonly id: string
      readonly title: string
      readonly category: CarryOverRecord['category']
      readonly startPeriod: number
      readonly endPeriod: number
    }[],
    dates: Record<string, string>,
  ) => void
}): JSX.Element {
  if (blocks.length === 0) {
    return <div className="dp-faint">{t('review.noCarry')}</div>
  }
  const tomorrow = isoDate(addDays(parseIsoDate(date), 1))
  return (
    <div className="dp-carry">
      <div className="dp-faint">{t('review.suggestTitle')}</div>
      {blocks.map((block) => (
        <div key={block.id} className="dp-carry-row">
          <Icon name="clock" size={13} />
          <span className="dp-carry-title">{block.title}</span>
          <span className="dp-spacer" />
          <span className="dp-faint">→ {tomorrow.slice(5)}</span>
        </div>
      ))}
      <button
        type="button"
        className="dp-btn dp-btn--sm"
        onClick={() => {
          const dates: Record<string, string> = {}
          for (const block of blocks) dates[block.id] = tomorrow
          onApply(blocks, dates)
        }}
      >
        {t('review.prepareCarry')}
      </button>
    </div>
  )
}
