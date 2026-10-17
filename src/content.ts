export const choiceIds = ['A', 'B', 'C', 'D'] as const
export type ChoiceId = (typeof choiceIds)[number]

export interface Choice {
  readonly id: ChoiceId
  readonly html: string
}

export interface FigureTable {
  readonly caption: string
  readonly headers: readonly string[]
  readonly rows: readonly (readonly (string | number)[])[]
}

export interface QuestionFigure {
  readonly src: string
  readonly alt: string
  readonly table?: FigureTable | null
  readonly placement?: 'before' | 'after'
}

export interface Question {
  readonly id: string
  readonly module: number
  readonly number: number
  readonly sourcePage: number
  readonly passageHtml: string
  readonly promptHtml: string
  readonly choices: readonly Choice[]
  readonly figure: QuestionFigure | null
  readonly correctAnswer: ChoiceId
  readonly explanationHtml: string
  readonly answerPages: readonly number[]
}

export interface PracticeModule {
  readonly number: number
  readonly title: string
  readonly questions: readonly Question[]
}

export interface TestSources {
  readonly test: string
  readonly answers: string
  readonly testSha256?: string
  readonly answersSha256?: string
  readonly testPdfPages: readonly (readonly [number, number])[]
  readonly answerPdfPages: readonly (readonly [number, number])[]
  readonly note?: string
}

export interface PracticeTest {
  readonly id: string
  readonly title: string
  readonly section: 'Reading and Writing'
  readonly questionCount: number
  readonly sources: TestSources
  readonly modules: readonly PracticeModule[]
}

export interface TestContent {
  readonly test: PracticeTest
  readonly modules: readonly PracticeModule[]
  readonly questions: readonly Question[]
  readonly questionById: ReadonlyMap<string, Question>
}

export function isChoiceId(value: unknown): value is ChoiceId {
  return typeof value === 'string' && choiceIds.some((choice) => choice === value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function requireContent(condition: unknown, field: string): asserts condition {
  if (!condition) throw new Error(`Invalid test content: ${field}.`)
}

function validateRanges(value: unknown, field: string): asserts value is [number, number][] {
  requireContent(Array.isArray(value) && value.length > 0, field)
  for (const range of value) {
    requireContent(
      Array.isArray(range) && range.length === 2 &&
      positiveInteger(range[0]) && positiveInteger(range[1]) && range[0] <= range[1],
      field,
    )
  }
}

function validateFigure(value: unknown, field: string) {
  if (value === null) return
  requireContent(isRecord(value), field)
  requireContent(
    nonempty(value.src) && value.src.startsWith('/figures/') &&
    !value.src.includes('\\') && !value.src.split('/').includes('..'),
    `${field}.src must be a local figure path`,
  )
  requireContent(nonempty(value.alt), `${field}.alt`)
  requireContent(value.placement === undefined || value.placement === 'before' || value.placement === 'after', `${field}.placement`)
  if (value.table === undefined || value.table === null) return
  const table = value.table
  requireContent(isRecord(table) && nonempty(table.caption), `${field}.table`)
  requireContent(Array.isArray(table.headers) && table.headers.length > 0 && table.headers.every(nonempty), `${field}.table.headers`)
  requireContent(Array.isArray(table.rows) && table.rows.length > 0, `${field}.table.rows`)
  for (const row of table.rows) {
    requireContent(
      Array.isArray(row) && row.length === table.headers.length &&
      row.every((cell) => typeof cell === 'string' || (typeof cell === 'number' && Number.isFinite(cell))),
      `${field}.table row width or values`,
    )
  }
}

function validateTest(value: unknown, expectedId?: string): asserts value is PracticeTest {
  requireContent(isRecord(value), 'test')
  requireContent(nonempty(value.id) && (expectedId === undefined || value.id === expectedId), 'test identity does not match the selected test')
  requireContent(nonempty(value.title), 'title')
  requireContent(value.section === 'Reading and Writing', 'only Reading and Writing content is supported')
  requireContent(positiveInteger(value.questionCount), 'questionCount')
  requireContent(isRecord(value.sources), 'sources')
  requireContent(nonempty(value.sources.test) && nonempty(value.sources.answers), 'sources.test and sources.answers')
  for (const field of ['testSha256', 'answersSha256', 'note']) {
    requireContent(value.sources[field] === undefined || nonempty(value.sources[field]), `sources.${field}`)
  }
  validateRanges(value.sources.testPdfPages, 'sources.testPdfPages')
  validateRanges(value.sources.answerPdfPages, 'sources.answerPdfPages')
  const testRanges = value.sources.testPdfPages
  const answerRanges = value.sources.answerPdfPages
  requireContent(Array.isArray(value.modules) && value.modules.length > 0, 'modules')
  requireContent(
    value.sources.testPdfPages.length === value.modules.length &&
    value.sources.answerPdfPages.length === value.modules.length,
    'source page ranges must match the modules',
  )

  const ids = new Set<string>()
  let total = 0
  value.modules.forEach((module, moduleIndex) => {
    const field = `modules[${moduleIndex}]`
    requireContent(isRecord(module) && module.number === moduleIndex + 1 && nonempty(module.title), field)
    requireContent(Array.isArray(module.questions) && module.questions.length > 0, `${field}.questions`)
    const testRange = testRanges[moduleIndex]
    const answerRange = answerRanges[moduleIndex]
    module.questions.forEach((question, questionIndex) => {
      const path = `${field}.questions[${questionIndex}]`
      requireContent(isRecord(question) && nonempty(question.id) && !ids.has(question.id), `${path}.id must be unique within the test`)
      ids.add(question.id)
      requireContent(question.module === module.number && question.number === questionIndex + 1, `${path} numbering`)
      requireContent(
        positiveInteger(question.sourcePage) && question.sourcePage >= testRange[0] && question.sourcePage <= testRange[1],
        `${path}.sourcePage`,
      )
      requireContent(typeof question.passageHtml === 'string', `${path}.passageHtml`)
      requireContent(nonempty(question.promptHtml), `${path}.promptHtml`)
      requireContent(nonempty(question.explanationHtml), `${path}.explanationHtml`)
      requireContent(
        Array.isArray(question.choices) && question.choices.length === choiceIds.length &&
        question.choices.every((choice, index) => isRecord(choice) && choice.id === choiceIds[index] && nonempty(choice.html)),
        `${path}.choices must contain A, B, C, and D`,
      )
      requireContent(isChoiceId(question.correctAnswer), `${path}.correctAnswer`)
      validateFigure(question.figure, `${path}.figure`)
      requireContent(nonempty(question.passageHtml) || question.figure !== null, `${path} needs a passage or figure`)
      requireContent(
        Array.isArray(question.answerPages) && question.answerPages.length > 0 &&
        question.answerPages.every((page) => positiveInteger(page) && page >= answerRange[0] && page <= answerRange[1]),
        `${path}.answerPages`,
      )
      total += 1
    })
  })
  requireContent(value.questionCount === total, 'questionCount does not match the questions')
}

export function parseTestContent(value: unknown, expectedId?: string): TestContent {
  validateTest(value, expectedId)
  const questions = value.modules.flatMap((module) => module.questions)
  return {
    test: value,
    modules: value.modules,
    questions,
    questionById: new Map(questions.map((question) => [question.id, question])),
  }
}

export function getQuestion(content: TestContent, id: string): Question {
  const question = content.questionById.get(id)
  if (!question) throw new Error(`Unknown question in this test: ${id}`)
  return question
}

export function figureUrl(src: string, baseUrl: string): string {
  return `${baseUrl.replace(/\/?$/, '/')}${src.replace(/^\/+/, '')}`
}
