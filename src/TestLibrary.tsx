import type { CompletedResult } from './history.ts'
import type { LibraryTest } from './practiceSession.ts'

export function ResultCounts({ right, wrong, skipped }: Pick<CompletedResult, 'right' | 'wrong' | 'skipped'>) {
  return (
    <dl className="result-counts">
      <div className="result-right"><dt>Right</dt><dd>{right}</dd></div>
      <div className="result-wrong"><dt>Wrong</dt><dd>{wrong}</dd></div>
      <div className="result-skipped"><dt>Skipped</dt><dd>{skipped}</dd></div>
    </dl>
  )
}

const phaseLabels = {
  'not-started': 'Not started',
  'in-progress': 'In progress',
  paused: 'Paused',
  completed: 'Completed',
}

function completionDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' }).format(timestamp)
}

export function TestLibrary({ items, selectedTestId, onOpenTest, onRetry }: {
  items: readonly LibraryTest[]
  selectedTestId: string
  onOpenTest: (id: string, resume: boolean) => void
  onRetry: () => void
}) {
  return (
    <main className="tests-content" id="main-content" tabIndex={-1} aria-labelledby="tests-heading">
      <div className="tests-container">
        <div className="tests-intro">
          <span className="library-eyebrow">Your practice library</span>
          <h1 id="tests-heading" tabIndex={-1}>Practice tests</h1>
          <p>Choose a test, continue where you left off, or see every saved completion.</p>
        </div>
        <div className="tests-grid">
          {items.map((item) => {
            const { entry, progress } = item
            const completed = item.history.attempts
            const resume = progress?.phase === 'paused' || progress?.phase === 'in-progress'
            const action = progress?.phase === 'completed' ? 'Review results' : resume ? 'Resume' : 'Start test'
            return (
              <section className={`test-card${entry.id === selectedTestId ? ' is-selected' : ''}`} key={entry.id} id={`library-test-${entry.number}`} aria-labelledby={`test-title-${entry.number}`}>
                <div className="test-card-heading">
                  <div><span className="test-card-section">Reading and Writing</span><h2 id={`test-title-${entry.number}`}>{entry.title}</h2></div>
                  <div className="test-card-status">
                    {entry.id === selectedTestId && <span className="selected-test-label">Selected</span>}
                    {progress && <span className={`test-phase phase-${progress.phase}`}>{phaseLabels[progress.phase]}</span>}
                  </div>
                </div>
                {item.status === 'loading' ? <p className="library-loading" role="status">Loading saved progress...</p> : item.error ? (
                  <div className="library-error"><p role="alert">{item.error}</p><button className="text-button" onClick={onRetry}>Try again</button></div>
                ) : progress && (
                  <>
                    <p className="test-progress">Current attempt: <strong>{phaseLabels[progress.phase]}</strong><span>{progress.phase === 'not-started' ? `${progress.total} questions` : `${progress.answered} of ${progress.total} answered`}</span></p>
                    {item.progressNotice && <p className="library-warning" role="alert">{item.progressNotice}</p>}
                    <button className="button button-primary test-open" aria-label={`${action}: ${entry.title}`} onClick={() => onOpenTest(entry.id, resume)}>{action}</button>
                    {progress.phase === 'not-started' && <span className="test-action-hint">Opens the introduction before timing begins.</span>}
                  </>
                )}
                <div className="test-history">
                  {item.historyNotice && <div className="library-warning"><p role="alert">{item.historyNotice}</p><button className="text-button" onClick={onRetry}>Retry history</button></div>}
                  {completed.length > 0 ? (
                    <details className="completed-history" open>
                      <summary>{completed.length} completed {completed.length === 1 ? 'attempt' : 'attempts'}</summary>
                      {!item.historySaved && <p className="library-warning">These results are not fully saved yet. Keep this tab open and retry saving.</p>}
                      <ol className="history-entries">
                        {completed.map((result, index) => (
                          <li className="history-entry" key={result.id}>
                            <div className="history-entry-heading"><strong>Attempt {completed.length - index}</strong><time dateTime={new Date(result.completedAt).toISOString()}>{completionDate(result.completedAt)}</time></div>
                            <ResultCounts right={result.right} wrong={result.wrong} skipped={result.skipped} />
                            <span className="history-total">{result.total} questions total</span>
                          </li>
                        ))}
                      </ol>
                    </details>
                  ) : item.historyStatus === 'loading' ? <p className="library-loading">Loading completed history...</p>
                    : item.historyStatus === 'error' ? <p className="library-warning">Completed history is unavailable. Existing stored results have been kept.</p>
                      : <p className="no-completions">No completed attempts recorded in this browser.</p>}
                </div>
              </section>
            )
          })}
        </div>
        <p className="history-limits">History is saved in this browser. Attempts that were reset before their results were recorded cannot be recovered.</p>
      </div>
    </main>
  )
}
