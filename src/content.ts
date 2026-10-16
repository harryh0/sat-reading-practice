import source from './data/practice-test-11.json' with { type: 'json' }

export const practiceTest = source
export const modules = source.modules
export const questions = modules.flatMap((module) => module.questions)
export type Question = (typeof questions)[number]
export const questionById = new Map(questions.map((question) => [question.id, question]))
export const choiceIds = ['A', 'B', 'C', 'D'] as const
export type ChoiceId = (typeof choiceIds)[number]

export function isChoiceId(value: unknown): value is ChoiceId {
  return typeof value === 'string' && choiceIds.some((choice) => choice === value)
}

export function getQuestion(id: string): Question {
  const question = questionById.get(id)
  if (!question) throw new Error(`Unknown question: ${id}`)
  return question
}
