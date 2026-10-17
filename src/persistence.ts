import { createAttempt, restoreAttempt } from './attempt.ts'
import type { Attempt } from './attempt.ts'
import { DEFAULT_TEST_ID } from './catalog.ts'
import type { TestCatalogEntry } from './catalog.ts'
import type { TestContent } from './content.ts'
import { emptyHistory, isResultHistory, mergeHistories } from './history.ts'
import type { ResultHistory } from './history.ts'

export const LEGACY_STORAGE_KEY = 'sat-reading-practice:test-11:v1'
export const SELECTED_TEST_STORAGE_KEY = 'reading-writing-practice:selected-test:v1'
export const PRACTICE_VIEW_STORAGE_KEY = 'reading-writing-practice:view:v1'
export const SAVE_FAILURE_NOTICE = 'Your progress, completed history, or navigation could not be saved on this device. Keep this tab open so you do not lose your work, and use Retry saving to try again.'
export type PracticeView = 'practice' | 'tests'

export interface ProgressStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export type GetStorage = () => ProgressStorage
type StorageReader = () => Pick<ProgressStorage, 'getItem'>

export interface AttemptReadResult {
  readonly attempt: Attempt
  readonly notice: string | null
  readonly status: 'restored' | 'new' | 'invalid' | 'unavailable'
}

export interface SelectionReadResult {
  readonly testId: string
  readonly notice: string | null
  readonly status: 'saved' | 'default' | 'invalid' | 'unavailable'
}

export function attemptStorageKey(testId: string): string {
  return testId === DEFAULT_TEST_ID ? LEGACY_STORAGE_KEY : `reading-writing-practice:${testId}:v1`
}

export function readAttempt(content: TestContent, getStorage: StorageReader): AttemptReadResult {
  let saved: string | null
  try {
    saved = getStorage().getItem(attemptStorageKey(content.test.id))
  } catch {
    return {
      attempt: createAttempt(content),
      notice: 'This browser is blocking saved progress. You can practice in this tab, but your answers may be lost when it closes.',
      status: 'unavailable',
    }
  }
  if (saved === null) return { attempt: createAttempt(content), notice: null, status: 'new' }

  let parsed: unknown
  try {
    parsed = JSON.parse(saved)
  } catch {
    return {
      attempt: createAttempt(content),
      notice: 'The saved attempt could not be read. A new attempt is ready to start for this test on this device.',
      status: 'invalid',
    }
  }
  const attempt = restoreAttempt(parsed, content)
  if (attempt) return { attempt, notice: null, status: 'restored' }
  return {
    attempt: createAttempt(content),
    notice: 'The saved attempt is damaged or belongs to a different test version. A new attempt is ready to start for this test.',
    status: 'invalid',
  }
}

export function writeAttempt(attempt: Attempt, getStorage: GetStorage): boolean {
  try {
    getStorage().setItem(attemptStorageKey(attempt.testId), JSON.stringify(attempt))
    return true
  } catch {
    return false
  }
}

export function readSelectedTest(catalog: readonly TestCatalogEntry[], getStorage: StorageReader): SelectionReadResult {
  try {
    const saved = getStorage().getItem(SELECTED_TEST_STORAGE_KEY)
    if (saved === null) return { testId: DEFAULT_TEST_ID, notice: null, status: 'default' }
    if (catalog.some((entry) => entry.id === saved)) return { testId: saved, notice: null, status: 'saved' }
    return { testId: DEFAULT_TEST_ID, notice: 'The saved test selection is unavailable. Practice Test 11 has been selected; your saved attempts have not been cleared.', status: 'invalid' }
  } catch {
    return { testId: DEFAULT_TEST_ID, notice: 'This browser is blocking saved test selection. Practice Test 11 is selected; you can choose another test in this tab.', status: 'unavailable' }
  }
}

export function writeSelectedTest(testId: string, getStorage: GetStorage): boolean {
  try {
    getStorage().setItem(SELECTED_TEST_STORAGE_KEY, testId)
    return true
  } catch {
    return false
  }
}

export function historyStorageKey(testId: string): string {
  return `reading-writing-practice:history:${testId}:v1`
}

export interface HistoryReadResult {
  readonly history: ResultHistory
  readonly status: 'restored' | 'new' | 'invalid' | 'unavailable'
  readonly notice: string | null
}

export function readHistory(testId: string, getStorage: StorageReader): HistoryReadResult {
  let raw: string | null
  try {
    raw = getStorage().getItem(historyStorageKey(testId))
  } catch {
    return { history: emptyHistory(testId), status: 'unavailable', notice: 'Completed history could not be read. Existing saved results have not been overwritten.' }
  }
  if (raw === null) return { history: emptyHistory(testId), status: 'new', notice: null }
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return { history: emptyHistory(testId), status: 'invalid', notice: 'Saved completed history is unreadable. It has been preserved rather than replaced.' }
  }
  if (!isResultHistory(value, testId)) {
    return { history: emptyHistory(testId), status: 'invalid', notice: 'Saved completed history did not pass validation. It has been preserved rather than replaced.' }
  }
  return { history: value, status: 'restored', notice: null }
}

export function writeMergedHistory(history: ResultHistory, getStorage: GetStorage): { saved: boolean; history: ResultHistory; notice: string | null } {
  const restored = readHistory(history.testId, getStorage)
  if (restored.status === 'unavailable' || restored.status === 'invalid') {
    return { saved: false, history, notice: restored.notice }
  }
  let merged: ResultHistory
  try {
    merged = mergeHistories(restored.history, history)
  } catch (error) {
    return { saved: false, history, notice: error instanceof Error ? error.message : 'Completed history could not be merged safely. Existing results have not been overwritten.' }
  }
  try {
    getStorage().setItem(historyStorageKey(history.testId), JSON.stringify(merged))
    return { saved: true, history: merged, notice: null }
  } catch {
    return { saved: false, history, notice: 'Completed history could not be saved. Keep this tab open and retry saving before starting another attempt.' }
  }
}

export function readPracticeView(getStorage: StorageReader): { view: PracticeView; notice: string | null } {
  try {
    const value = getStorage().getItem(PRACTICE_VIEW_STORAGE_KEY)
    if (value === null || value === 'practice' || value === 'tests') return { view: value ?? 'practice', notice: null }
    return { view: 'practice', notice: 'The saved page preference was unavailable. Your attempts and completed history have not been cleared.' }
  } catch {
    return { view: 'practice', notice: 'This browser is blocking saved navigation. Your page choice may not survive refresh.' }
  }
}

export function writePracticeView(view: PracticeView, getStorage: GetStorage): boolean {
  try {
    getStorage().setItem(PRACTICE_VIEW_STORAGE_KEY, view)
    return true
  } catch {
    return false
  }
}
