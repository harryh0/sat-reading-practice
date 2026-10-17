import { getQuestion, isChoiceId } from './content.ts'
import type { ChoiceId, TestContent } from './content.ts'

export interface Attempt {
  version: 1
  testId: string
  startedAt: number | null
  submittedAt: number | null
  pausedAt: number | null
  pausedDurationMs: number
  answers: Record<string, ChoiceId>
  marked: string[]
  currentQuestionId: string
  timerHidden: boolean
}

export type QuestionStatus = 'unanswered' | 'answered' | 'correct' | 'incorrect'

export function createAttempt(content: TestContent): Attempt {
  return {
    version: 1,
    testId: content.test.id,
    startedAt: null,
    submittedAt: null,
    pausedAt: null,
    pausedDurationMs: 0,
    answers: {},
    marked: [],
    currentQuestionId: content.questions[0].id,
    timerHidden: false,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

type BaseAttempt = Omit<Attempt, 'pausedAt' | 'pausedDurationMs'>

function isBaseAttempt(value: unknown, content: TestContent): value is BaseAttempt {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    value.testId !== content.test.id ||
    !(value.startedAt === null || isTimestamp(value.startedAt)) ||
    !(value.submittedAt === null || (isTimestamp(value.submittedAt) && isTimestamp(value.startedAt) && value.submittedAt >= value.startedAt)) ||
    !isRecord(value.answers) ||
    !Array.isArray(value.marked) ||
    typeof value.currentQuestionId !== 'string' ||
    !content.questionById.has(value.currentQuestionId) ||
    typeof value.timerHidden !== 'boolean'
  ) return false

  return (
    Object.entries(value.answers).every(([id, answer]) => content.questionById.has(id) && isChoiceId(answer)) &&
    value.marked.every((id) => typeof id === 'string' && content.questionById.has(id)) &&
    new Set(value.marked).size === value.marked.length
  )
}

export function isAttempt(value: unknown, content: TestContent): value is Attempt {
  if (
    !isBaseAttempt(value, content) ||
    !('pausedAt' in value) ||
    !('pausedDurationMs' in value) ||
    typeof value.pausedDurationMs !== 'number' ||
    !Number.isSafeInteger(value.pausedDurationMs) ||
    value.pausedDurationMs < 0
  ) return false

  if (value.startedAt === null) {
    return (
      value.submittedAt === null &&
      value.pausedAt === null &&
      value.pausedDurationMs === 0 &&
      Object.keys(value.answers).length === 0 &&
      value.marked.length === 0 &&
      value.currentQuestionId === content.questions[0].id
    )
  }

  const earliestEnd = value.startedAt + value.pausedDurationMs
  return (
    Number.isSafeInteger(earliestEnd) &&
    (value.pausedAt === null || (isTimestamp(value.pausedAt) && value.pausedAt >= earliestEnd)) &&
    (value.submittedAt === null || (value.pausedAt === null && value.submittedAt >= earliestEnd))
  )
}

export function restoreAttempt(value: unknown, content: TestContent): Attempt | null {
  if (isAttempt(value, content)) return value
  if (isBaseAttempt(value, content) && !('pausedAt' in value) && !('pausedDurationMs' in value)) {
    const migrated = { ...value, pausedAt: null, pausedDurationMs: 0 }
    if (isAttempt(migrated, content)) return migrated
  }
  return null
}

export function startAttempt(attempt: Attempt, now = Date.now()): Attempt {
  if (attempt.startedAt !== null) return attempt
  if (!isTimestamp(now)) throw new Error('The test cannot start with an invalid timestamp.')
  return { ...attempt, startedAt: now }
}

function requireActive(attempt: Attempt): asserts attempt is Attempt & { startedAt: number; submittedAt: null } {
  if (attempt.startedAt === null) throw new Error('Start the test before interacting with questions.')
  if (attempt.submittedAt !== null) throw new Error('A submitted attempt is read-only. Start a new attempt to change answers.')
}

function requireRunning(attempt: Attempt) {
  requireActive(attempt)
  if (attempt.pausedAt !== null) throw new Error('Resume practice before interacting with questions.')
}

function requireTest(content: TestContent, attempt: Attempt) {
  if (attempt.testId !== content.test.id) throw new Error('This attempt belongs to a different practice test.')
}

export function answerQuestion(content: TestContent, attempt: Attempt, id: string, answer: ChoiceId | null): Attempt {
  requireTest(content, attempt)
  requireRunning(attempt)
  const question = getQuestion(content, id)
  if (answer !== null && !question.choices.some((choice) => choice.id === answer)) {
    throw new Error('The selected answer is not a valid option for this question.')
  }
  const answers = { ...attempt.answers }
  if (answer === null) delete answers[id]
  else answers[id] = answer
  return { ...attempt, answers }
}

export function markQuestion(content: TestContent, attempt: Attempt, id: string): Attempt {
  requireTest(content, attempt)
  requireRunning(attempt)
  getQuestion(content, id)
  return {
    ...attempt,
    marked: attempt.marked.includes(id) ? attempt.marked.filter((marked) => marked !== id) : [...attempt.marked, id],
  }
}

export function navigateTo(content: TestContent, attempt: Attempt, id: string): Attempt {
  requireTest(content, attempt)
  if (attempt.startedAt === null) throw new Error('Start the test before changing questions.')
  if (attempt.pausedAt !== null) throw new Error('Resume practice before changing questions.')
  getQuestion(content, id)
  return { ...attempt, currentQuestionId: id }
}

export function pauseAttempt(attempt: Attempt, now = Date.now()): Attempt {
  requireActive(attempt)
  if (attempt.pausedAt !== null) return attempt
  if (!isTimestamp(now)) throw new Error('The test cannot pause with an invalid timestamp.')
  return { ...attempt, pausedAt: Math.max(attempt.startedAt + attempt.pausedDurationMs, now) }
}

export function resumeAttempt(attempt: Attempt, now = Date.now()): Attempt {
  requireActive(attempt)
  if (attempt.pausedAt === null) return attempt
  if (!isTimestamp(now)) throw new Error('The test cannot resume with an invalid timestamp.')
  return {
    ...attempt,
    pausedAt: null,
    pausedDurationMs: attempt.pausedDurationMs + Math.max(0, now - attempt.pausedAt),
  }
}

export function submitAttempt(attempt: Attempt, now = Date.now()): Attempt {
  if (attempt.startedAt === null) throw new Error('Start the test before submitting.')
  if (attempt.submittedAt !== null) return attempt
  if (!isTimestamp(now)) throw new Error('The test cannot submit with an invalid timestamp.')
  const submittedAt = Math.max(attempt.startedAt + attempt.pausedDurationMs, attempt.pausedAt ?? 0, now)
  return {
    ...attempt,
    submittedAt,
    pausedAt: null,
    pausedDurationMs: attempt.pausedDurationMs + (attempt.pausedAt === null ? 0 : submittedAt - attempt.pausedAt),
  }
}

export function elapsedMilliseconds(attempt: Attempt, now = Date.now()): number {
  if (attempt.startedAt === null) return 0
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

export function questionStatus(content: TestContent, attempt: Attempt, id: string): QuestionStatus {
  requireTest(content, attempt)
  const question = getQuestion(content, id)
  const answer = attempt.answers[question.id]
  if (answer === undefined) return 'unanswered'
  if (attempt.submittedAt === null) return 'answered'
  return answer === question.correctAnswer ? 'correct' : 'incorrect'
}

export function summarize(content: TestContent, attempt: Attempt) {
  requireTest(content, attempt)
  const moduleScores = content.modules.map((module) => ({
    number: module.number,
    total: module.questions.length,
    answered: module.questions.filter((question) => attempt.answers[question.id] !== undefined).length,
    correct: module.questions.filter((question) => attempt.answers[question.id] === question.correctAnswer).length,
  }))
  const answered = moduleScores.reduce((sum, module) => sum + module.answered, 0)
  return {
    total: content.questions.length,
    answered,
    unanswered: content.questions.length - answered,
    correct: moduleScores.reduce((sum, module) => sum + module.correct, 0),
    moduleScores,
  }
}
