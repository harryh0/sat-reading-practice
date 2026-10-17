import { elapsedMilliseconds, isAttempt, summarize } from './attempt.ts'
import type { Attempt } from './attempt.ts'
import type { TestContent } from './content.ts'

export interface CompletedResult {
  readonly id: string
  readonly testId: string
  readonly startedAt: number
  readonly completedAt: number
  readonly elapsedMs: number
  readonly total: number
  readonly right: number
  readonly wrong: number
  readonly skipped: number
}

export interface ResultHistory {
  readonly version: 1
  readonly testId: string
  readonly attempts: readonly CompletedResult[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function timestamp(value: unknown): value is number {
  return count(value) && value > 0 && Number.isFinite(new Date(value).getTime())
}

function isResult(value: unknown, testId: string): value is CompletedResult {
  return isRecord(value) &&
    typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 400 &&
    value.testId === testId &&
    timestamp(value.startedAt) && timestamp(value.completedAt) && value.completedAt >= value.startedAt &&
    count(value.elapsedMs) && value.elapsedMs <= value.completedAt - value.startedAt &&
    count(value.total) && value.total > 0 &&
    count(value.right) && count(value.wrong) && count(value.skipped) &&
    value.right + value.wrong + value.skipped === value.total
}

export function isResultHistory(value: unknown, testId: string): value is ResultHistory {
  if (!isRecord(value) || value.version !== 1 || value.testId !== testId || !Array.isArray(value.attempts)) return false
  return value.attempts.every((result) => isResult(result, testId)) &&
    new Set(value.attempts.map((result) => result.id)).size === value.attempts.length
}

export function emptyHistory(testId: string): ResultHistory {
  return { version: 1, testId, attempts: [] }
}

export function completedResult(content: TestContent, attempt: Attempt): CompletedResult {
  if (!isAttempt(attempt, content) || attempt.startedAt === null || attempt.submittedAt === null) {
    throw new Error('Only a valid submitted attempt can be added to completed history.')
  }
  const summary = summarize(content, attempt)
  return {
    id: attempt.id ?? `legacy:${attempt.testId}:${attempt.startedAt}:${attempt.submittedAt}`,
    testId: attempt.testId,
    startedAt: attempt.startedAt,
    completedAt: attempt.submittedAt,
    elapsedMs: elapsedMilliseconds(attempt),
    total: summary.total,
    right: summary.correct,
    wrong: summary.answered - summary.correct,
    skipped: summary.unanswered,
  }
}

function sameResult(a: CompletedResult, b: CompletedResult): boolean {
  return a.id === b.id && a.testId === b.testId && a.startedAt === b.startedAt &&
    a.completedAt === b.completedAt && a.elapsedMs === b.elapsedMs && a.total === b.total &&
    a.right === b.right && a.wrong === b.wrong && a.skipped === b.skipped
}

export function addCompletedResult(history: ResultHistory, result: CompletedResult): ResultHistory {
  if (!isResult(result, history.testId)) throw new Error('The completed result does not belong to this test or has invalid counts.')
  const existing = history.attempts.find((entry) => entry.id === result.id)
  if (existing) {
    if (!sameResult(existing, result)) throw new Error('Saved history contains a conflicting result for this attempt. It has not been overwritten.')
    return history
  }
  return {
    ...history,
    attempts: [...history.attempts, result].sort((a, b) => b.completedAt - a.completedAt || a.id.localeCompare(b.id)),
  }
}

export function mergeHistories(stored: ResultHistory, pending: ResultHistory): ResultHistory {
  if (stored.testId !== pending.testId) throw new Error('Completed histories belong to different tests.')
  return pending.attempts.reduce(addCompletedResult, stored)
}
