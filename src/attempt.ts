import { getQuestion, isChoiceId, modules, practiceTest, questionById, questions } from './content.ts'
import type { ChoiceId, Question } from './content.ts'

export const STORAGE_KEY = 'sat-reading-practice:test-11:v1'

export interface Attempt {
  version: 1
  testId: string
  startedAt: number
  submittedAt: number | null
  pausedAt: number | null
  pausedDurationMs: number
  answers: Record<string, ChoiceId>
  marked: string[]
  currentQuestionId: string
  timerHidden: boolean
}

export type QuestionStatus = 'unanswered' | 'answered' | 'correct' | 'incorrect'

export function createAttempt(now = Date.now()): Attempt {
  return {
    version: 1,
    testId: practiceTest.id,
    startedAt: now,
    submittedAt: null,
    pausedAt: null,
    pausedDurationMs: 0,
    answers: {},
    marked: [],
    currentQuestionId: questions[0].id,
    timerHidden: false,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

type LegacyAttempt = Omit<Attempt, 'pausedAt' | 'pausedDurationMs'>

function isLegacyAttempt(value: unknown): value is LegacyAttempt {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    value.testId !== practiceTest.id ||
    !isTimestamp(value.startedAt) ||
    !(value.submittedAt === null || (isTimestamp(value.submittedAt) && value.submittedAt >= value.startedAt)) ||
    !isRecord(value.answers) ||
    !Array.isArray(value.marked) ||
    typeof value.currentQuestionId !== 'string' ||
    !questionById.has(value.currentQuestionId) ||
    typeof value.timerHidden !== 'boolean'
  ) return false

  return (
    Object.entries(value.answers).every(([id, answer]) => questionById.has(id) && isChoiceId(answer)) &&
    value.marked.every((id) => typeof id === 'string' && questionById.has(id)) &&
    new Set(value.marked).size === value.marked.length
  )
}

export function isAttempt(value: unknown): value is Attempt {
  if (
    !isLegacyAttempt(value) ||
    !('pausedAt' in value) ||
    !('pausedDurationMs' in value) ||
    typeof value.pausedDurationMs !== 'number' ||
    !Number.isSafeInteger(value.pausedDurationMs) ||
    value.pausedDurationMs < 0
  ) return false

  const earliestEnd = value.startedAt + value.pausedDurationMs
  return (
    Number.isSafeInteger(earliestEnd) &&
    (value.pausedAt === null || (isTimestamp(value.pausedAt) && value.pausedAt >= earliestEnd)) &&
    (value.submittedAt === null || (value.pausedAt === null && value.submittedAt >= earliestEnd))
  )
}

interface StorageReader {
  getItem(key: string): string | null
}

export function readAttempt(getStorage: () => StorageReader, now = Date.now()): { attempt: Attempt; notice: string | null } {
  let saved: string | null
  try {
    saved = getStorage().getItem(STORAGE_KEY)
  } catch {
    return {
      attempt: createAttempt(now),
      notice: 'This browser is blocking saved progress. You can practice in this tab, but your answers may be lost when it closes.',
    }
  }
  if (saved === null) return { attempt: createAttempt(now), notice: null }

  let parsed: unknown
  try {
    parsed = JSON.parse(saved)
  } catch {
    return {
      attempt: createAttempt(now),
      notice: 'The saved attempt could not be read. A new attempt has been started on this device.',
    }
  }
  if (isAttempt(parsed)) return { attempt: parsed, notice: null }
  if (isLegacyAttempt(parsed) && !('pausedAt' in parsed) && !('pausedDurationMs' in parsed)) {
    return { attempt: { ...parsed, pausedAt: null, pausedDurationMs: 0 }, notice: null }
  }
  return {
    attempt: createAttempt(now),
    notice: 'The saved attempt is damaged or belongs to a different test version. A new attempt has been started.',
  }
}

function requireActive(attempt: Attempt) {
  if (attempt.submittedAt !== null) throw new Error('A submitted attempt is read-only. Start a new attempt to change answers.')
}

function requireRunning(attempt: Attempt) {
  requireActive(attempt)
  if (attempt.pausedAt !== null) throw new Error('Resume practice before interacting with questions.')
}

export function answerQuestion(attempt: Attempt, id: string, answer: ChoiceId | null): Attempt {
  requireRunning(attempt)
  getQuestion(id)
  const answers = { ...attempt.answers }
  if (answer === null) delete answers[id]
  else answers[id] = answer
  return { ...attempt, answers }
}

export function markQuestion(attempt: Attempt, id: string): Attempt {
  requireRunning(attempt)
  getQuestion(id)
  return {
    ...attempt,
    marked: attempt.marked.includes(id) ? attempt.marked.filter((marked) => marked !== id) : [...attempt.marked, id],
  }
}

export function navigateTo(attempt: Attempt, id: string): Attempt {
  if (attempt.pausedAt !== null) throw new Error('Resume practice before changing questions.')
  getQuestion(id)
  return { ...attempt, currentQuestionId: id }
}

export function pauseAttempt(attempt: Attempt, now = Date.now()): Attempt {
  requireActive(attempt)
  if (attempt.pausedAt !== null) return attempt
  return { ...attempt, pausedAt: Math.max(attempt.startedAt + attempt.pausedDurationMs, now) }
}

export function resumeAttempt(attempt: Attempt, now = Date.now()): Attempt {
  requireActive(attempt)
  if (attempt.pausedAt === null) return attempt
  return {
    ...attempt,
    pausedAt: null,
    pausedDurationMs: attempt.pausedDurationMs + Math.max(0, now - attempt.pausedAt),
  }
}

export function submitAttempt(attempt: Attempt, now = Date.now()): Attempt {
  if (attempt.submittedAt !== null) return attempt
  const submittedAt = Math.max(attempt.startedAt + attempt.pausedDurationMs, attempt.pausedAt ?? 0, now)
  return {
    ...attempt,
    submittedAt,
    pausedAt: null,
    pausedDurationMs: attempt.pausedDurationMs + (attempt.pausedAt === null ? 0 : submittedAt - attempt.pausedAt),
  }
}

export function elapsedMilliseconds(attempt: Attempt, now = Date.now()): number {
  return Math.max(0, (attempt.submittedAt ?? attempt.pausedAt ?? now) - attempt.startedAt - attempt.pausedDurationMs)
}

export function formatElapsed(milliseconds: number): string {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1_000)
  const hours = Math.floor(seconds / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  const remainder = seconds % 60
  const pad = (number: number) => String(number).padStart(2, '0')
  return hours ? `${pad(hours)}:${pad(minutes)}:${pad(remainder)}` : `${pad(minutes)}:${pad(remainder)}`
}

export function questionStatus(attempt: Attempt, question: Question): QuestionStatus {
  const answer = attempt.answers[question.id]
  if (answer === undefined) return 'unanswered'
  if (attempt.submittedAt === null) return 'answered'
  return answer === question.correctAnswer ? 'correct' : 'incorrect'
}

export function summarize(attempt: Attempt) {
  const moduleScores = modules.map((module) => ({
    number: module.number,
    total: module.questions.length,
    answered: module.questions.filter((question) => attempt.answers[question.id] !== undefined).length,
    correct: module.questions.filter((question) => attempt.answers[question.id] === question.correctAnswer).length,
  }))
  const answered = moduleScores.reduce((sum, module) => sum + module.answered, 0)
  return {
    total: questions.length,
    answered,
    unanswered: questions.length - answered,
    correct: moduleScores.reduce((sum, module) => sum + module.correct, 0),
    moduleScores,
  }
}
