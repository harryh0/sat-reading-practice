import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  answerQuestion, createAttempt, markQuestion, navigateTo, pauseAttempt, startAttempt, submitAttempt,
} from '../src/attempt.ts'
import type { Attempt } from '../src/attempt.ts'
import { testCatalog } from '../src/catalog.ts'
import type { TestCatalogEntry } from '../src/catalog.ts'
import { parseTestContent } from '../src/content.ts'
import type { TestContent } from '../src/content.ts'
import { SAVE_FAILURE_NOTICE } from '../src/persistence.ts'
import { fixtureContent, fixtureEntry, fixtureSource } from './fixtures.ts'
import './register-test-modules.ts'

const { PracticeWorkspace, QuestionView, TestLoadingView, SubmitDialog, RestartDialog } = await import('../src/App.tsx')
const start = 1_700_000_000_000
const content = fixtureContent('domain-ui', [1, 4, 2], 'B')
const entry = fixtureEntry(content, 4)
const noop = () => {}

function plain(html: string) {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function workspace(attempt: Attempt, selected: TestContent = content, notice: string | null = null, failed = false) {
  return renderToStaticMarkup(createElement(PracticeWorkspace, {
    selectedTest: selected === content ? entry : fixtureEntry(selected, 4),
    content: selected,
    attempt,
    notice,
    saveState: failed ? 'failed' : 'saved',
    onShowTests: noop,
    onShowPractice: noop,
    onUpdateAttempt: () => true,
    onDismissNotice: noop,
    onRetrySaving: noop,
  }))
}

function question(attempt: Attempt, selected: TestContent = content) {
  return renderToStaticMarkup(createElement(QuestionView, {
    content: selected,
    questionId: attempt.currentQuestionId,
    attempt,
    saveState: 'saved',
    onAnswer: noop,
    onMark: noop,
  }))
}

test('the fresh/refreshed introduction identifies the selected test, has Tests/Practice navigation and derived counts, and hides every question/timer/navigation surface', () => {
  const html = workspace(createAttempt(content))
  const text = plain(html)
  assert.match(html, /<nav class="main-navigation" aria-label="Practice navigation">/)
  assert.match(html, /class="navigation-tab"[^>]*>Tests<\/button>/)
  assert.match(html, /aria-current="page"[^>]*>Practice<\/button>/)
  assert.doesNotMatch(html, /test-select|Choose test/)
  assert.match(text, /Practice Test 4/)
  assert.match(text, /Start test/)
  assert.match(text, /7 questions/)
  assert.match(text, /3 modules/)
  assert.match(text, /Module 1: 1 question \/ Module 2: 4 questions \/ Module 3: 2 questions/)
  assert.doesNotMatch(text, /SAT|source metadata|PDF|No time limit\. Work at your pace|33 questions|66 questions/)
  assert.doesNotMatch(html, /Domain passage|Domain prompt|Domain option|Supplied explanation|answer-options|question-prompt|module-select|question-jump|page-navigation|role="timer"|<img/)
  assert.equal(question(createAttempt(content)), '')
  assert.equal(workspace(JSON.parse(JSON.stringify(createAttempt(content))) as Attempt), html)
})

test('Start reveals the selected test first question with a zero count-up timer and no supplied answers/explanations before submission', () => {
  const started = startAttempt(createAttempt(content), Date.now())
  const html = workspace(started)
  const text = plain(html)
  assert.match(text, /Practice Test 4/)
  assert.match(text, /00:00/)
  assert.match(html, /Domain passage for domain-ui, module 1, question 1/)
  assert.match(html, /Domain prompt for domain-ui, question 1/)
  assert.match(html, /name="answer-domain-ui-m1-q1"/)
  assert.match(html, /id="module-select"/)
  assert.match(html, /aria-label="Question navigation"/)
  assert.doesNotMatch(html, /Supplied explanation|Correct answer:|class="explanation"|choice-state|out of 7|Start test/)
})

test('pause hides prose, prompts, graphs, options, explanations, module/question navigation while retaining selected-test identity and frozen timer', () => {
  const source = fixtureSource('domain-paused-graph', [1])
  source.modules[0].questions[0].passageHtml = ''
  source.modules[0].questions[0].figure = { src: '/figures/domain-only-graph.png', alt: 'A uniquely described domain graph' }
  const graph = parseTestContent(source)
  let attempt = answerQuestion(graph, startAttempt(createAttempt(graph), start), 'm1-q1', 'D')
  attempt = markQuestion(graph, attempt, 'm1-q1')
  const paused = pauseAttempt(attempt, start + 12_000)
  const html = workspace(paused, graph)
  const text = plain(html)
  assert.match(text, /Practice Test 4/)
  assert.match(text, /Practice paused/)
  assert.match(text, /Resume practice/)
  assert.match(text, /00:12/)
  assert.match(html, /aria-label="Practice navigation"/)
  assert.doesNotMatch(html, /A uniquely described domain graph|domain-only-graph|Domain passage|Domain prompt|Domain option|Supplied explanation|<img|answer-options|question-prompt|module-select|question-jump|page-navigation/)
  assert.equal(question(paused, graph), '')
  assert.deepEqual(paused.answers, { 'm1-q1': 'D' })
  assert.deepEqual(paused.marked, ['m1-q1'])
})

test('hidden timers stay hidden without hiding active questions or changing selected-test identity', () => {
  const attempt = { ...startAttempt(createAttempt(content), start), timerHidden: true }
  const html = workspace(attempt)
  assert.match(plain(html), /Timer hidden/)
  assert.match(plain(html), /Show timer/)
  assert.match(plain(html), /Practice Test 4/)
  assert.match(html, /Domain passage for domain-ui/)
})

test('results use selected dataset totals and module sizes, identify the test, and review renders supplied explanations with read-only choices', () => {
  let attempt = answerQuestion(content, startAttempt(createAttempt(content), start), 'm1-q1', 'B')
  attempt = answerQuestion(content, attempt, 'm2-q1', 'A')
  const submitted = submitAttempt(attempt, start + 23_000)
  const html = workspace(submitted)
  const text = plain(html)
  assert.match(text, /Practice Test 4/)
  assert.match(text, /1 out of 7/)
  assert.match(text, /2 answered/)
  assert.match(text, /5 unanswered/)
  assert.match(text, /Right 1 Wrong 1 Skipped 5/)
  assert.match(text, /Module 1 1 \/ 1 correct/)
  assert.match(text, /Module 2 0 \/ 4 correct/)
  assert.match(text, /Module 3 0 \/ 2 correct/)
  assert.match(text, /Start new attempt/)
  const review = question(navigateTo(content, submitted, 'm2-q1'))
  assert.match(review, /Supplied explanation for domain-ui, module 2, question 1/)
  assert.match(review, /Correct answer: B/)
  assert.match(review, /Your answer: A/)
  assert.match(review, /disabled=""/)
  assert.match(review, /is-incorrect/)
  assert.match(review, /is-correct/)
  assert.doesNotMatch(review, /Clear answer|Domain prompt for domain-ui-other|Supplied explanation for domain-ui-other/)
})

test('repeated question IDs resolve their own selected content and do not permit a cross-test review', () => {
  const other = fixtureContent('domain-ui-other', [1], 'D')
  const attempt = submitAttempt(answerQuestion(other, startAttempt(createAttempt(other), start), 'm1-q1', 'D'), start + 1_000)
  const html = question(attempt, other)
  assert.match(html, /Supplied explanation for domain-ui-other/)
  assert.match(html, /Correct answer: D/)
  assert.doesNotMatch(html, /Supplied explanation for domain-ui,|Correct answer: B/)
  assert.throws(() => question(attempt, content), /different practice test/)
})

test('figures without numeric tables retain the exact image and alt without rendering an invented table', () => {
  for (const table of [undefined, null]) {
    const source = fixtureSource('domain-graph-ui', [1])
    source.modules[0].questions[0].passageHtml = ''
    source.modules[0].questions[0].figure = { src: '/figures/domain-graph-ui.png', alt: 'Descriptive original graph alt', table }
    const graph = parseTestContent(source)
    const html = question(startAttempt(createAttempt(graph), start), graph)
    assert.match(html, /src="\/figures\/domain-graph-ui.png"/)
    assert.match(html, /alt="Descriptive original graph alt"/)
    assert.doesNotMatch(html, /<table|graph-data|Read graph data as a table/)
  }
})

test('supplied graph tables render accessible captions and row/column headers; optional placement preserves prose/image ordering', () => {
  for (const placement of [undefined, 'before', 'after'] as const) {
    const source = fixtureSource('domain-placement-ui', [1])
    source.modules[0].questions[0].figure = {
      src: '/figures/domain-table-ui.png', alt: 'Original table image', placement,
      table: { caption: 'Supplied table caption', headers: ['Item', 'Value'], rows: [['Domain item', 7]] },
    }
    const graph = parseTestContent(source)
    const html = question(startAttempt(createAttempt(graph), start), graph)
    assert.match(html, /<caption>Supplied table caption<\/caption>/)
    assert.match(html, /scope="col">Item/)
    assert.match(html, /scope="row">Domain item/)
    const passageIndex = html.indexOf('<div class="passage-text"')
    const figureIndex = html.indexOf('<figure class="source-figure"')
    assert.ok(passageIndex >= 0 && figureIndex >= 0)
    assert.equal(figureIndex > passageIndex, placement === 'after')
  }
})

test('loading/error views keep the requested test selected and accessible without leaking another dataset or exposing Start', () => {
  for (const error of [null, 'Practice Test 4 could not be loaded. Check your connection and try again.']) {
    const html = renderToStaticMarkup(createElement(TestLoadingView, {
      selectedTest: entry, error, notice: null, saveState: 'saved',
      onShowTests: noop, onShowPractice: noop, onRetry: noop, onDismissNotice: noop, onRetrySaving: noop,
    }))
    assert.match(plain(html), /Practice Test 4/)
    assert.match(html, /aria-label="Practice navigation"/)
    assert.match(html, />Tests<\/button>/)
    assert.doesNotMatch(html, /Domain passage|Domain prompt|Domain option|Supplied explanation|role="timer"|<img|class="start-button"/)
    if (error) {
      assert.match(html, /role="alert"/)
      assert.match(plain(html), /Try again/)
    } else assert.match(html, /role="status"/)
  }
})

test('storage failures remain explicit and offer retry while the current question/answer stays in memory', () => {
  const attempt = answerQuestion(content, startAttempt(createAttempt(content), start), 'm1-q1', 'B')
  const html = workspace(attempt, content, SAVE_FAILURE_NOTICE, true)
  const text = plain(html)
  assert.match(html, /role="alert"/)
  assert.match(text, /Retry saving/)
  assert.match(text, /Not saved \/ keep this tab open/)
  assert.match(text, /Keep this tab open to retain your answers/)
  assert.match(html, /<input(?=[^>]*value="B")(?=[^>]*checked="")[^>]*>/)
})

test('submission requires an explicit confirmation surface with selected-test unanswered and marked counts; no score or explanation is shown yet', () => {
  let attempt = answerQuestion(content, startAttempt(createAttempt(content), start), 'm1-q1', 'B')
  attempt = markQuestion(content, attempt, 'm2-q1')
  const render = (value: Attempt) => renderToStaticMarkup(createElement(SubmitDialog, {
    content, attempt: value, testTitle: entry.title, onDismiss: noop, onReviewUnanswered: noop, onConfirm: noop,
  }))
  const html = render(attempt)
  const text = plain(html)
  assert.match(html, /<dialog/)
  assert.match(text, /Submit Practice Test 4\?/)
  assert.match(text, /1 of 7/)
  assert.match(text, /3 modules/)
  assert.match(text, /6 questions are unanswered/)
  assert.match(text, /1 question is marked for review/)
  assert.match(text, /Unanswered questions are recorded as skipped and do not count as correct/)
  assert.match(text, /Review unanswered/)
  assert.match(text, /Submit and see score/)
  assert.doesNotMatch(html, /Supplied explanation|Correct answer:|Domain passage|out of 7/)
  assert.equal(render(createAttempt(content)), '')
  assert.equal(render(pauseAttempt(attempt, start + 1_000)), '')
  assert.equal(render(submitAttempt(attempt, start + 1_000)), '')
})

test('fully answered submission and confirmed restart use selected counts and explain that other attempts are preserved', () => {
  let attempt = startAttempt(createAttempt(content), start)
  for (const item of content.questions) attempt = answerQuestion(content, attempt, item.id, 'A')
  const submit = renderToStaticMarkup(createElement(SubmitDialog, {
    content, attempt, testTitle: entry.title, onDismiss: noop, onReviewUnanswered: noop, onConfirm: noop,
  }))
  assert.match(plain(submit), /7 of 7/)
  assert.match(plain(submit), /Every question has an answer/)
  assert.match(plain(submit), /Keep working/)
  assert.doesNotMatch(plain(submit), /questions are unanswered/)
  const restart = renderToStaticMarkup(createElement(RestartDialog, {
    content, testTitle: entry.title, onDismiss: noop, onConfirm: noop,
  }))
  assert.match(plain(restart), /Practice Test 4/)
  assert.match(plain(restart), /same 7 questions/)
  assert.match(plain(restart), /All completed history and your other tests will be kept/)
  assert.match(plain(restart), /timer will begin only when you select Start test/)
  assert.match(plain(restart), /Keep current attempt/)
  assert.match(plain(restart), /Start new attempt/)
})

function realWorkspace(selectedTest: TestCatalogEntry, selected: TestContent, attempt: Attempt) {
  return renderToStaticMarkup(createElement(PracticeWorkspace, {
    selectedTest,
    content: selected,
    attempt,
    notice: null,
    saveState: 'saved',
    onShowTests: noop,
    onShowPractice: noop,
    onUpdateAttempt: () => true,
    onDismissNotice: noop,
    onRetrySaving: noop,
  }))
}

test('all real tests visibly identify the selected catalog title on introduction, active, paused, and results screens without rendering source titles', async () => {
  for (const entry of testCatalog) {
    const selected = await entry.load()
    const fresh = createAttempt(selected)
    const active = startAttempt(fresh, start)
    const paused = pauseAttempt(active, start + 1_000)
    const submitted = submitAttempt(active, start + 2_000)
    for (const attempt of [fresh, active, paused, submitted]) {
      const html = realWorkspace(entry, selected, attempt)
      const text = plain(html)
      assert.ok(html.includes(`<strong>${entry.title}</strong>`), entry.title)
      assert.match(html, /aria-label="Practice navigation"/)
      assert.doesNotMatch(html, /test-select|Choose test/)
      if (selected.test.title !== entry.title) assert.ok(!text.includes(selected.test.title), entry.title)
      assert.doesNotMatch(text, /SAT Practice Test|No time limit\. Work at your pace|source PDF/i)
      if (attempt.startedAt === null) assert.doesNotMatch(html, /answer-options|question-prompt|role="timer"|module-select|<img/)
      if (attempt.pausedAt !== null) assert.doesNotMatch(html, /answer-options|question-prompt|module-select|question-jump|page-navigation|<img/)
      if (attempt.submittedAt !== null) assert.ok(text.includes(`out of ${selected.questions.length}`), entry.title)
    }
  }
})

test('all real graphs and source tables retain exact image/alt and only render supplied accessible table data', async () => {
  let withTable = 0
  let withoutTable = 0
  for (const entry of testCatalog) {
    const selected = await entry.load()
    for (const item of selected.questions) {
      if (!item.figure) continue
      const attempt = navigateTo(selected, startAttempt(createAttempt(selected), start), item.id)
      const html = question(attempt, selected)
      const expectedImage = renderToStaticMarkup(createElement('img', { src: item.figure.src, alt: item.figure.alt })).match(/<img\b[^>]*>/)?.[0]
      assert.ok(expectedImage)
      assert.ok(html.includes(expectedImage), `${entry.title}: ${item.id}`)
      assert.equal(html.includes('class="graph-data"'), Boolean(item.figure.table), `${entry.title}: ${item.id}`)
      if (item.figure.table) {
        withTable += 1
        const caption = renderToStaticMarkup(createElement('caption', null, item.figure.table.caption))
        assert.ok(html.includes(caption), `${entry.title}: ${item.id}`)
        assert.match(html, /scope="col"/)
        assert.match(html, /scope="row"/)
      } else {
        withoutTable += 1
        assert.doesNotMatch(html, /Read graph data as a table/)
      }
      assert.equal(question(pauseAttempt(attempt, start + 1_000), selected), '')
    }
  }
  assert.ok(withTable > 0)
  assert.ok(withoutTable > 0)
})
