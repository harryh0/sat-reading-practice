import assert from 'node:assert/strict'
import test from 'node:test'
import { answerQuestion, createAttempt, pauseAttempt, resumeAttempt, startAttempt, submitAttempt } from '../src/attempt.ts'
import { addCompletedResult, completedResult, emptyHistory, isResultHistory, mergeHistories } from '../src/history.ts'
import { historyStorageKey, readHistory, writeMergedHistory } from '../src/persistence.ts'
import { fixtureContent, MemoryStorage } from './fixtures.ts'

const start = 1_700_000_000_000
const content = fixtureContent('history-test', [2, 3], 'A')

function running() {
  return startAttempt(createAttempt(content), start)
}

test('empty, perfect, wrong-only, and mixed results separate right, wrong, and skipped exactly', () => {
  const empty = completedResult(content, submitAttempt(running(), start + 1_000))
  assert.deepEqual([empty.right, empty.wrong, empty.skipped, empty.total], [0, 0, 5, 5])
  let perfect = running()
  let wrong = running()
  for (const question of content.questions) {
    perfect = answerQuestion(content, perfect, question.id, 'A')
    wrong = answerQuestion(content, wrong, question.id, 'B')
  }
  const perfectResult = completedResult(content, submitAttempt(perfect, start + 2_000))
  const wrongResult = completedResult(content, submitAttempt(wrong, start + 3_000))
  assert.deepEqual([perfectResult.right, perfectResult.wrong, perfectResult.skipped], [5, 0, 0])
  assert.deepEqual([wrongResult.right, wrongResult.wrong, wrongResult.skipped], [0, 5, 0])
  let mixed = answerQuestion(content, running(), 'm1-q1', 'A')
  mixed = answerQuestion(content, mixed, 'm1-q2', 'B')
  const result = completedResult(content, submitAttempt(mixed, start + 4_000))
  assert.deepEqual([result.right, result.wrong, result.skipped], [1, 1, 3])
  assert.equal(result.right + result.wrong + result.skipped, result.total)
  assert.equal('answers' in result, false)
})

test('unstarted, running, paused, and wrong-test attempts cannot become historical results', () => {
  assert.throws(() => completedResult(content, createAttempt(content)), /Only a valid submitted/)
  assert.throws(() => completedResult(content, running()), /Only a valid submitted/)
  assert.throws(() => completedResult(content, pauseAttempt(running(), start + 1_000)), /Only a valid submitted/)
  const other = fixtureContent('another-history-test', [5], 'B')
  assert.throws(() => completedResult(other, submitAttempt(running(), start + 2_000)), /Only a valid submitted/)
})

test('completion metadata freezes dates and elapsed time while excluding pauses', () => {
  const paused = pauseAttempt(running(), start + 10_000)
  const resumed = resumeAttempt(paused, start + 60_000)
  const submitted = submitAttempt(resumed, start + 80_000)
  const before = JSON.stringify(submitted)
  const result = completedResult(content, submitted)
  assert.equal(result.startedAt, start)
  assert.equal(result.completedAt, start + 80_000)
  assert.equal(result.elapsedMs, 30_000)
  assert.equal(JSON.stringify(submitted), before)
  assert.deepEqual(completedResult(content, submitted), result)
})

test('new attempts have unique stable identities even with identical start and submission timestamps', () => {
  const first = submitAttempt(running(), start + 1_000)
  const second = submitAttempt(running(), start + 1_000)
  assert.ok(first.id)
  assert.ok(second.id)
  assert.notEqual(first.id, second.id)
  assert.equal(startAttempt(first, start + 99_000), first)
  let history = addCompletedResult(emptyHistory(content.test.id), completedResult(content, first))
  history = addCompletedResult(history, completedResult(content, second))
  assert.equal(history.attempts.length, 2)
})

test('legacy completed attempts receive deterministic history IDs without changing their source data', () => {
  const legacy = { ...submitAttempt(running(), start + 1_000) }
  delete legacy.id
  const source = JSON.stringify(legacy)
  const first = completedResult(content, legacy)
  const second = completedResult(content, JSON.parse(source))
  assert.equal(first.id, second.id)
  assert.match(first.id, /^legacy:/)
  assert.equal(JSON.stringify(legacy), source)
  const history = addCompletedResult(emptyHistory(content.test.id), first)
  assert.equal(addCompletedResult(history, second), history)
})

test('history retains every completion, orders newest first, and deduplicates only the same submission', () => {
  const a = completedResult(content, submitAttempt(running(), start + 1_000))
  const b = completedResult(content, submitAttempt(running(), start + 3_000))
  const c = completedResult(content, submitAttempt(running(), start + 2_000))
  let history = emptyHistory(content.test.id)
  for (const result of [a, b, c, a, b, c]) history = addCompletedResult(history, result)
  assert.deepEqual(history.attempts.map((result) => result.id), [b.id, c.id, a.id])
  assert.ok(isResultHistory(history, content.test.id))
  assert.throws(() => addCompletedResult(history, { ...a, right: 1, skipped: 4 }), /conflicting result/)
  assert.throws(() => mergeHistories(history, emptyHistory('different-test')), /different tests/)
})

test('history validation rejects invalid identities, dates, counts, totals, and duplicate submissions', () => {
  const result = completedResult(content, submitAttempt(running(), start + 1_000))
  const history = addCompletedResult(emptyHistory(content.test.id), result)
  for (const invalid of [
    { ...history, testId: 'different' },
    { ...history, attempts: [result, result] },
    { ...history, attempts: [{ ...result, right: -1 }] },
    { ...history, attempts: [{ ...result, wrong: 1.5 }] },
    { ...history, attempts: [{ ...result, skipped: 4 }] },
    { ...history, attempts: [{ ...result, total: 0 }] },
    { ...history, attempts: [{ ...result, completedAt: start - 1 }] },
    { ...history, attempts: [{ ...result, elapsedMs: 2_000 }] },
    { ...history, attempts: [{ ...result, completedAt: Number.MAX_SAFE_INTEGER }] },
  ]) assert.equal(isResultHistory(invalid, content.test.id), false)
})

test('saved history merges fresh records and never overwrites another tab previously saved completion', () => {
  const storage = new MemoryStorage()
  const a = completedResult(content, submitAttempt(running(), start + 1_000))
  const b = completedResult(content, submitAttempt(running(), start + 2_000))
  const first = addCompletedResult(emptyHistory(content.test.id), a)
  assert.equal(writeMergedHistory(first, () => storage).saved, true)
  const pending = addCompletedResult(emptyHistory(content.test.id), b)
  const saved = writeMergedHistory(pending, () => storage)
  assert.equal(saved.saved, true)
  assert.equal(saved.history.attempts.length, 2)
  assert.equal(writeMergedHistory(pending, () => storage).history.attempts.length, 2)
  assert.deepEqual(readHistory(content.test.id, () => storage).history, saved.history)
})

test('unreadable or corrupt history stays intact and explicit instead of being replaced with an empty history', () => {
  const storage = new MemoryStorage()
  const key = historyStorageKey(content.test.id)
  const pending = addCompletedResult(emptyHistory(content.test.id), completedResult(content, submitAttempt(running(), start + 1_000)))
  storage.values.set(key, '{corrupt')
  assert.equal(readHistory(content.test.id, () => storage).status, 'invalid')
  assert.equal(writeMergedHistory(pending, () => storage).saved, false)
  assert.equal(storage.values.get(key), '{corrupt')
  storage.failReads = true
  assert.equal(readHistory(content.test.id, () => storage).status, 'unavailable')
  assert.equal(writeMergedHistory(pending, () => storage).saved, false)
  assert.equal(storage.values.get(key), '{corrupt')
})
