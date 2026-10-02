import type { PlanBlockRecord } from '../../domain.ts'
import { formatHm } from '../../clock.ts'
import { Icon } from '../icons.tsx'
import type { PlanRuntime } from '../runtime.ts'

export function MobileAgenda({
  blocks,
  date,
  today,
  nextId,
  runtime,
  onSelect,
}: {
  blocks: PlanBlockRecord[]
  date: string
  today: string
  nextId?: string | undefined
  runtime: PlanRuntime
  onSelect: (block: PlanBlockRecord) => void
}): JSX.Element {
  return (
    <ol className="mobile-timeline">
      {blocks.map((block) => (
        <li
          key={block.id}
          className={`mobile-task dp-block${block.done ? ' is-done' : ''}${nextId === block.id ? ' is-next' : ''}`}
          data-cat={block.category}
          data-color={block.colorKey || undefined}
        >
          <div className="mobile-task-time">
            <b>{formatHm(block.startMinute)}</b>
            <small>{formatHm(block.endMinute)}</small>
          </div>
          <button
            className="mobile-task-check"
            type="button"
            disabled={date > today}
            aria-label={`${block.done ? '取消完成' : '完成'}：${block.title}`}
            aria-pressed={block.done}
            onClick={() =>
              void runtime.toggleBlock(date, block.id, !block.done)
            }
          >
            <span>{block.done && <Icon name="check" size={12} />}</span>
          </button>
          <button
            type="button"
            className="mobile-task-copy mobile-task-detail"
            aria-label={`查看记录：${block.title}`}
            onClick={() => onSelect(block)}
          >
            <div>
              <b>{block.title}</b>
              {nextId === block.id && <small>接下来</small>}
              {(block.executionNote ||
                block.completionProgress !== undefined) && (
                <Icon name="review" size={12} />
              )}
            </div>
            {block.note && <p>{block.note}</p>}
          </button>
          {block.category === 'gym' && (
            <button
              className="mobile-task-gym"
              aria-label={`记录训练：${block.title}`}
              onClick={() => {
                runtime.setGymDate(block.gymDate ?? date)
                runtime.setPage('gym')
              }}
            >
              <Icon name="gym" size={18} />
            </button>
          )}
        </li>
      ))}
    </ol>
  )
}
