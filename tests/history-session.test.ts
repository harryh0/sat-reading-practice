import assert from 'node:assert/strict'
import test from 'node:test'
import { answerQuestion, createAttempt, elapsedMilliseconds, navigateTo, pauseAttempt, startAttempt, submitAttempt } from '../src/attempt.ts'
import type { Attempt } from '../src/attempt.ts'
import { DEFAULT_TEST_ID } from '../src/catalog.ts'
import { addCompletedResult, completedResult, emptyHistory } from '../src/history.ts'
import { attemptStorageKey, historyStorageKey, PRACTICE_VIEW_STORAGE_KEY, SELECTED_TEST_STORAGE_KEY } from '../src/persistence.ts'
import { PracticeSession } from '../src/practiceSession.ts'
import { fixtureContent, fixtureEntry, MemoryStorage } from './fixtures.ts'

const start = 1_700_000_000_000
const eleven = fixtureContent(DEFAULT_TEST_ID, [2, 3], 'A')
const four = fixtureContent('practice-test-4-rw', [1, 2], 'B')
const catalog = [fixtureEntry(four, 4), fixtureEntry(eleven, 11)]

function environment(storage = new MemoryStorage()) {
  let now = start
  const session = new PracticeSession({ getStorage: () => storage, catalog, now: () => now })
  return { session, storage, time: (value: number) => { now = value } }
}

function current(session: PracticeSession) {
  const active = session.getSnapshot().active
  assert.ok(active)
  return active
}

function change(session: PracticeSession, update: (attempt: Attempt) => Attempt) {
  return session.updateAttempt(session.getSnapshot().selectedTest.id, update)
}

function history(storage: MemoryStorage, id = DEFAULT_TEST_ID) {
  const raw = storage.getItem(historyStorageKey(id))
  assert.ok(raw)
  return JSON.parse(raw)
}

test('submission is recorded once across repeated submit, review navigation, rendering, and refresh', async () => {
  const { session, storage } = environment()
  await session.loadSelected()
  change(session, (attempt) => startAttempt(attempt, start))
  change(session, (attempt) => answerQuestion(eleven, attempt, 'm1-q1', 'A'))
  change(session, (attempt) => answerQuestion(eleven, attempt, 'm1-q2', 'B'))
  change(session, (attempt) => submitAttempt(attempt, start + 5_000))
  assert.deepEqual(history(storage).attempts.map((result: { right: number; wrong: number; skipped: number }) => [result.right, result.wrong, result.skipped]), [[1, 1, 3]])
  change(session, (attempt) => submitAttempt(attempt, start + 99_000))
  change(session, (attempt) => navigateTo(eleven, attempt, 'm2-q3'))
  await session.openTests()
  assert.equal(history(storage).attempts.length, 1)
  const refreshed = environment(storage)
  await refreshed.session.loadSelected()
  await refreshed.session.openTests()
  assert.equal(history(storage).attempts.length, 1)
})

test('every completed attempt survives New attempt, switching, refresh, and identical timestamps', async () => {
  const { session, storage } = environment()
  await session.loadSelected()
  for (let index = 0; index < 3; index++) {
    if (index) assert.equal(change(session, () => createAttempt(eleven)), true)
    change(session, (attempt) => startAttempt(attempt, start))
    if (index === 1) change(session, (attempt) => answerQuestion(eleven, attempt, 'm1-q1', 'A'))
    if (index === 2) change(session, (attempt) => answerQuestion(eleven, attempt, 'm1-q1', 'B'))
    change(session, (attempt) => submitAttempt(attempt, start + 5_000))
  }
  assert.equal(history(storage).attempts.length, 3)
  assert.equal(new Set(history(storage).attempts.map((result: { id: string }) => result.id)).size, 3)
  await session.selectTest(four.test.id)
  await session.selectTest(eleven.test.id)
  assert.equal(history(storage).attempts.length, 3)
  const refreshed = environment(storage)
  await refreshed.session.loadSelected()
  assert.equal(history(storage).attempts.length, 3)
})

test('existing submitted records backfill once for every test without rewriting their source progress', async () => {
  const storage = new MemoryStorage()
  const legacy = {
    version: 1, testId: eleven.test.id, startedAt: start, submittedAt: start + 12_000,
    answers: { 'm1-q1': 'A', 'm1-q2': 'B' }, marked: ['m2-q1'], currentQuestionId: 'm2-q3', timerHidden: true,
  }
  const other = submitAttempt(startAttempt(createAttempt(four), start + 1_000), start + 7_000)
  delete other.id
  const source11 = JSON.stringify(legacy)
  const source4 = JSON.stringify(other)
  storage.values.set(attemptStorageKey(eleven.test.id), source11)
  storage.values.set(attemptStorageKey(four.test.id), source4)
  for (let refresh = 0; refresh < 3; refresh++) {
    const { session } = environment(storage)
    await session.loadSelected()
    await session.openTests()
    assert.equal(history(storage, eleven.test.id).attempts.length, 1)
    assert.equal(history(storage, four.test.id).attempts.length, 1)
    assert.equal(storage.values.get(attemptStorageKey(eleven.test.id)), source11)
    assert.equal(storage.values.get(attemptStorageKey(four.test.id)), source4)
  }
  const result = history(storage).attempts[0]
  assert.deepEqual([result.right, result.wrong, result.skipped, result.elapsedMs], [1, 1, 3, 12_000])
})

test('opening Tests pauses and saves practice, hides active accuracy in library metadata, and persists the page', async () => {
  const { session, storage, time } = environment()
  await session.loadSelected()
  change(session, (attempt) => startAttempt(attempt, start))
  change(session, (attempt) => answerQuestion(eleven, attempt, 'm1-q1', 'A'))
  change(session, (attempt) => navigateTo(eleven, attempt, 'm2-q3'))
  time(start + 23_000)
  await session.openTests()
  assert.equal(session.getSnapshot().view, 'tests')
  const stored = JSON.parse(storage.getItem(attemptStorageKey(eleven.test.id))!)
  assert.equal(stored.pausedAt, start + 23_000)
  assert.equal(elapsedMilliseconds(stored, start + 999_000), 23_000)
  const row = session.getSnapshot().library.find((row) => row.entry.id === eleven.test.id)!
  assert.deepEqual(row.progress, { phase: 'paused', answered: 1, total: 5 })
  assert.equal('right' in row.progress!, false)
  assert.equal('wrong' in row.progress!, false)
  assert.equal(row.history.attempts.length, 0)
  assert.equal(storage.getItem(PRACTICE_VIEW_STORAGE_KEY), 'tests')
  assert.equal(change(session, (attempt) => answerQuestion(eleven, attempt, 'm1-q1', 'B')), false)
  const refreshed = environment(storage)
  refreshed.time(start + 100_000)
  await refreshed.session.loadSelected()
  await refreshed.session.openTests()
  assert.equal(refreshed.session.getSnapshot().view, 'tests')
  assert.equal(current(refreshed.session).attempt.currentQuestionId, 'm2-q3')
  await refreshed.session.openPractice(eleven.test.id, true)
  assert.equal(refreshed.session.getSnapshot().view, 'practice')
  assert.equal(current(refreshed.session).attempt.currentQuestionId, 'm2-q3')
  assert.deepEqual(current(refreshed.session).attempt.answers, { 'm1-q1': 'A' })
  assert.equal(elapsedMilliseconds(current(refreshed.session).attempt, start + 105_000), 28_000)
})

test('restart changes only the selected current attempt and never its or another test history', async () => {
  const { session, storage } = environment()
  await session.loadSelected()
  change(session, (attempt) => submitAttempt(startAttempt(attempt, start), start + 1_000))
  await session.selectTest(four.test.id)
  change(session, (attempt) => submitAttempt(startAttempt(attempt, start), start + 2_000))
  const otherProgress = storage.getItem(attemptStorageKey(eleven.test.id))
  const otherHistory = storage.getItem(historyStorageKey(eleven.test.id))
  const ownHistory = storage.getItem(historyStorageKey(four.test.id))
  assert.equal(change(session, () => createAttempt(four)), true)
  assert.equal(current(session).attempt.startedAt, null)
  assert.equal(storage.getItem(historyStorageKey(four.test.id)), ownHistory)
  assert.equal(storage.getItem(historyStorageKey(eleven.test.id)), otherHistory)
  assert.equal(storage.getItem(attemptStorageKey(eleven.test.id)), otherProgress)
})

test('a failed history write retains the submitted source, blocks destructive restart, and can be retried once', async () => {
  const { session, storage } = environment()
  await session.loadSelected()
  storage.failingKeys.add(historyStorageKey(eleven.test.id))
  change(session, (attempt) => submitAttempt(startAttempt(attempt, start), start + 3_000))
  const submitted = storage.getItem(attemptStorageKey(eleven.test.id))
  assert.ok(JSON.parse(submitted!).submittedAt)
  assert.equal(change(session, () => createAttempt(eleven)), false)
  assert.equal(storage.getItem(attemptStorageKey(eleven.test.id)), submitted)
  assert.notEqual(current(session).attempt.submittedAt, null)
  assert.equal(session.getSnapshot().saveState, 'failed')
  assert.match(session.getSnapshot().notice ?? '', /history|kept/i)
  storage.failingKeys.clear()
  session.retrySaving()
  assert.equal(history(storage).attempts.length, 1)
  assert.equal(change(session, () => createAttempt(eleven)), true)
  assert.equal(history(storage).attempts.length, 1)
})

test('current submission is durable before its history and failed current writes cannot create misleading history', async () => {
  const { session, storage } = environment()
  await session.loadSelected()
  change(session, (attempt) => startAttempt(attempt, start))
  storage.failingKeys.add(attemptStorageKey(eleven.test.id))
  change(session, (attempt) => submitAttempt(attempt, start + 5_000))
  assert.equal(storage.getItem(historyStorageKey(eleven.test.id)), null)
  assert.equal(change(session, () => createAttempt(eleven)), false)
  storage.failingKeys.clear()
  session.retrySaving()
  assert.equal(history(storage).attempts.length, 1)
  const progressWrite = storage.writes.findIndex((write) => write.key === attemptStorageKey(eleven.test.id) && JSON.parse(write.value).submittedAt !== null)
  const historyWrite = storage.writes.findIndex((write) => write.key === historyStorageKey(eleven.test.id))
  assert.ok(progressWrite >= 0 && historyWrite > progressWrite)
})

test('corrupt history is preserved and never replaced during backfill or restart', async () => {
  const storage = new MemoryStorage()
  storage.values.set(historyStorageKey(eleven.test.id), '{broken history')
  const submitted = submitAttempt(startAttempt(createAttempt(eleven), start), start + 5_000)
  const source = JSON.stringify(submitted)
  storage.values.set(attemptStorageKey(eleven.test.id), source)
  const { session } = environment(storage)
  await session.loadSelected()
  assert.equal(change(session, () => createAttempt(eleven)), false)
  assert.equal(storage.getItem(historyStorageKey(eleven.test.id)), '{broken history')
  assert.equal(storage.getItem(attemptStorageKey(eleven.test.id)), source)
  await session.openTests()
  assert.equal(session.getSnapshot().library.find((row) => row.entry.id === eleven.test.id)?.historyStatus, 'error')
})

test('conflicting result metadata stays explicit and cannot be cleared by a successful reread of the same history', async () => {
  const storage = new MemoryStorage()
  const submitted = submitAttempt(answerQuestion(eleven, startAttempt(createAttempt(eleven), start), 'm1-q1', 'A'), start + 5_000)
  const result = completedResult(eleven, submitted)
  const conflicting = addCompletedResult(emptyHistory(eleven.test.id), { ...result, right: 0, wrong: 1 })
  const source = JSON.stringify(submitted)
  const existing = JSON.stringify(conflicting)
  storage.values.set(attemptStorageKey(eleven.test.id), source)
  storage.values.set(historyStorageKey(eleven.test.id), existing)
  const { session } = environment(storage)
  await session.loadSelected()
  session.retrySaving()
  assert.equal(session.getSnapshot().saveState, 'failed')
  assert.match(session.getSnapshot().notice ?? '', /conflicting result/)
  assert.equal(change(session, () => createAttempt(eleven)), false)
  assert.equal(storage.getItem(attemptStorageKey(eleven.test.id)), source)
  assert.equal(storage.getItem(historyStorageKey(eleven.test.id)), existing)
})

test('stored selection and histories remain isolated when entering and leaving the Tests page', async () => {
  const { session, storage } = environment()
  await session.loadSelected()
  await session.openTests()
  await session.openPractice(four.test.id)
  assert.equal(current(session).attempt.startedAt, null)
  assert.equal(storage.getItem(SELECTED_TEST_STORAGE_KEY), four.test.id)
  change(session, (attempt) => submitAttempt(startAttempt(attempt, start), start + 1_000))
  await session.openTests()
  const fourRow = session.getSnapshot().library.find((row) => row.entry.id === four.test.id)!
  const elevenRow = session.getSnapshot().library.find((row) => row.entry.id === eleven.test.id)!
  assert.equal(fourRow.history.attempts.length, 1)
  assert.equal(elevenRow.history.attempts.length, 0)
})

test('a delayed Resume cannot restart the clock after newer Tests/Practice navigation canceled that intent', async () => {
  const storage = new MemoryStorage()
  const paused = pauseAttempt(startAttempt(createAttempt(four), start), start + 10_000)
  storage.values.set(attemptStorageKey(four.test.id), JSON.stringify(paused))
  let release!: (content: typeof four) => void
  const delayed = new Promise<typeof four>((resolve) => { release = resolve })
  const delayedEntry = { ...fixtureEntry(four, 4), load: () => delayed }
  const session = new PracticeSession({ getStorage: () => storage, catalog: [delayedEntry, catalog[1]], now: () => start + 90_000 })
  await session.loadSelected()
  const olderResume = session.openPractice(four.test.id, true)
  const tests = session.openTests()
  const returnPaused = session.openPractice(four.test.id)
  release(four)
  await Promise.all([olderResume, tests, returnPaused])
  assert.equal(session.getSnapshot().view, 'practice')
  assert.equal(current(session).attempt.pausedAt, paused.pausedAt)
  assert.equal(elapsedMilliseconds(current(session).attempt, start + 100_000), 10_000)
})
