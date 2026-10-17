import type { TestCatalogEntry } from '../src/catalog.ts'
import { choiceIds, parseTestContent } from '../src/content.ts'
import type { ChoiceId, QuestionFigure, TestContent } from '../src/content.ts'
import type { ProgressStorage } from '../src/persistence.ts'

// Domain fixtures deliberately vary module sizes; they are never catalogued as app content.
export function fixtureSource(id: string, moduleSizes: readonly number[] = [2, 3], correctAnswer: ChoiceId = 'A') {
  return {
    id,
    title: 'SAT source metadata must not become a display title',
    section: 'Reading and Writing',
    questionCount: moduleSizes.reduce((sum, size) => sum + size, 0),
    sources: {
      test: 'domain-fixture:test',
      answers: 'domain-fixture:answers',
      testPdfPages: moduleSizes.map(() => [1, 20]),
      answerPdfPages: moduleSizes.map(() => [1, 20]),
    },
    modules: moduleSizes.map((size, moduleIndex) => ({
      number: moduleIndex + 1,
      title: `Module ${moduleIndex + 1}`,
      questions: Array.from({ length: size }, (_, questionIndex) => ({
        id: `m${moduleIndex + 1}-q${questionIndex + 1}`,
        module: moduleIndex + 1,
        number: questionIndex + 1,
        sourcePage: 1,
        passageHtml: `<p>Domain passage for ${id}, module ${moduleIndex + 1}, question ${questionIndex + 1}.</p>`,
        promptHtml: `Domain prompt for ${id}, question ${questionIndex + 1}?`,
        choices: choiceIds.map((choice) => ({ id: choice, html: `Domain option ${id}: ${choice}` })),
        figure: null as QuestionFigure | null,
        correctAnswer,
        explanationHtml: `<p>Supplied explanation for ${id}, module ${moduleIndex + 1}, question ${questionIndex + 1}.</p>`,
        answerPages: [1],
      })),
    })),
  }
}

export function fixtureContent(id: string, moduleSizes?: readonly number[], correctAnswer?: ChoiceId): TestContent {
  return parseTestContent(fixtureSource(id, moduleSizes, correctAnswer))
}

export function fixtureEntry(content: TestContent, number = 4): TestCatalogEntry {
  return { id: content.test.id, number, title: `Practice Test ${number}`, load: async () => content }
}

export class MemoryStorage implements ProgressStorage {
  readonly values = new Map<string, string>()
  readonly writes: { key: string; value: string }[] = []
  readonly failingKeys = new Set<string>()
  failReads = false
  failWrites = false

  getItem(key: string): string | null {
    if (this.failReads) throw new Error('Reading storage is blocked')
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    if (this.failWrites || this.failingKeys.has(key)) throw new Error('Writing storage is blocked')
    this.values.set(key, value)
    this.writes.push({ key, value })
  }
}
