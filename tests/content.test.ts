import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import test from 'node:test'
import { choiceIds, parseTestContent } from '../src/content.ts'
import source from '../src/data/practice-test-11.json' with { type: 'json' }

const { test: practiceTest, modules, questions } = parseTestContent(source)

const sourceKeys = [
  'ACDDABBDDCBDADBADD DDABBADDDAACADB'.replaceAll(' ', ''),
  'CCCDBBBABCBDCBCCAABBBBBBABDBC BCAA'.replaceAll(' ', ''),
]

function plain(value: string) {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

test('the supplied nondigital test has exactly two ordered modules of 33 Reading and Writing questions', () => {
  assert.equal(practiceTest.section, 'Reading and Writing')
  assert.equal(practiceTest.questionCount, 66)
  assert.equal(modules.length, 2)
  assert.deepEqual(modules.map((module) => module.questions.length), [33, 33])
  assert.equal(new Set(questions.map((question) => question.id)).size, 66)
  for (const module of modules) {
    assert.deepEqual(module.questions.map((question) => question.number), Array.from({ length: 33 }, (_, index) => index + 1))
    assert.equal(module.questions.map((question) => question.correctAnswer).join(''), sourceKeys[module.number - 1])
  }
})

test('all 66 questions have actual passages, complete prompts and options, and matching official explanations', () => {
  for (const question of questions) {
    assert.ok(plain(question.passageHtml).length > 100, question.id)
    assert.ok(plain(question.promptHtml).length > 30, question.id)
    assert.deepEqual(question.choices.map((choice) => choice.id), [...choiceIds], question.id)
    assert.ok(question.choices.every((choice) => plain(choice.html).length > 0), question.id)
    assert.ok(plain(question.explanationHtml).length > 400, question.id)
    assert.ok(plain(question.explanationHtml).startsWith(`Choice ${question.correctAnswer} is the best answer`), question.id)
    assert.doesNotMatch(JSON.stringify(question), /Start referenced|ContentStart|b l a n k|\uFFFD|Lorem ipsum|TODO/, question.id)
    const testRange = practiceTest.sources.testPdfPages[question.module - 1]
    const answerRange = practiceTest.sources.answerPdfPages[question.module - 1]
    assert.ok(question.sourcePage >= testRange[0] && question.sourcePage <= testRange[1], question.id)
    assert.ok(question.answerPages.length > 0 && question.answerPages.every((page) => page >= answerRange[0] && page <= answerRange[1]), question.id)
  }
})

test('all four original graphs are included as real local image assets with accessible data tables', () => {
  const illustrated = questions.filter((question) => question.figure !== null)
  assert.deepEqual(illustrated.map((question) => question.id), ['m1-q15', 'm2-q11', 'm2-q12', 'm2-q13'])
  for (const question of illustrated) {
    assert.ok(question.figure)
    const path = new URL(`../public${question.figure.src}`, import.meta.url)
    assert.ok(statSync(path).size > 10_000, question.id)
    assert.equal(readFileSync(path).subarray(1, 4).toString(), 'PNG')
    assert.ok(question.figure.alt.length > 80)
    const table = question.figure.table
    assert.ok(table)
    assert.ok(table.headers.length >= 2)
    assert.ok(table.rows.every((row) => row.length === table.headers.length))
  }
})

test('source emphasis, referenced underlines, notes, and cross-column content are retained', () => {
  const find = (id: string) => {
    const question = questions.find((item) => item.id === id)
    assert.ok(question)
    return question
  }
  for (const id of ['m1-q6', 'm1-q8', 'm1-q9', 'm2-q5', 'm2-q6', 'm2-q15']) {
    assert.match(find(id).passageHtml, /<u>/, id)
  }
  assert.match(find('m1-q2').passageHtml, /<em>subak/)
  assert.match(find('m1-q6').passageHtml, /Bitter’s feet were singing the news/)
  assert.match(find('m1-q6').passageHtml, /©2019 by Akwaeke Emezi/)
  assert.match(find('m1-q9').passageHtml, /Text 1/)
  assert.match(find('m1-q9').passageHtml, /Text 2/)
  for (const question of questions.filter((item) => item.promptHtml.includes('notes'))) {
    assert.match(question.passageHtml, /<ul class="source-notes">/, question.id)
  }
  assert.match(find('m2-q16').passageHtml, /Fred Stevens/)
  assert.match(find('m2-q16').promptHtml, /^Which quotation from an art historian/)
  assert.ok(find('m2-q16').choices.every((choice) => plain(choice.html).length > 300))
})
