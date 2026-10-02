import { useEffect, useState } from 'react'
import { describeRow } from '../../courseImport.ts'
import { Icon } from '../icons.tsx'
import type { CourseParsePayload } from '../wire.ts'
import type { PageProps } from './types.ts'

const EXAMPLE = [
  '周一 1-2 高等数学 教三-201 1-16周',
  '周三 3-4 线性代数 教三-105 1-16周',
  '周五 5-6 大学英语 外语楼302 1-8周(单)',
  '周四 9-10 社团例会 活动中心',
].join('\n')

export function CourseImport({
  t,
  runtime,
  onDone,
}: {
  readonly t: PageProps['t']
  readonly runtime: PageProps['runtime']
  readonly onDone: () => void
}): JSX.Element {
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState<CourseParsePayload | null>(null)
  const [replace, setReplace] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Parse as they type, debounced — the preview is the whole point of this screen.
  useEffect(() => {
    if (text.trim() === '') {
      setParsed(null)
      setError(null)
      return
    }
    const timer = setTimeout(() => {
      void runtime
        .parseCourses(text)
        .then((result) => {
          setParsed(result)
          setError(null)
        })
        .catch((cause: unknown) => {
          setParsed(null)
          setError(cause instanceof Error ? cause.message : String(cause))
        })
    }, 250)
    return () => {
      clearTimeout(timer)
    }
  }, [text, runtime])

  const rows = parsed?.rows ?? []
  const failed = parsed?.failed ?? []

  const submit = async (): Promise<void> => {
    if (rows.length === 0) return
    setBusy(true)
    try {
      await runtime.importCourses(rows, replace)
      runtime.notify(t('setting.imported', { count: rows.length }))
      onDone()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dp-import">
      <p className="dp-faint">{t('setting.pasteHint')}</p>
      <textarea
        className="dp-import-input"
        value={text}
        placeholder={EXAMPLE}
        spellCheck={false}
        onChange={(event) => {
          setText(event.target.value)
        }}
      />
      {error !== null && <div className="dp-error">{error}</div>}

      {parsed !== null && (
        <>
          <div className="dp-import-head">
            <span>
              {t('setting.parsed', { ok: rows.length, bad: failed.length })}
            </span>
            <span className="dp-spacer" />
            <label className="dp-check-line">
              <input
                type="checkbox"
                checked={replace}
                onChange={(event) => {
                  setReplace(event.target.checked)
                }}
              />
              {t('setting.replaceAll')}
            </label>
          </div>

          {rows.length > 0 && (
            <div className="dp-import-list">
              {rows.map((row, index) => (
                <div key={`${row.name}-${String(index)}`} className="dp-import-row">
                  <span className="dp-import-name">{row.name}</span>
                  <span className="dp-import-meta">{describeRow(row)}</span>
                  {row.kind === 'fixed' && <span className="dp-tag">{t('setting.fixed')}</span>}
                </div>
              ))}
            </div>
          )}

          {failed.length > 0 && (
            <div className="dp-import-failed">
              <div className="dp-import-failed-head">
                <Icon name="warn" size={13} />
                {t('setting.unparsed', { count: failed.length })}
              </div>
              {failed.map((item, index) => (
                <div key={`${item.line}-${String(index)}`} className="dp-import-failed-row">
                  <code>{item.line}</code>
                  <span className="dp-faint">{item.reason}</span>
                </div>
              ))}
            </div>
          )}

          <div className="dp-import-actions">
            <button
              type="button"
              className="dp-btn dp-btn--sm"
              onClick={() => {
                setText('')
                setParsed(null)
              }}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="dp-btn dp-btn--sm dp-btn--primary"
              disabled={busy || rows.length === 0}
              onClick={() => {
                void submit()
              }}
            >
              {t('setting.importCount', { count: rows.length })}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
