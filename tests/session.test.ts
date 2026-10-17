import assert from 'node:assert/strict'
import test from 'node:test'
import {
  answerQuestion, createAttempt, elapsedMilliseconds, markQuestion, navigateTo,
  pauseAttempt, resumeAttempt, startAttempt, submitAttempt, summarize,
} from '../src/attempt.ts'
import type { Attempt } from '../src/attempt.ts'
import { DEFAULT_TEST_ID, testCatalog as realCatalog } from '../src/catalog.ts'
import type { TestCatalogEntry } from '../src/catalog.ts'
import type { TestContent } from '../src/content.ts'
import {
  attemptStorageKey, LEGACY_STORAGE_KEY, readAttempt, readSelectedTest, SELECTED_TEST_STORAGE_KEY, writeAttempt,
} from '../src/persistence.ts'
import { PracticeSession } from '../src/practiceSession.ts'
import { fixtureContent, fixtureEntry, MemoryStorage } from './fixtures.ts'

const start = 1_700_000_000_000
const eleven = fixtureContent(DEFAULT_TEST_ID, [2, 3], 'A')
const four = fixtureContent('practice-test-4-rw', [1, 4, 2], 'B')
const five = fixtureContent('practice-test-5-rw', [3], 'C')
const catalog = [fixtureEntry(four, 4), fixtureEntry(five, 5), fixtureEntry(eleven, 11)]

function environment(storage = new MemoryStorage(), entries: readonly TestCatalogEntry[] = catalog) {
  let now = start
  const session = new PracticeSession({ getStorage: () => storage, catalog: entries, now: () => now })
  return { session, storage, setNow: (time: number) => { now = time } }
}

function active(session: PracticeSession) {
  const snapshot = session.getSnapshot()
  assert.equal(snapshot.status, 'ready')
  assert.ok(snapshot.active)
  return snapshot.active
}

function update(session: PracticeSession, action: (content: TestContent, attempt: Attempt) => Attempt) {
  const current = active(session)
  session.updateAttempt(current.content.test.id, (attempt) => action(current.content, attempt))
}

function saved(storage: MemoryStorage, content: TestContent): Attempt {
  const value = storage.values.get(attemptStorageKey(content.test.id))
  assert.ok(value)
  return JSON.parse(value) as Attempt
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('no selection defaults to Test 11 and repeated initialization/refresh leaves its introduction unstarted', async () => {
  const { session, storage } = environment()
  assert.equal(session.getSnapshot().selectedTest.id, DEFAULT_TEST_ID)
  assert.equal(session.getSnapshot().status, 'loading')
  assert.equal(session.getSnapshot().active, null)
  const firstLoad = session.loadSelected()
  assert.equal(session.loadSelected(), firstLoad)
  await firstLoad
  assert.deepEqual(active(session).attempt, createAttempt(eleven))
  assert.equal(storage.getItem(SELECTED_TEST_STORAGE_KEY), DEFAULT_TEST_ID)
  const refreshed = environment(storage)
  refreshed.setNow(start + 21 * 24 * 60 * 60 * 1_000)
  await refreshed.session.loadSelected()
  assert.equal(active(refreshed.session).attempt.startedAt, null)
  assert.equal(elapsedMilliseconds(active(refreshed.session).attempt), 0)
})

test('selection and attempt keys restore each target independently, without consuming Test 11 answers with repeated IDs', async () => {
  const storage = new MemoryStorage()
  storage.values.set(SELECTED_TEST_STORAGE_KEY, four.test.id)
  const existing = answerQuestion(four, startAttempt(createAttempt(four), start), 'm1-q1', 'B')
  storage.values.set(attemptStorageKey(four.test.id), JSON.stringify(existing))
  const legacy = pauseAttempt(answerQuestion(eleven, startAttempt(createAttempt(eleven), start), 'm1-q1', 'A'), start + 2_000)
  storage.values.set(LEGACY_STORAGE_KEY, JSON.stringify(legacy))
  const { session } = environment(storage)
  assert.equal(session.getSnapshot().selectedTest.id, four.test.id)
  await session.loadSelected()
  assert.deepEqual(active(session).attempt, existing)
  assert.deepEqual(saved(storage, eleven), legacy)
  assert.equal(summarize(four, submitAttempt(active(session).attempt, start + 5_000)).correct, 1)
  assert.notEqual(attemptStorageKey(four.test.id), attemptStorageKey(eleven.test.id))
  assert.equal(attemptStorageKey(eleven.test.id), 'sat-reading-practice:test-11:v1')
})

test('switching pauses and saves the source before recording selection, preserves its cursor/marks/hidden timer, and isolates answers', async () => {
  const { session, storage, setNow } = environment()
  await session.loadSelected()
  update(session, (_, attempt) => startAttempt(attempt, start))
  update(session, (content, attempt) => answerQuestion(content, attempt, 'm1-q1', 'A'))
  update(session, (content, attempt) => markQuestion(content, attempt, 'm2-q3'))
  update(session, (content, attempt) => navigateTo(content, attempt, 'm2-q3'))
  update(session, (_, attempt) => ({ ...attempt, timerHidden: true }))
  setNow(start + 42_000)
  const writeIndex = storage.writes.length
  const switching = session.selectTest(four.test.id)
  assert.equal(session.getSnapshot().active, null)
  assert.equal(session.getSnapshot().selectedTest.id, four.test.id)
  const source = saved(storage, eleven)
  assert.equal(source.pausedAt, start + 42_000)
  assert.equal(elapsedMilliseconds(source, start + 500_000), 42_000)
  assert.deepEqual(source.answers, { 'm1-q1': 'A' })
  assert.deepEqual(source.marked, ['m2-q3'])
  assert.equal(source.currentQuestionId, 'm2-q3')
  assert.equal(source.timerHidden, true)
  const switchWrites = storage.writes.slice(writeIndex)
  assert.equal(switchWrites[0].key, LEGACY_STORAGE_KEY)
  assert.ok(switchWrites.findIndex((write) => write.key === SELECTED_TEST_STORAGE_KEY) > 0)
  await switching
  assert.deepEqual(active(session).attempt, createAttempt(four))
  update(session, (_, attempt) => startAttempt(attempt, start + 50_000))
  update(session, (content, attempt) => answerQuestion(content, attempt, 'm1-q1', 'B'))
  setNow(start + 70_000)
  await session.selectTest(eleven.test.id)
  assert.deepEqual(active(session).attempt, source)
  assert.equal(saved(storage, four).pausedAt, start + 70_000)
  assert.deepEqual(saved(storage, four).answers, { 'm1-q1': 'B' })
  update(session, (_, attempt) => resumeAttempt(attempt, start + 100_000))
  assert.equal(elapsedMilliseconds(active(session).attempt, start + 105_000), 47_000)
  assert.equal(saved(storage, four).pausedAt, start + 70_000)
})

test('active, already-started empty, paused, submitted, and unstarted attempts restore their own lifecycle across refresh', async () => {
  const empty = startAttempt(createAttempt(four), start)
  let answered = answerQuestion(four, empty, 'm2-q4', 'C')
  answered = markQuestion(four, answered, 'm2-q4')
  answered = navigateTo(four, answered, 'm2-q4')
  answered = { ...answered, timerHidden: true }
  for (const attempt of [createAttempt(four), empty, answered, pauseAttempt(answered, start + 12_000), submitAttempt(answered, start + 21_000)]) {
    const storage = new MemoryStorage()
    storage.values.set(SELECTED_TEST_STORAGE_KEY, four.test.id)
    storage.values.set(attemptStorageKey(four.test.id), JSON.stringify(attempt))
    const { session } = environment(storage)
    await session.loadSelected()
    assert.deepEqual(active(session).attempt, attempt)
    assert.equal(session.getSnapshot().selectedTest.id, four.test.id)
    assert.equal(session.getSnapshot().notice, null)
    assert.equal(elapsedMilliseconds(active(session).attempt, start + 30_000), elapsedMilliseconds(attempt, start + 30_000))
  }
})

test('a submitted test stays read-only when switched away and back; restarting affects only that test and returns to the introduction', async () => {
  const { session, storage, setNow } = environment()
  await session.loadSelected()
  update(session, (_, attempt) => startAttempt(attempt, start))
  update(session, (content, attempt) => answerQuestion(content, attempt, 'm1-q1', 'A'))
  update(session, (_, attempt) => submitAttempt(attempt, start + 5_000))
  const completed = active(session).attempt
  setNow(start + 6_000)
  await session.selectTest(four.test.id)
  update(session, (_, attempt) => startAttempt(attempt, start + 7_000))
  update(session, (content, attempt) => answerQuestion(content, attempt, 'm1-q1', 'B'))
  setNow(start + 8_000)
  await session.selectTest(eleven.test.id)
  assert.deepEqual(active(session).attempt, completed)
  assert.throws(() => update(session, (content, attempt) => answerQuestion(content, attempt, 'm1-q1', 'D')), /read-only/)
  const other = saved(storage, four)
  update(session, (content) => createAttempt(content))
  assert.deepEqual(active(session).attempt, createAttempt(eleven))
  assert.equal(elapsedMilliseconds(active(session).attempt, start + 999_000), 0)
  assert.deepEqual(saved(storage, four), other)
})

test('rapid asynchronous selection changes ignore stale successes and failures and never display or persist the wrong dataset', async () => {
  const slowFour = deferred<TestContent>()
  const slowFive = deferred<TestContent>()
  const entries = [
    { ...fixtureEntry(four, 4), load: () => slowFour.promise },
    { ...fixtureEntry(five, 5), load: () => slowFive.promise },
    fixtureEntry(eleven, 11),
  ]
  const { session, storage } = environment(new MemoryStorage(), entries)
  await session.loadSelected()
  update(session, (_, attempt) => startAttempt(attempt, start))
  const first = session.selectTest(four.test.id)
  const second = session.selectTest(five.test.id)
  slowFive.resolve(five)
  await second
  assert.equal(active(session).content, five)
  slowFour.reject(new Error('An obsolete request failed'))
  await first
  assert.equal(active(session).content, five)
  assert.equal(session.getSnapshot().error, null)
  assert.equal(storage.values.has(attemptStorageKey(four.test.id)), false)
  assert.equal(storage.getItem(SELECTED_TEST_STORAGE_KEY), five.test.id)

  const late = deferred<TestContent>()
  const next = environment(new MemoryStorage(), [{ ...fixtureEntry(four, 4), load: () => late.promise }, ...catalog.slice(1)])
  await next.session.loadSelected()
  const stale = next.session.selectTest(four.test.id)
  await next.session.selectTest(five.test.id)
  late.resolve(four)
  await stale
  assert.equal(active(next.session).content, five)
  assert.equal(next.storage.values.has(attemptStorageKey(four.test.id)), false)
})

test('loader failures remain explicitly on the selected test, preserve the paused source, and support retry without fallback', async () => {
  let calls = 0
  const entry = {
    ...fixtureEntry(four, 4),
    load: async () => {
      if (++calls === 1) throw new Error('Network failure')
      return four
    },
  }
  const { session, storage, setNow } = environment(new MemoryStorage(), [entry, ...catalog.slice(1)])
  await session.loadSelected()
  update(session, (_, attempt) => startAttempt(attempt, start))
  update(session, (content, attempt) => answerQuestion(content, attempt, 'm1-q1', 'A'))
  setNow(start + 10_000)
  await session.selectTest(four.test.id)
  assert.equal(session.getSnapshot().status, 'error')
  assert.equal(session.getSnapshot().selectedTest.id, four.test.id)
  assert.equal(session.getSnapshot().active, null)
  assert.match(session.getSnapshot().error ?? '', /Practice Test 4 could not be loaded/)
  assert.equal(saved(storage, eleven).pausedAt, start + 10_000)
  assert.equal(storage.values.has(attemptStorageKey(four.test.id)), false)
  await session.loadSelected()
  assert.equal(active(session).content, four)
  assert.equal(calls, 2)
})

test('a synchronously throwing loader also supports retry without leaving a stuck pending request', async () => {
  let calls = 0
  const entry = {
    ...fixtureEntry(four, 4),
    load: () => {
      if (++calls === 1) throw new Error('Immediate loader failure')
      return Promise.resolve(four)
    },
  }
  const { session } = environment(new MemoryStorage(), [entry, ...catalog.slice(1)])
  await session.selectTest(four.test.id)
  assert.equal(session.getSnapshot().status, 'error')
  await session.loadSelected()
  assert.equal(active(session).content, four)
  assert.equal(calls, 2)
})

test('quickly returning to the source while another test loads restores its paused cursor and ignores the late target', async () => {
  const slow = deferred<TestContent>()
  const { session, storage, setNow } = environment(new MemoryStorage(), [{ ...fixtureEntry(four, 4), load: () => slow.promise }, ...catalog.slice(1)])
  await session.loadSelected()
  update(session, (_, attempt) => startAttempt(attempt, start))
  update(session, (content, attempt) => navigateTo(content, answerQuestion(content, attempt, 'm2-q3', 'A'), 'm2-q3'))
  setNow(start + 9_000)
  const away = session.selectTest(four.test.id)
  await session.selectTest(eleven.test.id)
  assert.equal(active(session).attempt.pausedAt, start + 9_000)
  assert.equal(active(session).attempt.currentQuestionId, 'm2-q3')
  assert.deepEqual(active(session).attempt.answers, { 'm2-q3': 'A' })
  slow.resolve(four)
  await away
  assert.equal(active(session).content, eleven)
  assert.equal(storage.values.has(attemptStorageKey(four.test.id)), false)
})

test('wrong-identity content is an explicit load failure, never a silent alternate test', async () => {
  const entries = [{ ...fixtureEntry(four, 4), load: async () => five }, ...catalog.slice(1)]
  const { session, storage } = environment(new MemoryStorage(), entries)
  await session.selectTest(four.test.id)
  assert.equal(session.getSnapshot().status, 'error')
  assert.equal(session.getSnapshot().active, null)
  assert.equal(session.getSnapshot().selectedTest.id, four.test.id)
  assert.match(session.getSnapshot().error ?? '', /did not pass validation/)
  assert.equal(storage.values.has(attemptStorageKey(four.test.id)), false)
})

test('stale event handlers and wrong-test updates cannot mix repeated IDs after a switch', async () => {
  const { session } = environment()
  await session.loadSelected()
  await session.selectTest(four.test.id)
  const current = active(session).attempt
  let called = false
  session.updateAttempt(eleven.test.id, (attempt) => { called = true; return attempt })
  assert.equal(called, false)
  assert.equal(active(session).attempt, current)
  assert.throws(() => session.updateAttempt(four.test.id, () => createAttempt(eleven)), /not valid for the selected test/)
  assert.equal(active(session).attempt, current)
})

test('write failures keep every in-memory answer/cursor/mark while switching, and retry saves all pending attempts', async () => {
  const { session, storage, setNow } = environment()
  await session.loadSelected()
  storage.failWrites = true
  update(session, (_, attempt) => startAttempt(attempt, start))
  update(session, (content, attempt) => answerQuestion(content, attempt, 'm2-q3', 'D'))
  update(session, (content, attempt) => navigateTo(content, markQuestion(content, attempt, 'm2-q3'), 'm2-q3'))
  assert.equal(session.getSnapshot().saveState, 'failed')
  assert.match(session.getSnapshot().notice ?? '', /could not be saved/)
  setNow(start + 9_000)
  await session.selectTest(four.test.id)
  update(session, (_, attempt) => startAttempt(attempt, start + 10_000))
  update(session, (content, attempt) => answerQuestion(content, attempt, 'm1-q1', 'B'))
  setNow(start + 15_000)
  await session.selectTest(eleven.test.id)
  const retained = active(session).attempt
  assert.deepEqual(retained.answers, { 'm2-q3': 'D' })
  assert.deepEqual(retained.marked, ['m2-q3'])
  assert.equal(retained.currentQuestionId, 'm2-q3')
  assert.equal(elapsedMilliseconds(retained, start + 500_000), 9_000)
  storage.failWrites = false
  session.retrySaving()
  assert.equal(session.getSnapshot().saveState, 'saved')
  assert.equal(session.getSnapshot().notice, null)
  assert.deepEqual(saved(storage, eleven), retained)
  assert.deepEqual(saved(storage, four).answers, { 'm1-q1': 'B' })
})

test('a failed source-pause write never persists a second running timer or a misleading target selection', async () => {
  const { session, storage, setNow } = environment()
  await session.loadSelected()
  update(session, (_, attempt) => startAttempt(attempt, start))
  storage.failingKeys.add(LEGACY_STORAGE_KEY)
  setNow(start + 10_000)
  await session.selectTest(four.test.id)
  update(session, (_, attempt) => startAttempt(attempt, start + 11_000))
  update(session, (content, attempt) => answerQuestion(content, attempt, 'm1-q1', 'B'))
  assert.equal(saved(storage, eleven).pausedAt, null)
  assert.equal(saved(storage, four).startedAt, null)
  assert.equal(storage.getItem(SELECTED_TEST_STORAGE_KEY), eleven.test.id)
  assert.equal(active(session).attempt.startedAt, start + 11_000)
  assert.equal(session.getSnapshot().saveState, 'failed')
  storage.failingKeys.clear()
  session.retrySaving()
  assert.equal(saved(storage, eleven).pausedAt, start + 10_000)
  assert.equal(saved(storage, four).startedAt, start + 11_000)
  assert.deepEqual(saved(storage, four).answers, { 'm1-q1': 'B' })
  assert.equal(storage.getItem(SELECTED_TEST_STORAGE_KEY), four.test.id)
  assert.equal(session.getSnapshot().saveState, 'saved')
})

test('a failed selection write cannot persist a running target that a refresh would leave behind', async () => {
  const { session, storage, setNow } = environment()
  await session.loadSelected()
  update(session, (_, attempt) => startAttempt(attempt, start))
  storage.failingKeys.add(SELECTED_TEST_STORAGE_KEY)
  setNow(start + 10_000)
  await session.selectTest(four.test.id)
  update(session, (_, attempt) => startAttempt(attempt, start + 11_000))
  assert.equal(active(session).attempt.startedAt, start + 11_000)
  assert.equal(saved(storage, eleven).pausedAt, start + 10_000)
  assert.equal(saved(storage, four).startedAt, null)
  assert.equal(storage.getItem(SELECTED_TEST_STORAGE_KEY), eleven.test.id)
  const refreshed = environment(storage)
  await refreshed.session.loadSelected()
  assert.equal(active(refreshed.session).attempt.pausedAt, start + 10_000)
  assert.equal(saved(storage, four).startedAt, null)
  const writeIndex = storage.writes.length
  storage.failingKeys.clear()
  session.retrySaving()
  const retryWrites = storage.writes.slice(writeIndex)
  assert.equal(retryWrites[0].key, SELECTED_TEST_STORAGE_KEY)
  assert.equal(storage.getItem(SELECTED_TEST_STORAGE_KEY), four.test.id)
  assert.equal(saved(storage, four).startedAt, start + 11_000)
  assert.equal(saved(storage, eleven).pausedAt, start + 10_000)
})

test('blocked reads cannot overwrite previously valid progress, even if writes would succeed', async () => {
  const storage = new MemoryStorage()
  const original = answerQuestion(eleven, startAttempt(createAttempt(eleven), start), 'm2-q3', 'D')
  const encoded = JSON.stringify(original)
  storage.values.set(LEGACY_STORAGE_KEY, encoded)
  storage.failReads = true
  const { session } = environment(storage)
  await session.loadSelected()
  assert.equal(session.getSnapshot().saveState, 'failed')
  assert.equal(storage.values.get(LEGACY_STORAGE_KEY), encoded)
  update(session, (_, attempt) => startAttempt(attempt, start + 5_000))
  update(session, (content, attempt) => answerQuestion(content, attempt, 'm1-q1', 'A'))
  storage.failReads = false
  session.retrySaving()
  assert.equal(storage.values.get(LEGACY_STORAGE_KEY), encoded)
  assert.deepEqual(active(session).attempt.answers, { 'm1-q1': 'A' })
  assert.match(session.getSnapshot().notice ?? '', /has not overwritten|have not overwritten/)
})

test('a previously unreadable valid attempt restores safely if the introduction has not been started', async () => {
  const storage = new MemoryStorage()
  const original = navigateTo(eleven, answerQuestion(eleven, startAttempt(createAttempt(eleven), start), 'm2-q3', 'D'), 'm2-q3')
  storage.values.set(LEGACY_STORAGE_KEY, JSON.stringify(original))
  storage.failReads = true
  const { session } = environment(storage)
  await session.loadSelected()
  assert.equal(active(session).attempt.startedAt, null)
  storage.failReads = false
  session.retrySaving()
  assert.deepEqual(active(session).attempt, original)
  assert.equal(session.getSnapshot().saveState, 'saved')
  assert.equal(session.getSnapshot().notice, null)
})

test('a blocked selection read never overwrites an unknown running test, and recovery can restore that test without clearing in-memory work', async () => {
  const storage = new MemoryStorage()
  const original = answerQuestion(four, startAttempt(createAttempt(four), start), 'm1-q1', 'B')
  storage.values.set(SELECTED_TEST_STORAGE_KEY, four.test.id)
  storage.values.set(attemptStorageKey(four.test.id), JSON.stringify(original))
  storage.failReads = true
  const { session, setNow } = environment(storage)
  await session.loadSelected()
  update(session, (_, attempt) => startAttempt(attempt, start + 5_000))
  update(session, (content, attempt) => answerQuestion(content, attempt, 'm1-q1', 'A'))
  assert.equal(storage.values.get(SELECTED_TEST_STORAGE_KEY), four.test.id)
  assert.equal(storage.values.has(LEGACY_STORAGE_KEY), false)
  storage.failReads = false
  session.retrySaving()
  assert.equal(session.getSnapshot().saveState, 'failed')
  assert.match(session.getSnapshot().notice ?? '', /Choose Practice Test 4/)
  assert.deepEqual(saved(storage, four), original)
  assert.equal(storage.values.has(LEGACY_STORAGE_KEY), false)
  setNow(start + 15_000)
  await session.selectTest(four.test.id)
  assert.deepEqual(active(session).attempt, original)
  assert.equal(saved(storage, eleven).pausedAt, start + 15_000)
  assert.deepEqual(saved(storage, eleven).answers, { 'm1-q1': 'A' })
  assert.equal(session.getSnapshot().saveState, 'saved')
})

test('unavailable storage is explicit but does not prevent in-memory practice or changing tests', async () => {
  const session = new PracticeSession({ catalog, getStorage: () => { throw new Error('Storage blocked') }, now: () => start + 10_000 })
  await session.loadSelected()
  update(session, (_, attempt) => startAttempt(attempt, start))
  update(session, (content, attempt) => answerQuestion(content, attempt, 'm1-q1', 'A'))
  await session.selectTest(four.test.id)
  await session.selectTest(eleven.test.id)
  assert.deepEqual(active(session).attempt.answers, { 'm1-q1': 'A' })
  assert.equal(active(session).attempt.pausedAt, start + 10_000)
  assert.equal(session.getSnapshot().saveState, 'failed')
  assert.match(session.getSnapshot().notice ?? '', /blocking saved|could not be saved/)
})

test('an unavailable saved selection falls back explicitly to Test 11 without clearing its valid progress', async () => {
  const storage = new MemoryStorage()
  storage.values.set(SELECTED_TEST_STORAGE_KEY, 'an-unavailable-test')
  const attempt = startAttempt(createAttempt(eleven), start)
  storage.values.set(LEGACY_STORAGE_KEY, JSON.stringify(attempt))
  const { session } = environment(storage)
  await session.loadSelected()
  assert.equal(session.getSnapshot().selectedTest.id, DEFAULT_TEST_ID)
  assert.deepEqual(active(session).attempt, attempt)
  assert.match(session.getSnapshot().notice ?? '', /selection is unavailable/)
  session.dismissNotice()
  assert.equal(session.getSnapshot().notice, null)
})

test('pre-pause v1 states, including an unstarted hidden-timer state, migrate without changing valid progress', () => {
  const unstarted = { ...createAttempt(eleven), timerHidden: true }
  const activeAttempt = startAttempt(createAttempt(eleven), start)
  const answered = markQuestion(eleven, navigateTo(eleven, answerQuestion(eleven, activeAttempt, 'm2-q3', 'C'), 'm2-q3'), 'm2-q3')
  for (const attempt of [unstarted, activeAttempt, answered, { ...submitAttempt(answered, start + 22_000), timerHidden: true }]) {
    const { pausedAt: _pausedAt, pausedDurationMs: _pausedDurationMs, ...legacy } = attempt
    const restored = readAttempt(eleven, () => ({ getItem: (key) => {
      assert.equal(key, LEGACY_STORAGE_KEY)
      return JSON.stringify(legacy)
    } }))
    assert.equal(restored.notice, null)
    assert.deepEqual(restored.attempt, attempt)
  }
})

test('selection and attempt storage helpers report failures without throwing or using another test key', () => {
  const storage = new MemoryStorage()
  assert.deepEqual(readSelectedTest(catalog, () => storage), { testId: DEFAULT_TEST_ID, notice: null, status: 'default' })
  assert.equal(writeAttempt(createAttempt(four), () => storage), true)
  assert.equal(storage.values.has(LEGACY_STORAGE_KEY), false)
  storage.failWrites = true
  assert.equal(writeAttempt(startAttempt(createAttempt(four), start), () => storage), false)
  assert.equal(saved(storage, four).startedAt, null)
})

test('switching through all eight real datasets independently saves paused attempts and restores Test 11 without mixing progress', async () => {
  const { session, storage, setNow } = environment(new MemoryStorage(), realCatalog)
  await session.loadSelected()
  const expected = new Map<string, Attempt>()
  const entries = [realCatalog.find((entry) => entry.id === DEFAULT_TEST_ID)!, ...realCatalog.filter((entry) => entry.id !== DEFAULT_TEST_ID)]
  let now = start
  for (const entry of entries) {
    if (session.getSnapshot().selectedTest.id !== entry.id) {
      setNow(now)
      await session.selectTest(entry.id)
    }
    const { content, attempt } = active(session)
    assert.deepEqual(attempt, createAttempt(content))
    const first = content.questions[0]
    const last = content.questions.at(-1)!
    update(session, (_, current) => startAttempt(current, now))
    update(session, (selected, current) => answerQuestion(selected, current, first.id, first.correctAnswer))
    update(session, (selected, current) => navigateTo(selected, markQuestion(selected, current, last.id), last.id))
    update(session, (_, current) => ({ ...current, timerHidden: entry.number % 2 === 0 }))
    now += 5_000
    expected.set(entry.id, pauseAttempt(active(session).attempt, now))
    const attemptKeys = new Set(realCatalog.map((entry) => attemptStorageKey(entry.id)))
    const running = [...storage.values.entries()].filter(([key]) => attemptKeys.has(key)).map(([, value]) => JSON.parse(value) as Attempt)
    assert.equal(running.filter((current) => current.startedAt !== null && current.pausedAt === null && current.submittedAt === null).length, 1)
  }
  setNow(now)
  await session.selectTest(DEFAULT_TEST_ID)
  assert.deepEqual(active(session).attempt, expected.get(DEFAULT_TEST_ID))
  for (const entry of realCatalog) {
    const content = await entry.load()
    assert.deepEqual(saved(storage, content), expected.get(entry.id), entry.title)
    assert.equal(summarize(content, saved(storage, content)).answered, 1, entry.title)
  }
  update(session, (_, current) => resumeAttempt(current, now + 100_000))
  const resumed = active(session).attempt
  assert.equal(elapsedMilliseconds(resumed, now + 101_000), 6_000)
  const refreshed = environment(storage, realCatalog)
  await refreshed.session.loadSelected()
  assert.equal(refreshed.session.getSnapshot().selectedTest.id, DEFAULT_TEST_ID)
  assert.deepEqual(active(refreshed.session).attempt, resumed)
})
