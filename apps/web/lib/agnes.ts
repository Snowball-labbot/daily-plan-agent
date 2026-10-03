import { config } from './db'
import { runCloudJson } from '../../../src/cloud/gateway'
import type { AgnesJsonOptions, AgnesJsonTurns } from '../../../src/agnesJsonTypes'

export async function modelGateway<T>(options: AgnesJsonOptions, turns: AgnesJsonTurns<T>) {
  return runCloudJson(options, turns, {
    baseUrl: process.env.AGNES_BASE_URL ?? 'https://apihub.agnes-ai.com/v1',
    apiKey: config('AGNES_API_KEY'),
    model: process.env.AGNES_MODEL ?? 'agnes-2.5-flash',
    // Record paths and failure categories only; never log input, replies or keys.
    onRepair: diagnostic => console.warn('[planner/agnes-repair]', diagnostic),
  })
}
