import { useState } from 'react'
import { Icon } from '../icons.tsx'
import { DraftInput } from '../ui/kit.tsx'
import type { PageProps } from './types.ts'

/**
 * Add an exercise to the library.
 *
 * Exists because the library shipped with delete but no create — `upsertExercise`
 * was wired all the way to the host and simply never called from anywhere, so a
 * built-in you could not find meant you were stuck with the 44.
 *
 * Deliberately few fields: name and part are what the page needs to file the
 * exercise; sets/reps are pre-filled suggestions you can edit in the session.
 */
export function NewExerciseForm({ t, runtime, onCreated }: PageProps & { readonly onCreated?: () => void }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [part, setPart] = useState('chest')
  const [equipment, setEquipment] = useState('')
  const [sets, setSets] = useState('4')
  const [reps, setReps] = useState('8-12')

  if (!open) {
    return (
      <button type="button" className="dp-btn dp-btn--sm" onClick={() => setOpen(true)}>
        <Icon name="plus" size={12} /> {t('gym.newExercise')}
      </button>
    )
  }

  const submit = (): void => {
    const title = name.trim()
    if (title === '') return
    void runtime
      .upsertExercise({
        name: title,
        part,
        equipment: equipment.trim(),
        defaultSets: Math.max(1, Math.min(20, Math.round(Number(sets) || 4))),
        defaultReps: reps.trim() === '' ? '8-12' : reps.trim(),
        custom: true,
      })
      .then(() => {
        runtime.notify(t('gym.exerciseAdded'))
        setName('')
        setEquipment('')
        setOpen(false)
        onCreated?.()
      })
  }

  return (
    <div className="dp-learn-form">
      <div className="dp-pool-row">
        <DraftInput
          autoFocus
          value={name}
          placeholder={t('gym.exerciseName')}
          onInput={setName}
          onCommit={() => submit()}
        />
        <select value={part} onChange={(event) => setPart(event.target.value)}>
          {(['chest', 'back', 'legs', 'shoulders', 'core', 'cardio'] as const).map((key) => (
            <option key={key} value={key}>
              {t(`common.part.${key}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="dp-pool-row">
        <DraftInput
          value={equipment}
          placeholder={t('gym.equipment')}
          onInput={setEquipment}
          onCommit={() => submit()}
        />
        <DraftInput
          value={sets}
          inputMode="numeric"
          ariaLabel={t('gym.sets')}
          onInput={setSets}
          onCommit={() => submit()}
        />
        <span className="dp-faint">×</span>
        <DraftInput value={reps} placeholder="8-12" onInput={setReps} onCommit={() => submit()} />
      </div>
      <div className="dp-pool-row">
        <span className="dp-faint">{t('gym.previewHint')}</span>
        <span className="dp-learn-spacer" />
        <button type="button" className="dp-btn dp-btn--sm" onClick={() => setOpen(false)}>
          {t('common.cancel')}
        </button>
        <button type="button" className="dp-btn dp-btn--sm dp-btn--primary" disabled={name.trim() === ''} onClick={submit}>
          {t('common.save')}
        </button>
      </div>
    </div>
  )
}
