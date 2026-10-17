import { parseTestContent } from './content.ts'
import type { TestContent } from './content.ts'

export const DEFAULT_TEST_ID = 'sat-practice-test-11-rw-2026'

export interface TestCatalogEntry {
  readonly id: string
  readonly number: number
  readonly title: string
  readonly load: () => Promise<TestContent>
}

function defineTest(number: number, id: string, load: () => Promise<{ default: unknown }>): TestCatalogEntry {
  let pending: Promise<TestContent> | undefined
  return {
    id,
    number,
    title: `Practice Test ${number}`,
    load() {
      pending ??= load().then((source) => parseTestContent(source.default, id)).catch((error: unknown) => {
        pending = undefined
        throw error
      })
      return pending
    },
  }
}

export const testCatalog: readonly TestCatalogEntry[] = [
  defineTest(4, 'practice-test-4-rw', () => import('./data/practice-test-4.json')),
  defineTest(5, 'practice-test-5-rw', () => import('./data/practice-test-5.json')),
  defineTest(6, 'practice-test-6-rw', () => import('./data/practice-test-6.json')),
  defineTest(7, 'practice-test-7-rw', () => import('./data/practice-test-7.json')),
  defineTest(8, 'practice-test-8-rw', () => import('./data/practice-test-8.json')),
  defineTest(9, 'practice-test-9-rw', () => import('./data/practice-test-9.json')),
  defineTest(10, 'practice-test-10-rw', () => import('./data/practice-test-10.json')),
  defineTest(11, DEFAULT_TEST_ID, () => import('./data/practice-test-11.json')),
]

export function getCatalogEntry(id: string, catalog: readonly TestCatalogEntry[] = testCatalog): TestCatalogEntry {
  const entry = catalog.find((test) => test.id === id)
  if (!entry) throw new Error('The selected practice test is not in the catalog.')
  return entry
}
