import assert from 'node:assert/strict'
import test from 'node:test'
import {
  answerQuestion, createAttempt, elapsedMilliseconds, formatElapsed, isAttempt,
  markQuestion, navigateTo, pauseAttempt, questionStatus, readAttempt, resumeAttempt, startAttempt, submitAttempt, summarize,
} from '../src/attempt.ts'
import { isChoiceId, questions } from '../src/content.ts'

const start = 1_700_000_000_000

function startedAttempt() {
  return startAttempt(createAttempt(), start)
}

test('a new attempt is unstarted with no elapsed time, answers, or review marks', () => {
  const attempt = createAttempt()
  assert.ok(isAttempt(attempt))
  assert.equal(attempt.startedAt, null)
  assert.equal(attempt.currentQuestionId, 'm1-q1')
  assert.deepEqual(attempt.answers, {})
  assert.deepEqual(attempt.marked, [])
  assert.equal(attempt.submittedAt, null)
  assert.equal(attempt.pausedAt, null)
  assert.equal(attempt.pausedDurationMs, 0)
  assert.equal(elapsedMilliseconds(attempt, start), 0)
})

test('answers can be selected, changed, and cleared without affecting other questions', () => {
  let attempt = answerQuestion(startedAttempt(), 'm1-q1', 'A')
  attempt = answerQuestion(attempt, 'm2-q33', 'B')
  attempt = answerQuestion(attempt, 'm1-q1', 'C')
  assert.deepEqual(attempt.answers, { 'm1-q1': 'C', 'm2-q33': 'B' })
  attempt = answerQuestion(attempt, 'm1-q1', null)
  assert.deepEqual(attempt.answers, { 'm2-q33': 'B' })
  assert.throws(() => answerQuestion(attempt, 'm3-q1', 'A'), /Unknown question/)
})

test('marks toggle independently and navigation crosses both modules', () => {
  let attempt = markQuestion(startedAttempt(), 'm1-q8')
  attempt = markQuestion(attempt, 'm2-q16')
  assert.deepEqual(attempt.marked, ['m1-q8', 'm2-q16'])
  attempt = markQuestion(attempt, 'm1-q8')
  assert.deepEqual(attempt.marked, ['m2-q16'])
  attempt = navigateTo(attempt, 'm2-q33')
  assert.equal(attempt.currentQuestionId, 'm2-q33')
  assert.throws(() => navigateTo(attempt, 'missing'), /Unknown question/)
})

test('active attempts never reveal correctness through question status', () => {
  let attempt = answerQuestion(startedAttempt(), 'm1-q1', 'A')
  assert.equal(questionStatus(attempt, questions[0]), 'answered')
  attempt = answerQuestion(attempt, 'm1-q1', 'D')
  assert.equal(questionStatus(attempt, questions[0]), 'answered')
  assert.equal(questionStatus(attempt, questions[1]), 'unanswered')
})

test('submission scores both modules out of 66, including unanswered questions', () => {
  let attempt = answerQuestion(startedAttempt(), 'm1-q1', 'A')
  attempt = answerQuestion(attempt, 'm1-q2', 'A')
  attempt = answerQuestion(attempt, 'm2-q1', 'C')
  attempt = submitAttempt(attempt, start + 125_000)
  const score = summarize(attempt)
  assert.equal(score.correct, 2)
  assert.equal(score.total, 66)
  assert.equal(score.answered, 3)
  assert.equal(score.unanswered, 63)
  assert.deepEqual(score.moduleScores.map((module) => module.correct), [1, 1])
  assert.equal(questionStatus(attempt, questions[0]), 'correct')
  assert.equal(questionStatus(attempt, questions[1]), 'incorrect')
  assert.equal(questionStatus(attempt, questions[2]), 'unanswered')
  assert.equal(submitAttempt(attempt, start + 500_000), attempt)
})

test('all correct answers score 66 and all wrong answers score zero', () => {
  let correct = startedAttempt()
  let wrong = startedAttempt()
  for (const question of questions) {
    assert.ok(isChoiceId(question.correctAnswer))
    correct = answerQuestion(correct, question.id, question.correctAnswer)
    wrong = answerQuestion(wrong, question.id, question.correctAnswer === 'A' ? 'B' : 'A')
  }
  assert.equal(summarize(submitAttempt(correct, start + 1_000)).correct, 66)
  assert.equal(summarize(submitAttempt(wrong, start + 1_000)).correct, 0)
  assert.equal(summarize(wrong).unanswered, 0)
})

test('submitted attempts are read-only but remain navigable', () => {
  const attempt = submitAttempt(startedAttempt(), start + 1_000)
  assert.throws(() => answerQuestion(attempt, 'm1-q1', 'A'), /read-only/)
  assert.throws(() => markQuestion(attempt, 'm1-q1'), /read-only/)
  assert.equal(navigateTo(attempt, 'm2-q16').currentQuestionId, 'm2-q16')
})

test('elapsed time survives refresh and time away, has no cap, and freezes on submission', () => {
  const attempt = startedAttempt()
  const muchLater = start + 20 * 24 * 60 * 60 * 1_000 + 125_000
  assert.equal(elapsedMilliseconds(attempt, muchLater), muchLater - start)
  assert.equal(attempt.submittedAt, null)
  assert.equal(formatElapsed(elapsedMilliseconds(attempt, muchLater)), '480:02:05')
  const submitted = submitAttempt(attempt, start + 3_661_000)
  assert.equal(elapsedMilliseconds(submitted, muchLater), 3_661_000)
  assert.equal(formatElapsed(elapsedMilliseconds(submitted)), '01:01:01')
  assert.equal(elapsedMilliseconds(attempt, start - 1_000), 0)
  assert.equal(submitAttempt(attempt, start - 1_000).submittedAt, start)
})

test('timer formatting handles seconds, hours, and days without wrapping', () => {
  assert.equal(formatElapsed(0), '00:00')
  assert.equal(formatElapsed(59_999), '00:59')
  assert.equal(formatElapsed(60_000), '01:00')
  assert.equal(formatElapsed(3_600_000), '01:00:00')
  assert.equal(formatElapsed(90_061_000), '25:01:01')
})

test('the complete attempt restores from browser storage, including hidden timer and submission', () => {
  let attempt = answerQuestion(startedAttempt(), 'm2-q16', 'C')
  attempt = markQuestion(attempt, 'm2-q16')
  attempt = navigateTo(attempt, 'm2-q16')
  attempt = { ...attempt, timerHidden: true }
  attempt = submitAttempt(attempt, start + 66_000)
  const restored = readAttempt(() => ({ getItem: () => JSON.stringify(attempt) }))
  assert.deepEqual(restored.attempt, attempt)
  assert.equal(restored.notice, null)
  assert.equal(elapsedMilliseconds(restored.attempt), 66_000)
})

test('damaged or inaccessible saved progress produces an explicit notice', () => {
  for (const saved of ['{invalid', 'null', '{}', '{"version":5}']) {
    const result = readAttempt(() => ({ getItem: () => saved }))
    assert.ok(result.notice)
    assert.deepEqual(result.attempt, createAttempt())
  }
  const blocked = readAttempt(() => { throw new Error('Storage blocked') })
  assert.match(blocked.notice ?? '', /blocking saved progress/)
  const empty = readAttempt(() => ({ getItem: () => null }))
  assert.equal(empty.notice, null)
})

test('saved state rejects invalid answers, timestamps, cursors, duplicate marks, and wrong tests', () => {
  const base = startedAttempt()
  const invalid = [
    { ...base, answers: { 'm1-q1': 'E' } },
    { ...base, answers: { unknown: 'A' } },
    { ...base, answers: [] },
    { ...base, currentQuestionId: 'm2-q34' },
    { ...base, marked: ['m1-q1', 'm1-q1'] },
    { ...base, marked: ['m1-q99'] },
    { ...base, startedAt: -1 },
    { ...base, submittedAt: start - 1 },
    { ...base, timerHidden: 'true' },
    { ...base, testId: 'a-different-test' },
  ]
  for (const value of invalid) assert.equal(isAttempt(value), false)
})

test('pausing freezes elapsed time without changing answers, bookmarks, or the current question', () => {
  let attempt = answerQuestion(startedAttempt(), 'm2-q16', 'C')
  attempt = markQuestion(attempt, 'm2-q16')
  attempt = navigateTo(attempt, 'm2-q16')
  const paused = pauseAttempt(attempt, start + 65_000)
  assert.equal(paused.pausedAt, start + 65_000)
  assert.equal(elapsedMilliseconds(paused, start + 9_000_000), 65_000)
  assert.equal(paused.currentQuestionId, 'm2-q16')
  assert.deepEqual(paused.answers, attempt.answers)
  assert.deepEqual(paused.marked, attempt.marked)
  assert.equal(pauseAttempt(paused, start + 99_000), paused)
  assert.ok(isAttempt(paused))
})

test('resuming excludes all paused intervals and never resets elapsed time', () => {
  let attempt = pauseAttempt(startedAttempt(), start + 10_000)
  attempt = resumeAttempt(attempt, start + 70_000)
  assert.equal(attempt.pausedAt, null)
  assert.equal(attempt.pausedDurationMs, 60_000)
  assert.equal(elapsedMilliseconds(attempt, start + 75_000), 15_000)
  assert.equal(resumeAttempt(attempt, start + 80_000), attempt)
  attempt = pauseAttempt(attempt, start + 90_000)
  assert.equal(elapsedMilliseconds(attempt, start + 999_000), 30_000)
  attempt = resumeAttempt(attempt, start + 150_000)
  assert.equal(attempt.pausedDurationMs, 120_000)
  assert.equal(elapsedMilliseconds(attempt, start + 155_000), 35_000)
  const submitted = submitAttempt(attempt, start + 160_000)
  assert.equal(elapsedMilliseconds(submitted, start + 999_000), 40_000)
  assert.ok(isAttempt(submitted))
})

test('a paused attempt stays paused after refresh and time away, then resumes from the same elapsed time', () => {
  let attempt = answerQuestion(startedAttempt(), 'm1-q2', 'C')
  attempt = navigateTo(attempt, 'm1-q2')
  attempt = pauseAttempt(attempt, start + 42_000)
  const later = start + 2 * 24 * 60 * 60 * 1_000
  const restored = readAttempt(() => ({ getItem: () => JSON.stringify(attempt) }))
  assert.deepEqual(restored.attempt, attempt)
  assert.equal(restored.notice, null)
  assert.equal(elapsedMilliseconds(restored.attempt, later), 42_000)
  const resumed = resumeAttempt(restored.attempt, later)
  assert.equal(elapsedMilliseconds(resumed, later), 42_000)
  assert.equal(elapsedMilliseconds(resumed, later + 5_000), 47_000)
  const refreshed = readAttempt(() => ({ getItem: () => JSON.stringify(resumed) }))
  assert.equal(elapsedMilliseconds(refreshed.attempt, later + 10_000), 52_000)
})

test('question interactions are blocked while paused and restored after resuming', () => {
  const paused = pauseAttempt(startedAttempt(), start + 1_000)
  assert.throws(() => answerQuestion(paused, 'm1-q1', 'A'), /Resume practice/)
  assert.throws(() => markQuestion(paused, 'm1-q1'), /Resume practice/)
  assert.throws(() => navigateTo(paused, 'm2-q1'), /Resume practice/)
  const resumed = resumeAttempt(paused, start + 10_000)
  assert.equal(answerQuestion(resumed, 'm1-q1', 'A').answers['m1-q1'], 'A')
  assert.equal(navigateTo(resumed, 'm2-q1').currentQuestionId, 'm2-q1')
})

test('submitted attempts cannot restart their timer through pause or resume', () => {
  const submitted = submitAttempt(startedAttempt(), start + 30_000)
  assert.throws(() => pauseAttempt(submitted, start + 40_000), /read-only/)
  assert.throws(() => resumeAttempt(submitted, start + 40_000), /read-only/)
  assert.equal(elapsedMilliseconds(submitted, start + 500_000), 30_000)
})

test('submission while paused freezes at the paused elapsed time and clears the pause flag', () => {
  const paused = pauseAttempt(startedAttempt(), start + 24_000)
  const submitted = submitAttempt(paused, start + 100_000)
  assert.equal(submitted.submittedAt, start + 100_000)
  assert.equal(submitted.pausedAt, null)
  assert.equal(submitted.pausedDurationMs, 76_000)
  assert.equal(elapsedMilliseconds(submitted, start + 999_000), 24_000)
  assert.ok(isAttempt(submitted))
})

test('existing active and completed attempts migrate without losing progress or resetting time', () => {
  for (const submittedAt of [null, start + 99_000]) {
    const legacy = {
      version: 1, testId: createAttempt().testId, startedAt: start, submittedAt,
      answers: { 'm2-q16': 'C' }, marked: ['m2-q16'], currentQuestionId: 'm2-q16', timerHidden: true,
    }
    const restored = readAttempt(() => ({ getItem: (key) => {
      assert.equal(key, 'sat-reading-practice:test-11:v1')
      return JSON.stringify(legacy)
    } }))
    assert.equal(restored.notice, null)
    assert.deepEqual(restored.attempt, { ...legacy, pausedAt: null, pausedDurationMs: 0 })
    assert.equal(elapsedMilliseconds(restored.attempt, start + 150_000), submittedAt === null ? 150_000 : 99_000)
    assert.ok(isAttempt(restored.attempt))
  }
})

test('invalid pause state is rejected explicitly rather than silently losing a pause', () => {
  const base = startedAttempt()
  const invalid = [
    { ...base, pausedAt: start - 1 },
    { ...base, pausedAt: 'paused' },
    { ...base, pausedDurationMs: -1 },
    { ...base, pausedDurationMs: 1.5 },
    { ...base, pausedDurationMs: Number.MAX_SAFE_INTEGER },
    { ...base, pausedAt: start + 10, pausedDurationMs: 20 },
    { ...base, submittedAt: start + 10, pausedAt: start + 5 },
    { ...base, submittedAt: start + 10, pausedDurationMs: 20 },
    { ...base, pausedAt: undefined },
    { ...base, pausedDurationMs: undefined },
  ]
  for (const value of invalid) {
    assert.equal(isAttempt(value), false)
    assert.ok(readAttempt(() => ({ getItem: () => JSON.stringify(value) })).notice)
  }
})

test('waiting and refreshing before Start never accumulates elapsed time', () => {
  const attempt = createAttempt()
  const weeksLater = start + 21 * 24 * 60 * 60 * 1_000
  assert.equal(elapsedMilliseconds(attempt, weeksLater), 0)
  const restored = readAttempt(() => ({ getItem: () => JSON.stringify(attempt) }))
  assert.deepEqual(restored.attempt, attempt)
  assert.equal(restored.notice, null)
  assert.equal(restored.attempt.startedAt, null)
  assert.equal(elapsedMilliseconds(restored.attempt, weeksLater), 0)
})

test('Start opens question one and begins timing at zero, excluding all introduction waiting', () => {
  const attempt = createAttempt()
  const later = start + 3 * 24 * 60 * 60 * 1_000
  const started = startAttempt(attempt, later)
  assert.equal(started.startedAt, later)
  assert.equal(started.currentQuestionId, 'm1-q1')
  assert.deepEqual(started.answers, {})
  assert.equal(elapsedMilliseconds(started, later), 0)
  assert.equal(elapsedMilliseconds(started, later + 5_000), 5_000)
  assert.equal(attempt.startedAt, null)
  assert.ok(isAttempt(started))
})

test('repeated Start cannot reset an active, paused, or submitted attempt', () => {
  const active = answerQuestion(startedAttempt(), 'm1-q1', 'A')
  const paused = pauseAttempt(active, start + 10_000)
  const submitted = submitAttempt(active, start + 20_000)
  for (const attempt of [active, paused, submitted]) {
    assert.equal(startAttempt(attempt, start + 999_000), attempt)
    assert.equal(attempt.startedAt, start)
  }
})

test('questions, navigation, pause, resume, and submission are unavailable before Start', () => {
  const attempt = createAttempt()
  assert.throws(() => answerQuestion(attempt, 'm1-q1', 'A'), /Start the test/)
  assert.throws(() => markQuestion(attempt, 'm1-q1'), /Start the test/)
  assert.throws(() => navigateTo(attempt, 'm2-q1'), /Start the test/)
  assert.throws(() => pauseAttempt(attempt, start), /Start the test/)
  assert.throws(() => resumeAttempt(attempt, start), /Start the test/)
  assert.throws(() => submitAttempt(attempt, start), /Start the test/)
})

test('unstarted saved state cannot contain question progress or running timer state', () => {
  const attempt = createAttempt()
  const invalid = [
    { ...attempt, answers: { 'm1-q1': 'A' } },
    { ...attempt, marked: ['m1-q1'] },
    { ...attempt, currentQuestionId: 'm1-q2' },
    { ...attempt, pausedAt: start },
    { ...attempt, pausedDurationMs: 1 },
    { ...attempt, submittedAt: start },
  ]
  for (const value of invalid) {
    assert.equal(isAttempt(value), false)
    assert.ok(readAttempt(() => ({ getItem: () => JSON.stringify(value) })).notice)
  }
})

test('existing started, paused, and completed attempts remain started when restored', () => {
  const emptyActive = startedAttempt()
  const answered = navigateTo(answerQuestion(emptyActive, 'm2-q16', 'C'), 'm2-q16')
  const paused = pauseAttempt(answered, start + 15_000)
  const submitted = submitAttempt(answered, start + 25_000)
  for (const attempt of [emptyActive, answered, paused, submitted]) {
    const restored = readAttempt(() => ({ getItem: () => JSON.stringify(attempt) }))
    assert.equal(restored.notice, null)
    assert.deepEqual(restored.attempt, attempt)
    assert.equal(restored.attempt.startedAt, start)
  }
})

test('Start rejects invalid timestamps instead of creating a broken timer', () => {
  for (const invalid of [0, -1, NaN, Infinity, 1.5]) {
    assert.throws(() => startAttempt(createAttempt(), invalid), /invalid timestamp/)
  }
})
