import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { answerQuestion, createAttempt, pauseAttempt, startAttempt, submitAttempt } from '../src/attempt.ts'
import type { Attempt } from '../src/attempt.ts'
import { testCatalog } from '../src/catalog.ts'
import type { TestCatalogEntry } from '../src/catalog.ts'
import type { TestContent } from '../src/content.ts'
import { addCompletedResult, completedResult, emptyHistory } from '../src/history.ts'
import type { ResultHistory } from '../src/history.ts'
import type { LibraryTest } from '../src/practiceSession.ts'
import { fixtureContent, fixtureEntry } from './fixtures.ts'
import './register-test-modules.ts'

const { TestLibrary } = await import('../src/TestLibrary.tsx')
const start = 1_700_000_000_000
const content = fixtureContent('library-ui', [2, 3], 'A')
const entry = fixtureEntry(content, 4)
const noop = () => {}

function plain(html: string) {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function row(selected = content, attempt = createAttempt(selected), selectedEntry = entry, history = emptyHistory(selected.test.id)): LibraryTest {
  return {
    entry: selectedEntry, status: 'ready', error: null, progressNotice: null,
    progress: {
      phase: attempt.submittedAt !== null ? 'completed' : attempt.startedAt === null ? 'not-started' : attempt.pausedAt !== null ? 'paused' : 'in-progress',
      answered: Object.keys(attempt.answers).length, total: selected.questions.length,
    },
    history, historyStatus: 'ready', historyNotice: null, historySaved: true,
  }
}

function render(items: readonly LibraryTest[], selectedTestId = items[0]?.entry.id ?? '') {
  return renderToStaticMarkup(createElement(TestLibrary, { items, selectedTestId, onOpenTest: noop, onRetry: noop }))
}

function resultHistory(attempts: Attempt[]): ResultHistory {
  return attempts.reduce((history, attempt) => addCompletedResult(history, completedResult(content, attempt)), emptyHistory(content.test.id))
}

test('the full-page library exposes all eight neutral test titles with labelled actions and no question content or selector', async () => {
  const items = await Promise.all(testCatalog.map(async (entry: TestCatalogEntry) => {
    const selected: TestContent = await entry.load()
    return row(selected, createAttempt(selected), entry)
  }))
  const html = render(items)
  assert.match(html, /<main[^>]*aria-labelledby="tests-heading"/)
  assert.match(plain(html), /Practice tests/)
  for (const entry of testCatalog) {
    assert.ok(html.includes(`>${entry.title}</h2>`))
    assert.ok(html.includes(`aria-label="Start test: ${entry.title}"`))
  }
  assert.equal((html.match(/class="test-card(?: is-selected)?"/g) ?? []).length, 8)
  assert.equal((html.match(/class="selected-test-label"/g) ?? []).length, 1)
  assert.doesNotMatch(html, /<select|test-select|SAT|source PDF|No time limit|watermark|<img|answer-options|question-prompt|class="explanation"/i)
})

test('library actions distinguish unstarted, paused, running, and submitted current progress independently of past completions', () => {
  const active = answerQuestion(content, startAttempt(createAttempt(content), start), 'm1-q1', 'A')
  const paused = pauseAttempt(active, start + 1_000)
  const submitted = submitAttempt(active, start + 2_000)
  for (const [attempt, phase, action] of [
    [createAttempt(content), 'Not started', 'Start test'],
    [active, 'In progress', 'Resume'],
    [paused, 'Paused', 'Resume'],
    [submitted, 'Completed', 'Review results'],
  ] as const) {
    const html = render([row(content, attempt)])
    assert.ok(plain(html).includes(`Current attempt: ${phase}`))
    assert.ok(html.includes(`aria-label="${action}: Practice Test 4"`))
  }
  const restarted = render([row(content, createAttempt(content), entry, resultHistory([submitted]))])
  assert.match(plain(restarted), /Current attempt: Not started/)
  assert.match(plain(restarted), /1 completed attempt/)
  assert.match(restarted, /aria-label="Start test: Practice Test 4"/)
})

test('every completed record remains visible with a completion timestamp and separate accurate Right/Wrong/Skipped counts', () => {
  const empty = submitAttempt(startAttempt(createAttempt(content), start), start + 1_000)
  let perfect = startAttempt(createAttempt(content), start)
  for (const question of content.questions) perfect = answerQuestion(content, perfect, question.id, 'A')
  perfect = submitAttempt(perfect, start + 2_000)
  let mixed = answerQuestion(content, startAttempt(createAttempt(content), start), 'm1-q1', 'A')
  mixed = answerQuestion(content, mixed, 'm1-q2', 'B')
  mixed = submitAttempt(mixed, start + 3_000)
  const history = resultHistory([empty, perfect, mixed])
  const html = render([row(content, mixed, entry, history)])
  const text = plain(html)
  assert.match(text, /3 completed attempts/)
  assert.match(text, /Right 1 Wrong 1 Skipped 3/)
  assert.match(text, /Right 5 Wrong 0 Skipped 0/)
  assert.match(text, /Right 0 Wrong 0 Skipped 5/)
  assert.equal((html.match(/class="history-entry"/g) ?? []).length, 3)
  assert.equal((html.match(/<time /g) ?? []).length, 3)
  for (const result of history.attempts) assert.ok(html.includes(`dateTime="${new Date(result.completedAt).toISOString()}"`))
  assert.match(html, /<details class="completed-history" open="">/)
  assert.match(text, /5 questions total/)
})

test('unfinished answers never expose accuracy in library cards or claim an unrecorded older completion never happened', () => {
  let active = startAttempt(createAttempt(content), start)
  active = answerQuestion(content, active, 'm1-q1', 'A')
  active = answerQuestion(content, active, 'm1-q2', 'B')
  const html = render([row(content, active)])
  const text = plain(html)
  assert.match(text, /2 of 5 answered/)
  assert.match(text, /No completed attempts recorded in this browser/)
  assert.doesNotMatch(html, /result-counts|Right|Wrong|Skipped|Supplied explanation|Domain prompt|Domain passage|Domain option|Correct answer|class="history-entry"/)
  assert.match(text, /Attempts that were reset before their results were recorded cannot be recovered/)
})

test('individual load and history errors remain explicit while other cards and all known completions remain accessible', () => {
  const submitted = submitAttempt(startAttempt(createAttempt(content), start), start + 1_000)
  const history = resultHistory([submitted])
  const failed: LibraryTest = {
    ...row(content, submitted, entry, history), status: 'error', progress: null,
    error: 'Practice Test 4 could not be loaded. Saved progress and completed history have not been cleared.',
    historySaved: false, historyStatus: 'error', historyNotice: 'Existing saved results have not been overwritten.',
  }
  const other = fixtureContent('library-other', [1], 'B')
  const html = render([failed, row(other, createAttempt(other), fixtureEntry(other, 11))])
  assert.match(plain(html), /Try again/)
  assert.match(plain(html), /Existing saved results have not been overwritten/)
  assert.match(plain(html), /These results are not fully saved yet/)
  assert.match(plain(html), /Right 0 Wrong 0 Skipped 5/)
  assert.match(html, /aria-label="Start test: Practice Test 11"/)
  assert.match(html, /role="alert"/)
  assert.doesNotMatch(html, /aria-label="Start test: Practice Test 4"/)
})
