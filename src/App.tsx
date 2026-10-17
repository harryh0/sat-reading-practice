import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  answerQuestion, createAttempt, elapsedMilliseconds, formatElapsed, markQuestion,
  navigateTo, pauseAttempt, questionStatus, resumeAttempt, startAttempt, submitAttempt, summarize,
} from './attempt.ts'
import type { Attempt } from './attempt.ts'
import type { TestCatalogEntry } from './catalog.ts'
import { figureUrl, getQuestion, isChoiceId } from './content.ts'
import type { Question, TestContent } from './content.ts'
import type { SaveState } from './practiceSession.ts'
import { usePracticeSession } from './usePracticeSession.ts'

type IconName = 'book' | 'bookmark' | 'left' | 'right' | 'down' | 'grid' | 'check' | 'close' | 'clock' | 'info' | 'pause' | 'play'
const iconPaths: Record<IconName, string> = {
  book: 'M3 4.5c3.5-1.5 6.5-1 9 1 2.5-2 5.5-2.5 9-1v15c-3.5-1.5-6.5-1-9 1-2.5-2-5.5-2.5-9-1zM12 5.5v15',
  bookmark: 'M6 3h12v18l-6-4-6 4z',
  left: 'm14.5 5-7 7 7 7',
  right: 'm9.5 5 7 7-7 7',
  down: 'm5 9 7 7 7-7',
  grid: 'M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h6v6h-6z',
  check: 'm5 12 4 4L19 6',
  close: 'm6 6 12 12M6 18 18 6',
  clock: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0M12 6v6l4 2',
  info: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0M12 11v6M12 7v.1',
  pause: 'M6 4h3v16H6zM15 4h3v16h-3z',
  play: 'm8 4 12 8-12 8z',
}
function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return (
    <svg className={`icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={iconPaths[name]} />
    </svg>
  )
}

function PracticeHeader({ selectedTest, catalog, onSelectTest, children }: {
  selectedTest: TestCatalogEntry; catalog: readonly TestCatalogEntry[]; onSelectTest: (id: string) => void; children?: ReactNode
}) {
  return (
    <header className="top-bar">
      <div className="brand"><span className="brand-icon"><Icon name="book" /></span><div><strong>{selectedTest.title}</strong><span>READING AND WRITING</span></div></div>
      <div className="top-controls">
        <div className="test-control">
          <label htmlFor="test-select">Choose test</label>
          <div className="select-wrap"><select id="test-select" value={selectedTest.id} onChange={(event) => onSelectTest(event.target.value)}>
            {catalog.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}
          </select><Icon name="down" /></div>
        </div>
        {children && <div className="top-actions">{children}</div>}
      </div>
    </header>
  )
}

function StorageNotice({ notice, saveState, onDismiss, onRetry }: {
  notice: string | null; saveState: SaveState; onDismiss: () => void; onRetry: () => void
}) {
  if (!notice) return null
  return (
    <div className="storage-notice" role="alert">
      <Icon name="info" /><span>{notice}</span>
      {saveState === 'failed' && <button className="text-button" onClick={onRetry}>Retry saving</button>}
      <button className="icon-button" onClick={onDismiss} aria-label="Dismiss saved-progress notice"><Icon name="close" /></button>
    </div>
  )
}

function Dialog({ title, children, onDismiss, wide = false }: {
  title: string; children: ReactNode; onDismiss: () => void; wide?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    dialog.showModal()
    return () => dialog.close()
  }, [])

  return (
    <dialog
      ref={ref}
      className={`dialog ${wide ? 'dialog-wide' : ''}`}
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); onDismiss() }}
      onClick={(event) => { if (event.target === event.currentTarget) onDismiss() }}
    >
      <div className="dialog-inner">
        <div className="dialog-heading">
          <h2 id={titleId}>{title}</h2>
          <button className="icon-button" aria-label="Close dialog" onClick={onDismiss}><Icon name="close" /></button>
        </div>
        {children}
      </div>
    </dialog>
  )
}

function Timer({ attempt, onToggle }: { attempt: Attempt; onToggle: () => void }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (attempt.startedAt === null || attempt.submittedAt !== null || attempt.pausedAt !== null) return
    const interval = window.setInterval(() => setTick((tick) => tick + 1), 1_000)
    return () => window.clearInterval(interval)
  }, [attempt.startedAt, attempt.submittedAt, attempt.pausedAt])

  return (
    <div className="timer">
      <span className="timer-label">{attempt.submittedAt !== null ? 'Time spent' : attempt.pausedAt !== null ? 'Timer paused' : 'Elapsed time'}</span>
      <div className="timer-value" role="timer" aria-label="Elapsed time" aria-live="off">
        {attempt.timerHidden ? <span className="hidden-timer">Timer hidden</span> : formatElapsed(elapsedMilliseconds(attempt))}
      </div>
      <button className="text-button timer-toggle" onClick={onToggle} aria-pressed={attempt.timerHidden}>
        {attempt.timerHidden ? 'Show timer' : 'Hide timer'}
      </button>
    </div>
  )
}

function Introduction({ content, testTitle, onStart }: { content: TestContent; testTitle: string; onStart: () => void }) {
  const { questions, modules } = content
  return (
    <main className="intro-content" id="main-content" tabIndex={-1} aria-labelledby="intro-heading">
      <section className="intro-card">
        <span className="intro-eyebrow"><Icon name="book" />{testTitle}</span>
        <h1 id="intro-heading" tabIndex={-1}>Reading and Writing Practice</h1>
        <p className="intro-description">Read each passage, choose the best answer, and move freely between questions. When you finish, review your score and answer explanations.</p>
        <div className="intro-facts">
          <div><strong>{questions.length}</strong><span>questions</span></div>
          <div><strong>{modules.length}</strong><span>{modules.length === 1 ? 'module' : 'modules'}</span></div>
        </div>
        <p className="intro-module-counts">{modules.map((module) => `Module ${module.number}: ${module.questions.length} ${module.questions.length === 1 ? 'question' : 'questions'}`).join(' / ')}</p>
        <p className="intro-guidance">Mark questions to revisit, or pause whenever you need a break.</p>
        <button className="button button-primary start-button" onClick={onStart}>Start test<Icon name="right" /></button>
        <p className="intro-timer-note">Your timer begins only when you select Start test.</p>
      </section>
    </main>
  )
}

function PausedView({ testTitle, onResume }: { testTitle: string; onResume: () => void }) {
  return (
    <main className="paused-content" id="main-content" tabIndex={-1} aria-labelledby="paused-heading">
      <section className="paused-card">
        <span className="paused-icon"><Icon name="pause" /></span>
        <p className="test-identity">{testTitle}</p>
        <h2 id="paused-heading" tabIndex={-1}>Practice paused</h2>
        <p role="status">The timer is stopped and your questions are hidden.</p>
        <p className="muted">Resume to return to the same question and selections.</p>
        <button className="button button-primary" onClick={onResume}><Icon name="play" />Resume practice</button>
      </section>
    </main>
  )
}

function Figure({ figure }: { figure: NonNullable<Question['figure']> }) {
  return (
    <figure className="source-figure">
      <img src={figureUrl(figure.src, import.meta.env?.BASE_URL ?? '/')} alt={figure.alt} />
      {figure.table && <details className="graph-data">
        <summary>Read graph data as a table</summary>
        <div className="table-scroll">
          <table>
            <caption>{figure.table.caption}</caption>
            <thead><tr>{figure.table.headers.map((header) => <th key={header} scope="col">{header}</th>)}</tr></thead>
            <tbody>{figure.table.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>{row.map((cell, index) => index === 0 ? <th key={index} scope="row">{cell}</th> : <td key={index}>{cell}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>
      </details>}
    </figure>
  )
}

export function QuestionView({ content, questionId, attempt, saveState, onAnswer, onMark }: {
  content: TestContent; questionId: string; attempt: Attempt; saveState: SaveState; onAnswer: (answer: string | null) => void; onMark: () => void
}) {
  if (attempt.startedAt === null || attempt.pausedAt !== null) return null
  const question = getQuestion(content, questionId)
  const submitted = attempt.submittedAt !== null
  const selected = attempt.answers[question.id]
  const marked = attempt.marked.includes(question.id)
  const status = questionStatus(content, attempt, question.id)

  return (
    <main className="exam-content" id="main-content" tabIndex={-1} aria-label={`Module ${question.module}, question ${question.number}`}>
      <section className="passage-pane" aria-label="Reading passage">
        <div className="passage-inner">
          <div className="pane-eyebrow">Read the passage and choose the best answer.</div>
          {question.figure && question.figure.placement !== 'after' && <Figure figure={question.figure} />}
          <div className="passage-text" dangerouslySetInnerHTML={{ __html: question.passageHtml }} />
          {question.figure?.placement === 'after' && <Figure figure={question.figure} />}
        </div>
      </section>
      <section className="question-pane" aria-label="Question and answers">
        <div className="question-inner">
          <div className="question-strip">
            <h2 id="question-heading" tabIndex={-1}><span className="sr-only">Module {question.module}, question </span>{question.number}</h2>
            <span className="question-strip-label">Choose one answer</span>
            <button
              className={`mark-button ${marked ? 'is-marked' : ''}`}
              onClick={onMark}
              aria-pressed={marked}
              disabled={submitted}
              title={submitted ? 'Review marks are saved from your attempt' : undefined}
            >
              <Icon name="bookmark" />
              <span>{marked ? 'Marked for review' : 'Mark for review'}</span>
            </button>
          </div>
          <div className="question-prompt" id="question-prompt" dangerouslySetInnerHTML={{ __html: question.promptHtml }} />
          {submitted && (
            <div className={`review-status status-${status}`} role="status">
              <Icon name={status === 'correct' ? 'check' : 'info'} />
              <span><strong>{status === 'correct' ? 'Correct.' : status === 'unanswered' ? 'Not answered.' : 'Incorrect.'}</strong>{' '}
                {selected ? `Your answer: ${selected}. ` : ''}Correct answer: {question.correctAnswer}.
              </span>
            </div>
          )}
          <fieldset className="answer-options" aria-describedby="question-prompt">
            <legend className="sr-only">Answer choices for module {question.module}, question {question.number}</legend>
            {question.choices.map((choice) => {
              const chosen = selected === choice.id
              const correct = submitted && choice.id === question.correctAnswer
              const wrong = submitted && chosen && !correct
              return (
                <label key={choice.id} className={`choice ${chosen ? 'is-selected' : ''} ${correct ? 'is-correct' : ''} ${wrong ? 'is-incorrect' : ''}`}>
                  <input type="radio" name={`answer-${attempt.testId}-${question.id}`} value={choice.id} checked={chosen} disabled={submitted} onChange={() => onAnswer(choice.id)} />
                  <span className="choice-letter">{choice.id}</span>
                  <span className="choice-body">
                    <span className="choice-copy" dangerouslySetInnerHTML={{ __html: choice.html }} />
                    {submitted && (correct || chosen) && <span className="choice-state">{correct ? 'Correct answer' : 'Your answer'}{correct && chosen ? ' / Your answer' : ''}</span>}
                  </span>
                  {correct && <Icon name="check" className="choice-icon" />}
                  {wrong && <Icon name="close" className="choice-icon" />}
                </label>
              )
            })}
          </fieldset>
          {!submitted && (
            <div className="answer-actions">
              <span>{saveState === 'failed' ? 'Keep this tab open to retain your answers.' : 'Answers are saved as you go.'}</span>
              <button className="text-button" disabled={!selected} onClick={() => onAnswer(null)}>Clear answer</button>
            </div>
          )}
          {submitted && (
            <section className="explanation" aria-labelledby="explanation-heading">
              <div className="explanation-heading"><Icon name="book" /><h3 id="explanation-heading">Why {question.correctAnswer} is correct</h3></div>
              <div className="explanation-text" dangerouslySetInnerHTML={{ __html: question.explanationHtml }} />
            </section>
          )}
        </div>
      </section>
    </main>
  )
}

type JumpFilter = 'all' | 'unanswered' | 'marked' | 'incorrect'

function QuestionGrid({ content, items, attempt, onNavigate }: { content: TestContent; items: readonly Question[]; attempt: Attempt; onNavigate: (id: string) => void }) {
  return (
    <div className="question-grid">
      {items.map((question) => {
        const status = questionStatus(content, attempt, question.id)
        const marked = attempt.marked.includes(question.id)
        const current = attempt.currentQuestionId === question.id
        return (
          <button
            key={question.id}
            className={`question-tile tile-${status} ${current ? 'is-current' : ''}`}
            aria-label={`Module ${question.module}, question ${question.number}, ${status}${marked ? ', marked for review' : ''}${current ? ', current question' : ''}`}
            aria-current={current ? 'step' : undefined}
            onClick={() => onNavigate(question.id)}
          >
            {question.number}
            {marked && <Icon name="bookmark" className="tile-bookmark" />}
            {status === 'correct' && <Icon name="check" className="tile-status" />}
            {status === 'incorrect' && <Icon name="close" className="tile-status" />}
          </button>
        )
      })}
    </div>
  )
}

function Navigator({ content, attempt, initialModule, initialFilter, onNavigate, onDismiss, onSubmit }: {
  content: TestContent; attempt: Attempt; initialModule: number; initialFilter: JumpFilter; onNavigate: (id: string) => void; onDismiss: () => void; onSubmit: () => void
}) {
  const { modules } = content
  const [moduleNumber, setModuleNumber] = useState(initialModule)
  const [filter, setFilter] = useState(initialFilter)
  const module = modules.find((item) => item.number === moduleNumber)
  if (!module) throw new Error('The selected module does not exist.')
  const submitted = attempt.submittedAt !== null
  const answered = module.questions.filter((question) => attempt.answers[question.id] !== undefined).length
  const filtered = module.questions.filter((question) => {
    if (filter === 'unanswered') return attempt.answers[question.id] === undefined
    if (filter === 'marked') return attempt.marked.includes(question.id)
    if (filter === 'incorrect') return questionStatus(content, attempt, question.id) === 'incorrect'
    return true
  })
  const filters: { id: JumpFilter; label: string }[] = [
    { id: 'all', label: 'All questions' },
    { id: 'unanswered', label: 'Unanswered' },
    { id: 'marked', label: 'Marked' },
    ...(submitted ? [{ id: 'incorrect' as const, label: 'Incorrect' }] : []),
  ]

  return (
    <Dialog title={submitted ? 'Review questions' : 'Question navigator'} onDismiss={onDismiss} wide>
      <p className="dialog-intro">Jump to any question in this Reading and Writing section.</p>
      <div className="module-switch" aria-label="Choose a module">
        {modules.map((item) => <button key={item.number} aria-pressed={item.number === moduleNumber} onClick={() => setModuleNumber(item.number)}>Module {item.number}<span>{item.questions.length} questions</span></button>)}
      </div>
      <div className="navigator-meta"><h3>Module {moduleNumber}</h3><span>{answered} of {module.questions.length} answered</span></div>
      <div className="filter-row" aria-label="Filter questions">
        {filters.map((item) => <button key={item.id} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}</button>)}
      </div>
      <QuestionGrid content={content} items={filtered} attempt={attempt} onNavigate={onNavigate} />
      {filtered.length === 0 && <p className="empty-filter">No {filter === 'marked' ? 'marked' : filter} questions in this module.</p>}
      <div className="grid-legend">
        <span><i className={submitted ? 'legend-correct' : 'legend-answered'} />{submitted ? 'Correct' : 'Answered'}</span>
        <span><i className={submitted ? 'legend-incorrect' : 'legend-unanswered'} />{submitted ? 'Incorrect' : 'Unanswered'}</span>
        <span><Icon name="bookmark" />Marked for review</span>
      </div>
      <div className="dialog-actions">
        <button className="button button-secondary" onClick={onDismiss}>Back to question</button>
        {!submitted && <button className="button button-primary" onClick={onSubmit}>Submit section</button>}
      </div>
    </Dialog>
  )
}

function Results({ content, testTitle, attempt, onNavigate, onRestart, onReview }: {
  content: TestContent; testTitle: string; attempt: Attempt; onNavigate: (id: string) => void; onRestart: () => void; onReview: () => void
}) {
  const summary = summarize(content, attempt)
  return (
    <main className="results-main" id="main-content">
      <div className="results-container">
        <section className="score-card" aria-labelledby="results-heading">
          <span className="completion-label"><Icon name="check" />Section complete</span>
          <p className="test-identity">{testTitle}</p>
          <h1 id="results-heading" tabIndex={-1}>Reading and Writing</h1>
          <div className="score"><strong>{summary.correct}</strong><span>out of {summary.total}</span></div>
          <p className="score-caption">questions correct</p>
          <div className="score-details">
            <span><Icon name="clock" />{formatElapsed(elapsedMilliseconds(attempt))} elapsed</span>
            <span>{summary.answered} answered</span>
            <span>{summary.unanswered} unanswered</span>
          </div>
          <div className="score-actions">
            <button className="button button-primary" onClick={onReview}>Review your answers<Icon name="right" /></button>
            <button className="button button-secondary" onClick={onRestart}>Start new attempt</button>
          </div>
        </section>
        <div className="results-intro"><h2>Your question-by-question review</h2><p>Select a question to review your answer and see the explanation.</p></div>
        <div className="module-results">
          {content.modules.map((module) => {
            const score = summary.moduleScores.find((item) => item.number === module.number)
            if (!score) throw new Error('The module score is missing.')
            return (
              <section className="module-result" key={module.number} aria-labelledby={`result-module-${module.number}`}>
                <div className="module-result-heading"><h3 id={`result-module-${module.number}`}>Module {module.number}</h3><strong>{score.correct} <span>/ {score.total} correct</span></strong></div>
                <QuestionGrid content={content} items={module.questions} attempt={attempt} onNavigate={onNavigate} />
              </section>
            )
          })}
        </div>
        <div className="grid-legend results-legend"><span><i className="legend-correct" />Correct</span><span><i className="legend-incorrect" />Incorrect</span><span><i className="legend-unanswered" />Unanswered</span><span><Icon name="bookmark" />Marked for review</span></div>
      </div>
    </main>
  )
}

export function SubmitDialog({ content, attempt, testTitle, onDismiss, onReviewUnanswered, onConfirm }: {
  content: TestContent; attempt: Attempt; testTitle: string; onDismiss: () => void; onReviewUnanswered: () => void; onConfirm: () => void
}) {
  if (attempt.startedAt === null || attempt.pausedAt !== null || attempt.submittedAt !== null) return null
  const summary = summarize(content, attempt)
  return (
    <Dialog title={`Submit ${testTitle}?`} onDismiss={onDismiss}>
      <p className="dialog-intro">You have answered <strong>{summary.answered} of {summary.total}</strong> questions across {content.modules.length} {content.modules.length === 1 ? 'module' : 'modules'} in {testTitle}.</p>
      {summary.unanswered > 0 ? <div className="unanswered-notice"><Icon name="info" /><div><strong>{summary.unanswered} {summary.unanswered === 1 ? 'question is' : 'questions are'} unanswered.</strong><p>Unanswered questions count as incorrect. You can go back and finish them, or submit now.</p></div></div> : <div className="all-answered"><Icon name="check" />Every question has an answer.</div>}
      {attempt.marked.length > 0 && <p className="muted">{attempt.marked.length} {attempt.marked.length === 1 ? 'question is' : 'questions are'} marked for review.</p>}
      <p>Submitting stops the timer and locks your answers. Your score and the answer explanations will then be available.</p>
      <div className="dialog-actions">
        <button className="button button-secondary" onClick={summary.unanswered ? onReviewUnanswered : onDismiss}>{summary.unanswered ? 'Review unanswered' : 'Keep working'}</button>
        <button className="button button-primary" onClick={onConfirm}>Submit and see score</button>
      </div>
    </Dialog>
  )
}

export function RestartDialog({ content, testTitle, onDismiss, onConfirm }: {
  content: TestContent; testTitle: string; onDismiss: () => void; onConfirm: () => void
}) {
  return (
    <Dialog title="Start a new attempt?" onDismiss={onDismiss}>
      <p>This will clear the saved answers, review marks, score, and elapsed time for {testTitle} on this device. Your other tests will not be changed.</p>
      <p>You will return to the introduction with the same {content.questions.length} questions. The timer will begin only when you select Start test.</p>
      <div className="dialog-actions"><button className="button button-secondary" onClick={onDismiss}>Keep current attempt</button><button className="button button-primary" onClick={onConfirm}>Start new attempt</button></div>
    </Dialog>
  )
}

export interface PracticeWorkspaceProps {
  selectedTest: TestCatalogEntry
  catalog: readonly TestCatalogEntry[]
  content: TestContent
  attempt: Attempt
  notice: string | null
  saveState: SaveState
  onSelectTest: (id: string) => void
  onUpdateAttempt: (update: (attempt: Attempt) => Attempt) => void
  onDismissNotice: () => void
  onRetrySaving: () => void
}

export function PracticeWorkspace({
  selectedTest, catalog, content, attempt, notice, saveState, onSelectTest, onUpdateAttempt, onDismissNotice, onRetrySaving,
}: PracticeWorkspaceProps) {
  const { questions, modules } = content
  const [screen, setScreen] = useState<'exam' | 'results'>(attempt.submittedAt === null ? 'exam' : 'results')
  const [modal, setModal] = useState<'navigator' | 'submit' | 'restart' | 'directions' | null>(null)
  const [jumpFilter, setJumpFilter] = useState<JumpFilter>('all')
  const [navigatorModule, setNavigatorModule] = useState(getQuestion(content, attempt.currentQuestionId).module)
  const shouldFocus = useRef(false)
  const question = getQuestion(content, attempt.currentQuestionId)
  const currentIndex = questions.findIndex((item) => item.id === question.id)
  const unstarted = attempt.startedAt === null
  const submitted = attempt.submittedAt !== null
  const paused = attempt.pausedAt !== null
  const summary = summarize(content, attempt)
  const previous = questions[currentIndex - 1]
  const next = questions[currentIndex + 1]

  useEffect(() => {
    if (!shouldFocus.current) return
    const mobileQuestion = !unstarted && screen === 'exam' && !paused && window.matchMedia('(max-width: 820px)').matches
    const target = document.getElementById(unstarted ? 'intro-heading' : screen === 'results' ? 'results-heading' : paused ? 'paused-heading' : mobileQuestion ? 'main-content' : 'question-heading')
    target?.focus({ preventScroll: mobileQuestion })
    if (mobileQuestion) target?.scrollIntoView({ block: 'start' })
    shouldFocus.current = false
  }, [attempt.currentQuestionId, unstarted, paused, screen])

  function beginTest() {
    shouldFocus.current = true
    onUpdateAttempt((current) => startAttempt(current))
    setScreen('exam')
  }

  function goTo(id: string) {
    shouldFocus.current = true
    onUpdateAttempt((current) => navigateTo(content, current, id))
    setScreen('exam')
    setModal(null)
  }

  function openNavigator(filter: JumpFilter = 'all') {
    const target = filter === 'unanswered' ? questions.find((item) => attempt.answers[item.id] === undefined) ?? question : question
    setNavigatorModule(target.module)
    setJumpFilter(filter)
    setModal('navigator')
  }

  function selectAnswer(answer: string | null) {
    if (answer !== null && !isChoiceId(answer)) throw new Error('The selected answer is not a valid option.')
    onUpdateAttempt((current) => answerQuestion(content, current, question.id, answer))
  }

  function finish() {
    shouldFocus.current = true
    onUpdateAttempt((current) => submitAttempt(current))
    setScreen('results')
    setModal(null)
  }

  function togglePause() {
    shouldFocus.current = true
    onUpdateAttempt((current) => current.pausedAt === null ? pauseAttempt(current) : resumeAttempt(current))
    setModal(null)
  }

  function restart() {
    shouldFocus.current = true
    onUpdateAttempt(() => createAttempt(content))
    setScreen('exam')
    setModal(null)
  }

  return (
    <div className={`app-shell ${unstarted ? 'is-intro' : screen === 'results' ? 'is-results' : ''} ${paused ? 'is-paused' : ''} ${notice ? 'has-notice' : ''}`}>
      <a className="skip-link" href="#main-content">Skip to test content</a>
      <PracticeHeader selectedTest={selectedTest} catalog={catalog} onSelectTest={onSelectTest}>
          <button className="directions-button" aria-label="Directions" onClick={() => setModal('directions')}><Icon name="info" /><span>Directions</span></button>
          {!unstarted && <>
            {submitted && screen === 'exam' && <button className="button button-secondary" onClick={() => { shouldFocus.current = true; setScreen('results') }}>View score</button>}
            <button className="button button-teal" disabled={paused} onClick={() => setModal(submitted ? 'restart' : 'submit')}>{submitted ? 'New attempt' : 'Submit section'}</button>
            {!submitted && <button className="button button-secondary pause-control" aria-label={paused ? 'Resume practice' : 'Pause practice'} aria-controls="main-content" onClick={togglePause}><Icon name={paused ? 'play' : 'pause'} /><span>{paused ? 'Resume' : 'Pause'}</span></button>}
          </>}
      </PracticeHeader>
      <StorageNotice notice={notice} saveState={saveState} onDismiss={onDismissNotice} onRetry={onRetrySaving} />
      {unstarted ? <Introduction content={content} testTitle={selectedTest.title} onStart={beginTest} /> : screen === 'exam' ? (
        <>
          <section className="section-bar" aria-label="Section information">
            <div className="section-heading"><span className={`practice-label ${paused ? 'is-paused' : ''}`}><i />{submitted ? 'Answer review' : paused ? 'Paused' : 'Untimed practice'}</span><h1>Reading and Writing</h1></div>
            <Timer attempt={attempt} onToggle={() => onUpdateAttempt((current) => ({ ...current, timerHidden: !current.timerHidden }))} />
            {!paused && <div className="module-control">
              <label htmlFor="module-select">CURRENT MODULE</label>
              <div className="select-wrap"><select id="module-select" value={question.module} disabled={paused} onChange={(event) => {
                const module = modules.find((item) => item.number === Number(event.target.value))
                if (!module) throw new Error('The selected module does not exist.')
                goTo(module.questions[0].id)
              }}>{modules.map((module) => <option value={module.number} key={module.number}>Module {module.number} of {modules.length}</option>)}</select><Icon name="down" /></div>
              {submitted && <span>Submitted answers are read-only</span>}
            </div>}
          </section>
          {paused ? <PausedView testTitle={selectedTest.title} onResume={togglePause} /> : <QuestionView key={`${content.test.id}:${question.id}`} content={content} questionId={question.id} attempt={attempt} saveState={saveState} onAnswer={selectAnswer} onMark={() => onUpdateAttempt((current) => markQuestion(content, current, question.id))} />}
          {!paused && <footer className="exam-footer">
            <div className="bottom-bar">
              <div className={`saved-progress ${saveState === 'failed' ? 'is-unsaved' : ''}`}><span><strong>{summary.answered}</strong> of {summary.total} answered</span><progress value={summary.answered} max={summary.total} aria-label="Questions answered" /><small>{saveState === 'failed' ? 'Not saved / keep this tab open' : saveState === 'pending' ? 'Saving progress...' : submitted ? 'Completed attempt saved on this device' : 'Progress saved on this device'}</small></div>
              <button className="question-jump" disabled={paused} onClick={() => openNavigator()} aria-haspopup="dialog"><Icon name="grid" /><span>Question <strong>{question.number}</strong> of {modules.find((module) => module.number === question.module)?.questions.length}</span><Icon name="down" /></button>
              <nav className="page-navigation" aria-label="Question navigation">
                <button className="button button-prev" disabled={paused || !previous} onClick={() => { if (previous) goTo(previous.id) }}><Icon name="left" /><span>Prev</span></button>
                <button className="button button-primary button-next" disabled={paused} onClick={() => {
                  if (next) goTo(next.id)
                  else if (submitted) { shouldFocus.current = true; setScreen('results') }
                  else setModal('submit')
                }}><span>{!next ? submitted ? 'View score' : 'Review & submit' : next.module !== question.module ? 'Next module' : 'Next'}</span><Icon name="right" /></button>
              </nav>
            </div>
          </footer>}
        </>
      ) : (
        <Results content={content} testTitle={selectedTest.title} attempt={attempt} onNavigate={goTo} onRestart={() => setModal('restart')} onReview={() => goTo(questions[0].id)} />
      )}
      {modal === 'navigator' && !unstarted && !paused && <Navigator content={content} attempt={attempt} initialModule={navigatorModule} initialFilter={jumpFilter} onNavigate={goTo} onDismiss={() => setModal(null)} onSubmit={() => setModal('submit')} />}
      {modal === 'submit' && <SubmitDialog content={content} attempt={attempt} testTitle={selectedTest.title} onDismiss={() => setModal(null)} onReviewUnanswered={() => openNavigator('unanswered')} onConfirm={finish} />}
      {modal === 'restart' && !unstarted && !paused && <RestartDialog content={content} testTitle={selectedTest.title} onDismiss={() => setModal(null)} onConfirm={restart} />}
      {modal === 'directions' && (
        <Dialog title="Reading and Writing directions" onDismiss={() => setModal(null)} wide>
          <div className="directions-content">
            <p>Select <strong>Start test</strong> on the introduction screen to begin. The first question and elapsed timer appear when you start.</p>
            <p>Read each passage and question carefully, then choose the single best answer from the four choices. A passage may include a graph or a set of notes.</p>
            <div className="directions-facts"><div><strong>{questions.length} questions</strong><span>{modules.length} {modules.length === 1 ? 'module' : 'modules'} / {modules.map((module) => `${module.questions.length} in Module ${module.number}`).join(', ')}</span></div><div><strong>Elapsed timer</strong><span>Tracks time until you submit</span></div></div>
            <p>Use <strong>Prev</strong> and <strong>Next</strong> to move through the section, or open the question navigator to jump directly to a question. You can move freely between modules and mark questions to revisit.</p>
            <p>Use <strong>Pause</strong> to stop the timer and hide the passage, question, and answers. Resume to return to the same question and selections. Your paused state is also saved when you refresh.</p>
            <p>Your answers, current question, and review marks are saved in this browser on this device. While running, the elapsed timer continues across refreshes and while you are away, until you pause or submit. Hiding the timer does not pause it.</p>
            <p>Choose a test from the header to keep a separate attempt for each test. Switching tests pauses your current attempt; resume it when you return.</p>
            <p>Submit the whole section when you are ready. Unanswered questions count as incorrect. After submission, you will receive an <strong>X out of {questions.length}</strong> score and can review every question with an explanation of the correct answer.</p>
          </div>
          <div className="dialog-actions"><button className="button button-primary" onClick={() => setModal(null)}>Got it</button></div>
        </Dialog>
      )}
    </div>
  )
}

export function TestLoadingView({ selectedTest, catalog, error, notice, saveState, onSelectTest, onRetry, onDismissNotice, onRetrySaving }: {
  selectedTest: TestCatalogEntry; catalog: readonly TestCatalogEntry[]; error: string | null; notice: string | null; saveState: SaveState
  onSelectTest: (id: string) => void; onRetry: () => void; onDismissNotice: () => void; onRetrySaving: () => void
}) {
  return (
    <div className={`app-shell is-intro ${notice ? 'has-notice' : ''}`}>
      <a className="skip-link" href="#main-content">Skip to test content</a>
      <PracticeHeader selectedTest={selectedTest} catalog={catalog} onSelectTest={onSelectTest} />
      <StorageNotice notice={notice} saveState={saveState} onDismiss={onDismissNotice} onRetry={onRetrySaving} />
      <main className="intro-content" id="main-content" aria-busy={!error}>
        <section className="intro-card load-card">
          <span className="intro-eyebrow"><Icon name="book" />{selectedTest.title}</span>
          <h1>{error ? 'Test unavailable' : 'Loading your test'}</h1>
          <p className="intro-description" role={error ? 'alert' : 'status'}>{error ?? `Loading ${selectedTest.title}. Your test will not start until you select Start test.`}</p>
          {error && <button className="button button-primary" onClick={onRetry}>Try again</button>}
        </section>
      </main>
    </div>
  )
}

export default function App() {
  const { session, snapshot } = usePracticeSession()
  const selectorFocusTarget = useRef<string | null>(null)
  useEffect(() => {
    if (snapshot.status === 'loading' || selectorFocusTarget.current !== snapshot.selectedTest.id) return
    selectorFocusTarget.current = null
    // Async selection remounts the header; keep keyboard navigation on its replacement.
    if (document.activeElement === document.body || document.activeElement?.id === 'test-select') {
      document.getElementById('test-select')?.focus()
    }
  }, [snapshot.selectedTest.id, snapshot.status])
  const common = {
    selectedTest: snapshot.selectedTest,
    catalog: session.catalog,
    notice: snapshot.notice,
    saveState: snapshot.saveState,
    onSelectTest: (id: string) => {
      selectorFocusTarget.current = document.activeElement?.id === 'test-select' ? id : null
      void session.selectTest(id)
    },
    onDismissNotice: session.dismissNotice,
    onRetrySaving: session.retrySaving,
  }
  if (snapshot.status === 'ready' && snapshot.active) {
    return (
      <PracticeWorkspace
        key={snapshot.selectedTest.id}
        {...common}
        content={snapshot.active.content}
        attempt={snapshot.active.attempt}
        onUpdateAttempt={(update) => session.updateAttempt(snapshot.selectedTest.id, update)}
      />
    )
  }
  return <TestLoadingView {...common} error={snapshot.error} onRetry={() => {
    // Browsers cache failed module imports; reload only after all progress is safely saved.
    if (snapshot.saveState === 'saved') window.location.reload()
    else void session.loadSelected()
  }} />
}
