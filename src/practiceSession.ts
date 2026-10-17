import { isAttempt, pauseAttempt, resumeAttempt } from './attempt.ts'
import type { Attempt } from './attempt.ts'
import { getCatalogEntry, testCatalog } from './catalog.ts'
import type { TestCatalogEntry } from './catalog.ts'
import type { TestContent } from './content.ts'
import { readAttempt, readHistory, readPracticeView, readSelectedTest, SAVE_FAILURE_NOTICE, writeAttempt, writeMergedHistory, writePracticeView, writeSelectedTest } from './persistence.ts'
import type { GetStorage, HistoryReadResult, PracticeView } from './persistence.ts'
import { addCompletedResult, completedResult, emptyHistory, mergeHistories } from './history.ts'
import type { ResultHistory } from './history.ts'

export type SaveState = 'pending' | 'saved' | 'failed'

export interface ActivePractice {
  readonly content: TestContent
  readonly attempt: Attempt
}

export interface PracticeSessionSnapshot {
  readonly view: PracticeView
  readonly selectedTest: TestCatalogEntry
  readonly status: 'loading' | 'ready' | 'error'
  readonly active: ActivePractice | null
  readonly error: string | null
  readonly notice: string | null
  readonly saveState: SaveState
  readonly library: readonly LibraryTest[]
}

export interface LibraryTest {
  readonly entry: TestCatalogEntry
  readonly status: 'loading' | 'ready' | 'error'
  readonly error: string | null
  readonly progress: { readonly phase: 'not-started' | 'in-progress' | 'paused' | 'completed'; readonly answered: number; readonly total: number } | null
  readonly progressNotice: string | null
  readonly history: ResultHistory
  readonly historyStatus: 'loading' | 'ready' | 'error'
  readonly historyNotice: string | null
  readonly historySaved: boolean
}

interface CachedPractice {
  readonly content: TestContent
  attempt: Attempt
  dirty: boolean
  readNotice: string | null
  readUnavailable: boolean
  storageConflict: boolean
  completionDurable: boolean
}

interface CachedHistory {
  value: ResultHistory
  dirty: boolean
  completionConflict: boolean
  status: HistoryReadResult['status']
  notice: string | null
}

interface SessionOptions {
  readonly getStorage: GetStorage
  readonly catalog?: readonly TestCatalogEntry[]
  readonly now?: () => number
}

export class PracticeSession {
  readonly catalog: readonly TestCatalogEntry[]
  private readonly getStorage: GetStorage
  private readonly now: () => number
  private readonly cached = new Map<string, CachedPractice>()
  private readonly histories = new Map<string, CachedHistory>()
  private readonly libraryErrors = new Map<string, string>()
  private readonly listeners = new Set<() => void>()
  private selectionNotice: string | null
  private selectionUnread: boolean
  private selectedId: string
  private view: PracticeView
  private viewNotice: string | null
  private viewDirty = true
  private actionNotice: string | null = null
  private selectionDirty = true
  private saveFailed = false
  private dismissedNotice: string | null = null
  private request = 0
  private navigation = 0
  private pending: { id: string; promise: Promise<void> } | null = null
  private libraryPending: Promise<void> | null = null
  private snapshot: PracticeSessionSnapshot

  constructor({ getStorage, catalog = testCatalog, now = Date.now }: SessionOptions) {
    this.catalog = catalog
    this.getStorage = getStorage
    this.now = now
    const selection = readSelectedTest(catalog, getStorage)
    const page = readPracticeView(getStorage)
    this.view = page.view
    this.viewNotice = page.notice
    this.selectedId = selection.testId
    this.selectionNotice = selection.notice
    this.selectionUnread = selection.status === 'unavailable'
    this.snapshot = {
      view: this.view,
      selectedTest: getCatalogEntry(this.selectedId, catalog),
      status: 'loading',
      active: null,
      error: null,
      notice: selection.notice,
      saveState: 'pending',
      library: this.libraryRows(),
    }
  }

  getSnapshot = (): PracticeSessionSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  loadSelected = (): Promise<void> => {
    const pending = this.selectTest(this.selectedId, this.view)
    if (this.view === 'tests') void this.loadLibrary()
    return pending
  }

  selectTest = (id: string, view: PracticeView = 'practice'): Promise<void> => {
    const entry = getCatalogEntry(id, this.catalog)
    const changedView = this.view !== view
    this.view = view
    this.viewDirty ||= changedView
    if (view === 'tests') for (const cached of this.cached.values()) this.pauseForLibrary(cached)
    if (id === this.selectedId && this.snapshot.status === 'ready') {
      if (changedView) { this.flush(); this.publishCurrent() }
      return Promise.resolve()
    }
    if (id === this.pending?.id && id === this.selectedId) {
      if (changedView) { this.flush(); this.publishCurrent() }
      return this.pending.promise
    }

    const source = this.snapshot.active
    if (source && source.attempt.startedAt !== null && source.attempt.submittedAt === null && source.attempt.pausedAt === null) {
      const cached = this.cached.get(source.attempt.testId)
      if (cached) this.cached.set(source.attempt.testId, { ...cached, attempt: pauseAttempt(source.attempt, this.now()), dirty: true })
    }
    this.selectedId = id
    this.selectionDirty = true
    this.dismissedNotice = null
    this.actionNotice = null
    const request = ++this.request
    this.flush()
    this.publish({ status: 'loading', active: null, error: null })
    const pending = { id, promise: Promise.resolve() }
    this.pending = pending
    pending.promise = this.load(entry, request)
    return pending.promise
  }

  updateAttempt = (testId: string, update: (attempt: Attempt) => Attempt): boolean => {
    const active = this.snapshot.active
    if (this.snapshot.status !== 'ready' || !active || this.selectedId !== testId || this.view === 'tests') return false
    const attempt = update(active.attempt)
    if (!isAttempt(attempt, active.content)) throw new Error('The updated attempt is not valid for the selected test.')
    const cached = this.cached.get(testId)
    if (!cached) throw new Error('The selected attempt has not been loaded.')
    if (cached.attempt.submittedAt !== null && attempt.submittedAt === null) {
      this.queueCompletion(cached)
      this.flush()
      const history = this.histories.get(testId)
      if (!cached.completionDurable || !history || history.dirty || history.status === 'invalid' || history.status === 'unavailable') {
        this.actionNotice = 'Your completed result could not yet be saved to history. The current attempt has been kept. Retry saving before starting a new attempt.'
        this.publishCurrent()
        return false
      }
    }
    this.actionNotice = null
    const sameCompletion = cached.attempt.submittedAt !== null &&
      cached.attempt.submittedAt === attempt.submittedAt && cached.attempt.id === attempt.id
    const next = { ...cached, attempt, dirty: true, completionDurable: sameCompletion && cached.completionDurable }
    this.cached.set(testId, next)
    this.queueCompletion(next)
    this.flush()
    const saved = this.cached.get(testId)!
    this.publish({ status: 'ready', active: { content: saved.content, attempt: saved.attempt }, error: null })
    return true
  }

  openTests = (): Promise<void> => {
    this.navigation++
    this.view = 'tests'
    this.viewDirty = true
    this.actionNotice = null
    this.dismissedNotice = null
    for (const cached of this.cached.values()) this.pauseForLibrary(cached)
    this.flush()
    this.publishCurrent()
    return this.loadLibrary()
  }

  openPractice = async (id = this.selectedId, resume = false): Promise<void> => {
    const navigation = ++this.navigation
    await this.selectTest(id)
    const active = this.snapshot.active
    if (navigation === this.navigation && resume && this.view === 'practice' && this.selectedId === id && active &&
      active.attempt.startedAt !== null && active.attempt.submittedAt === null && active.attempt.pausedAt !== null) {
      this.updateAttempt(id, (attempt) => resumeAttempt(attempt, this.now()))
    }
  }

  retrySaving = (): void => {
    this.actionNotice = null
    this.flush()
    const saved = this.cached.get(this.selectedId)
    this.publish({
      ...this.snapshot,
      active: this.snapshot.active && saved ? { content: saved.content, attempt: saved.attempt } : null,
    })
  }

  dismissNotice = (): void => {
    this.dismissedNotice = this.currentNotice()
    this.publish(this.snapshot)
  }

  private async load(entry: TestCatalogEntry, request: number): Promise<void> {
    try {
      const content = await entry.load()
      if (request !== this.request) return
      if (content.test.id !== entry.id) throw new Error('The loaded content does not match the selected test.')
      const cached = this.cacheContent(content)
      if (this.view === 'tests') this.pauseForLibrary(cached)
      this.flush()
      this.publish({ status: 'ready', active: { content: cached.content, attempt: cached.attempt }, error: null })
    } catch (error) {
      if (request !== this.request) return
      const reason = error instanceof Error && (
        error.message.startsWith('Invalid test content:') ||
        error.message === 'The loaded content does not match the selected test.'
      )
        ? 'Its question data did not pass validation. Try again after updating the app, or choose another test.'
        : 'Check your connection and try again, or choose another test.'
      this.publish({
        status: 'error',
        active: null,
        error: `${entry.title} could not be loaded. ${reason} Your other saved attempts have not been cleared.`,
      })
    } finally {
      if (request === this.request) this.pending = null
    }
  }

  private cacheContent(content: TestContent): CachedPractice {
    let cached = this.cached.get(content.test.id)
    if (!cached) {
      const restored = readAttempt(content, this.getStorage)
      cached = {
        content, attempt: restored.attempt, readNotice: restored.notice, dirty: restored.status !== 'restored',
        readUnavailable: restored.status === 'unavailable', storageConflict: false,
        completionDurable: restored.status === 'restored' && restored.attempt.submittedAt !== null,
      }
      this.cached.set(content.test.id, cached)
    }
    this.ensureHistory(content.test.id)
    this.queueCompletion(cached)
    return cached
  }

  private ensureHistory(testId: string): CachedHistory {
    let cached = this.histories.get(testId)
    if (!cached) {
      const restored = readHistory(testId, this.getStorage)
      cached = { value: restored.history, dirty: false, completionConflict: false, status: restored.status, notice: restored.notice }
      this.histories.set(testId, cached)
    }
    return cached
  }

  private queueCompletion(cached: CachedPractice) {
    if (cached.attempt.submittedAt === null) return
    const history = this.ensureHistory(cached.content.test.id)
    try {
      const next = addCompletedResult(history.value, completedResult(cached.content, cached.attempt))
      if (next !== history.value) { history.value = next; history.dirty = true }
    } catch (error) {
      history.completionConflict = true
      history.status = 'invalid'
      history.notice = error instanceof Error ? error.message : 'Completed history could not be updated safely. Existing results have been kept.'
    }
  }

  private pauseForLibrary(cached: CachedPractice) {
    if (cached.attempt.startedAt !== null && cached.attempt.submittedAt === null && cached.attempt.pausedAt === null) {
      cached.attempt = pauseAttempt(cached.attempt, this.now())
      cached.dirty = true
    }
  }

  private loadLibrary(): Promise<void> {
    if (this.libraryPending) return this.libraryPending
    this.libraryPending = Promise.all(this.catalog.map(async (entry) => {
      this.ensureHistory(entry.id)
      try {
        const content = await entry.load()
        if (content.test.id !== entry.id) throw new Error('The loaded content does not match the selected test.')
        const cached = this.cacheContent(content)
        if (this.view === 'tests' || entry.id !== this.selectedId) this.pauseForLibrary(cached)
        this.libraryErrors.delete(entry.id)
        this.flush()
      } catch {
        this.libraryErrors.set(entry.id, `${entry.title} could not be loaded. Saved progress and completed history have not been cleared.`)
      }
      this.publishCurrent()
    })).then(() => {}).finally(() => { this.libraryPending = null })
    return this.libraryPending
  }

  private libraryRows(): readonly LibraryTest[] {
    return this.catalog.map((entry) => {
      const cached = this.cached.get(entry.id)
      const history = this.histories.get(entry.id)
      const error = this.libraryErrors.get(entry.id) ?? null
      const attempt = cached?.attempt
      return {
        entry,
        status: cached ? 'ready' : error ? 'error' : 'loading',
        error,
        progress: cached && attempt ? {
          phase: attempt.submittedAt !== null ? 'completed' : attempt.startedAt === null ? 'not-started' : attempt.pausedAt !== null ? 'paused' : 'in-progress',
          answered: Object.keys(attempt.answers).length,
          total: cached.content.questions.length,
        } : null,
        progressNotice: cached?.readNotice ?? null,
        history: history?.value ?? emptyHistory(entry.id),
        historyStatus: !history ? 'loading' : history.status === 'invalid' || history.status === 'unavailable' ? 'error' : 'ready',
        historyNotice: history?.notice ?? null,
        historySaved: history !== undefined && !history.dirty && history.status !== 'invalid' && history.status !== 'unavailable',
      }
    })
  }

  private publishCurrent() {
    const cached = this.cached.get(this.selectedId)
    this.publish({
      status: this.snapshot.status,
      active: this.snapshot.status === 'ready' && cached ? { content: cached.content, attempt: cached.attempt } : this.snapshot.active,
      error: this.snapshot.error,
    })
  }

  private flush() {
    let failed = !this.ensureSelectionReadable()
    for (const [id, cached] of this.cached) {
      if (id === this.selectedId || !cached.dirty) continue
      if (!this.ensureWritable(cached)) { failed = true; continue }
      if (cached.attempt.startedAt !== null && cached.attempt.pausedAt === null && cached.attempt.submittedAt === null) {
        cached.attempt = pauseAttempt(cached.attempt, this.now())
        cached.dirty = true
      }
      if (!cached.dirty) continue
      if (writeAttempt(cached.attempt, this.getStorage)) {
        cached.dirty = false
        if (cached.attempt.submittedAt !== null) cached.completionDurable = true
      }
      else failed = true
    }

    const selected = this.cached.get(this.selectedId)
    const writable = !selected?.dirty || this.ensureWritable(selected)
    if (!writable) failed = true
    if (!failed && this.selectionDirty) {
      if (writeSelectedTest(this.selectedId, this.getStorage)) this.selectionDirty = false
      else failed = true
    }
    if (selected?.dirty && writable) {
      const running = selected.attempt.startedAt !== null && selected.attempt.pausedAt === null && selected.attempt.submittedAt === null
      // Save pauses and selection first so refresh cannot restore another test beside a saved running timer.
      if (!failed || !running) {
        if (writeAttempt(selected.attempt, this.getStorage)) {
          selected.dirty = false
          if (selected.attempt.submittedAt !== null) selected.completionDurable = true
        }
        else failed = true
      }
    }
    if (!failed && selected && this.viewDirty) {
      if (writePracticeView(this.view, this.getStorage)) {
        this.viewDirty = false
        this.viewNotice = null
      }
      else failed = true
    }
    let historyFailed = false
    for (const [id, history] of this.histories) {
      if (history.completionConflict) {
        historyFailed = true
        continue
      }
      if (history.status === 'unavailable' || history.status === 'invalid') {
        const restored = readHistory(id, this.getStorage)
        if (restored.status === 'restored' || restored.status === 'new') {
          try {
            history.value = mergeHistories(restored.history, history.value)
            history.status = restored.status
            history.notice = null
          } catch (error) {
            history.notice = error instanceof Error ? error.message : 'Completed history could not be recovered safely.'
          }
        }
      }
      if (!history.dirty) continue
      const current = this.cached.get(id)
      if (current && current.attempt.submittedAt !== null && !current.completionDurable) {
        historyFailed = true
        continue
      }
      const result = writeMergedHistory(history.value, this.getStorage)
      if (result.saved) {
        history.value = result.history
        history.dirty = false
        history.status = 'restored'
        history.notice = null
      } else {
        history.notice = result.notice
        historyFailed = true
      }
    }
    this.saveFailed = failed || historyFailed
    if (this.saveFailed) this.dismissedNotice = null
  }

  private ensureSelectionReadable(): boolean {
    if (!this.selectionUnread) return true
    const restored = readSelectedTest(this.catalog, this.getStorage)
    if (restored.status === 'unavailable') return false
    if (restored.testId !== this.selectedId && !this.cached.has(restored.testId)) {
      const entry = getCatalogEntry(restored.testId, this.catalog)
      this.selectionNotice = `Saved test selection became available after a storage error. Choose ${entry.title} to restore its attempt before saving a different test. This tab’s answers are still available here.`
      return false
    }
    this.selectionUnread = false
    this.selectionNotice = restored.notice
    return true
  }

  private ensureWritable(cached: CachedPractice): boolean {
    if (cached.storageConflict) return false
    if (!cached.readUnavailable) return true
    const restored = readAttempt(cached.content, this.getStorage)
    if (restored.status === 'unavailable') return false
    if (restored.status === 'restored' && cached.attempt.startedAt !== null) {
      cached.storageConflict = true
      cached.readNotice = 'Previously saved progress became available after a storage error. This tab’s new attempt has not overwritten it. Keep this tab open to retain your new answers; reloading will return to the previously saved attempt.'
      return false
    }
    if (restored.status === 'restored') {
      cached.attempt = restored.attempt
      cached.dirty = false
      cached.completionDurable = restored.attempt.submittedAt !== null
      this.queueCompletion(cached)
    }
    cached.readUnavailable = false
    cached.readNotice = restored.notice
    return true
  }

  private currentNotice(): string | null {
    const notices = [
      this.selectionNotice,
      this.viewNotice,
      this.actionNotice,
      this.cached.get(this.selectedId)?.readNotice,
      ...[...this.histories].filter(([id]) => this.view === 'tests' || id === this.selectedId)
        .map(([id, history]) => history.notice ? `${getCatalogEntry(id, this.catalog).title}: ${history.notice}` : null),
      this.saveFailed ? SAVE_FAILURE_NOTICE : null,
    ].filter(Boolean)
    return notices.length > 0 ? notices.join(' ') : null
  }

  private publish(phase: Pick<PracticeSessionSnapshot, 'status' | 'active' | 'error'>) {
    const notice = this.currentNotice()
    this.snapshot = {
      view: this.view,
      selectedTest: getCatalogEntry(this.selectedId, this.catalog),
      status: phase.status,
      active: phase.active,
      error: phase.error,
      notice: notice === this.dismissedNotice ? null : notice,
      saveState: this.saveFailed ? 'failed' : 'saved',
      library: this.libraryRows(),
    }
    for (const listener of this.listeners) listener()
  }
}
