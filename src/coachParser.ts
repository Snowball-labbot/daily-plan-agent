import { WorkflowDraftSchema, type WorkflowDraft } from './domain.ts'
import { fitEstimatedAppointments, normalizeAppointmentEvidence, normalizeCoachOutput, validateEstimatedAppointmentWindow, type AppointmentPlanningContext } from './appointmentEvidence.ts'
import { jsonPayload, repairUnescapedStringQuotes, stripJsonInvisibleWhitespace, stripTrailingCommas } from './parser.ts'

/** Repair JSON punctuation only; domain values still need strict validation. */
export function parseCoachDraft(text: string, planning?: AppointmentPlanningContext): WorkflowDraft {
  const block = stripJsonInvisibleWhitespace(jsonPayload(text))
  let lastError: unknown
  for (const candidate of [block, stripTrailingCommas(block), stripTrailingCommas(repairUnescapedStringQuotes(block))]) {
    let parsed: unknown
    try { parsed = JSON.parse(candidate) } catch (error) { lastError = error; continue }
    const draft = WorkflowDraftSchema.parse(normalizeCoachOutput(parsed))
    if (!planning) return draft
    const fitted = fitEstimatedAppointments(normalizeAppointmentEvidence(draft), planning)
    validateEstimatedAppointmentWindow(fitted, planning)
    return fitted
  }
  throw lastError
}
