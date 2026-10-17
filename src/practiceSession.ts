import { isAttempt, pauseAttempt } from './attempt.ts'
import type { Attempt } from './attempt.ts'
import { getCatalogEntry, testCatalog } from './catalog.ts'
import type { TestCatalogEntry } from './catalog.ts'
import type { TestContent } from './content.ts'
import { readAttempt, readSelectedTest, SAVE_FAILURE_NOTICE, writeAttempt, writeSelectedTest } from './persistence.ts'
import type { GetStorage } from './persistence.ts'

export type SaveState = 'pending' | 'saved' | 'failed'

export interface ActivePractice {
  readonly content: TestContent
  readonly attempt: Attempt
}

export interface PracticeSessionSnapshot {
  readonly selectedTest: TestCatalogEntry
  readonly status: 'loading' | 'ready' | 'error'
  readonly active: ActivePractice | null
  readonly error: string | null
  readonly notice: string | null
  readonly saveState: SaveState
}

interface CachedPractice {
  readonly content: TestContent
  attempt: Attempt
  dirty: boolean
  readNotice: string | null
  readUnavailable: boolean
  storageConflict: boolean
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
  private readonly listeners = new Set<() => void>()
  private selectionNotice: string | null
  private selectionUnread: boolean
  private selectedId: string
  private selectionDirty = true
  private saveFailed = false
  private dismissedNotice: string | null = null
  private request = 0
  private pending: { id: string; promise: Promise<void> } | null = null
  private snapshot: PracticeSessionSnapshot

  constructor({ getStorage, catalog = testCatalog, now = Date.now }: SessionOptions) {
    this.catalog = catalog
    this.getStorage = getStorage
    this.now = now
    const selection = readSelectedTest(catalog, getStorage)
    this.selectedId = selection.testId
    this.selectionNotice = selection.notice
    this.selectionUnread = selection.status === 'unavailable'
    this.snapshot = {
      selectedTest: getCatalogEntry(this.selectedId, catalog),
      status: 'loading',
      active: null,
      error: null,
      notice: selection.notice,
      saveState: 'pending',
    }
  }

  getSnapshot = (): PracticeSessionSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  loadSelected = (): Promise<void> => this.selectTest(this.selectedId)

  selectTest = (id: string): Promise<void> => {
    const entry = getCatalogEntry(id, this.catalog)
    if (id === this.selectedId && this.snapshot.status === 'ready') return Promise.resolve()
    if (id === this.pending?.id && id === this.selectedId) return this.pending.promise

    const source = this.snapshot.active
    if (source && source.attempt.startedAt !== null && source.attempt.submittedAt === null && source.attempt.pausedAt === null) {
      const cached = this.cached.get(source.attempt.testId)
      if (cached) this.cached.set(source.attempt.testId, { ...cached, attempt: pauseAttempt(source.attempt, this.now()), dirty: true })
    }
    this.selectedId = id
    this.selectionDirty = true
    this.dismissedNotice = null
    const request = ++this.request
    this.flush()
    this.publish({ status: 'loading', active: null, error: null })
    const pending = { id, promise: Promise.resolve() }
    this.pending = pending
    pending.promise = this.load(entry, request)
    return pending.promise
  }

  updateAttempt = (testId: string, update: (attempt: Attempt) => Attempt): void => {
    const active = this.snapshot.active
    if (this.snapshot.status !== 'ready' || !active || this.selectedId !== testId) return
    const attempt = update(active.attempt)
    if (!isAttempt(attempt, active.content)) throw new Error('The updated attempt is not valid for the selected test.')
    const cached = this.cached.get(testId)
    if (!cached) throw new Error('The selected attempt has not been loaded.')
    this.cached.set(testId, { ...cached, attempt, dirty: true })
    this.flush()
    const saved = this.cached.get(testId)!
    this.publish({ status: 'ready', active: { content: saved.content, attempt: saved.attempt }, error: null })
  }

  retrySaving = (): void => {
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
      let cached = this.cached.get(entry.id)
      if (!cached) {
        const restored = readAttempt(content, this.getStorage)
        cached = {
          content, attempt: restored.attempt, readNotice: restored.notice, dirty: true,
          readUnavailable: restored.status === 'unavailable', storageConflict: false,
        }
        this.cached.set(entry.id, cached)
      }
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

  private flush() {
    let failed = !this.ensureSelectionReadable()
    for (const [id, cached] of this.cached) {
      if (id === this.selectedId || !cached.dirty) continue
      if (!this.ensureWritable(cached)) { failed = true; continue }
      if (cached.attempt.startedAt !== null && cached.attempt.pausedAt === null && cached.attempt.submittedAt === null) {
        cached.attempt = pauseAttempt(cached.attempt, this.now())
      }
      if (writeAttempt(cached.attempt, this.getStorage)) cached.dirty = false
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
        if (writeAttempt(selected.attempt, this.getStorage)) selected.dirty = false
        else failed = true
      }
    }
    this.saveFailed = failed
    if (failed) this.dismissedNotice = null
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
    if (restored.status === 'restored') cached.attempt = restored.attempt
    cached.readUnavailable = false
    cached.readNotice = restored.notice
    return true
  }

  private currentNotice(): string | null {
    const notices = [
      this.selectionNotice,
      this.cached.get(this.selectedId)?.readNotice,
      this.saveFailed ? SAVE_FAILURE_NOTICE : null,
    ].filter(Boolean)
    return notices.length > 0 ? notices.join(' ') : null
  }

  private publish(phase: Pick<PracticeSessionSnapshot, 'status' | 'active' | 'error'>) {
    const notice = this.currentNotice()
    this.snapshot = {
      selectedTest: getCatalogEntry(this.selectedId, this.catalog),
      status: phase.status,
      active: phase.active,
      error: phase.error,
      notice: notice === this.dismissedNotice ? null : notice,
      saveState: this.saveFailed ? 'failed' : 'saved',
    }
    for (const listener of this.listeners) listener()
  }
}
