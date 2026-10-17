import assert from 'node:assert/strict'
import test from 'node:test'
import { figureUrl, getQuestion, parseTestContent } from '../src/content.ts'
import { fixtureContent, fixtureSource } from './fixtures.ts'

test('content indexes and module sizes are scoped to one validated dataset', () => {
  const first = fixtureContent('domain-first', [1, 4, 2], 'A')
  const second = fixtureContent('domain-second', [3], 'D')
  assert.equal(first.questions.length, 7)
  assert.equal(second.questions.length, 3)
  assert.deepEqual(first.modules.map((module) => module.questions.length), [1, 4, 2])
  assert.equal(getQuestion(first, 'm1-q1').correctAnswer, 'A')
  assert.equal(getQuestion(second, 'm1-q1').correctAnswer, 'D')
  assert.notEqual(getQuestion(first, 'm1-q1').explanationHtml, getQuestion(second, 'm1-q1').explanationHtml)
  assert.throws(() => getQuestion(second, 'm2-q1'), /Unknown question in this test/)
})

test('graph-only passages are valid with original image and alt, with an absent or null table', () => {
  for (const table of [undefined, null]) {
    const source = fixtureSource('domain-graph', [1])
    source.modules[0].questions[0].passageHtml = ''
    source.modules[0].questions[0].figure = { src: '/figures/domain-graph.png', alt: 'Domain graph description', table }
    const question = parseTestContent(source).questions[0]
    assert.equal(question.passageHtml, '')
    assert.equal(question.figure?.table, table)
    assert.equal(question.figure?.alt, 'Domain graph description')
  }
  const noPassage = fixtureSource('domain-empty', [1])
  noPassage.modules[0].questions[0].passageHtml = ''
  assert.throws(() => parseTestContent(noPassage), /needs a passage or figure/)
})

test('figure tables retain supplied string/numeric data and validate row width without inventing values', () => {
  const source = fixtureSource('domain-table', [1])
  source.modules[0].questions[0].figure = {
    src: '/figures/domain-table.png',
    alt: 'Domain table image',
    table: { caption: 'Domain table', headers: ['Item', 'Value'], rows: [['First', 1], ['Second', '2']] },
  }
  assert.deepEqual(parseTestContent(source).questions[0].figure?.table?.rows, [['First', 1], ['Second', '2']])
  const malformed = structuredClone(source)
  malformed.modules[0].questions[0].figure = {
    ...source.modules[0].questions[0].figure,
    table: { caption: 'Domain table', headers: ['Item', 'Value'], rows: [['Missing value']] },
  }
  assert.throws(() => parseTestContent(malformed), /table row width/)
})

test('figures accept before/after placement and reject unsupported placement', () => {
  for (const placement of [undefined, 'before', 'after'] as const) {
    const source = fixtureSource('domain-placement', [1])
    source.modules[0].questions[0].figure = { src: '/figures/domain.png', alt: 'Domain graph', placement }
    assert.equal(parseTestContent(source).questions[0].figure?.placement, placement)
  }
  const source = fixtureSource('domain-placement', [1])
  const invalid = { ...source, modules: [{ ...source.modules[0], questions: [{ ...source.modules[0].questions[0], figure: { src: '/figures/domain.png', alt: 'Domain graph', placement: 'middle' } }] }] }
  assert.throws(() => parseTestContent(invalid), /placement/)
})

test('a literary reference to a table remains ordinary passage text', () => {
  const source = fixtureSource('domain-literary', [1])
  source.modules[0].questions[0].passageHtml = '<p>A domain character sits at a table.</p>'
  assert.equal(parseTestContent(source).questions[0].figure, null)
})

test('content validation rejects wrong identity, Math, incorrect totals, duplicate IDs, and broken ordering', () => {
  const valid = fixtureSource('domain-validation', [2, 1])
  assert.throws(() => parseTestContent(valid, 'a-different-test'), /identity/)
  const invalid = [
    { ...valid, section: 'Math' },
    { ...valid, questionCount: 33 },
    { ...valid, modules: [] },
    { ...valid, modules: [{ ...valid.modules[0], number: 2 }, valid.modules[1]] },
    { ...valid, modules: [{ ...valid.modules[0], questions: [] }, valid.modules[1]] },
    { ...valid, modules: [{ ...valid.modules[0], questions: [valid.modules[0].questions[0], valid.modules[0].questions[0]] }, valid.modules[1]] },
  ]
  for (const value of invalid) assert.throws(() => parseTestContent(value), /Invalid test content/)
})

test('incomplete prompts, choices, explanations, and source page ranges fail validation before rendering', () => {
  const valid = fixtureSource('domain-fields', [1])
  const question = valid.modules[0].questions[0]
  const invalidQuestions = [
    { ...question, promptHtml: '' },
    { ...question, passageHtml: '' },
    { ...question, explanationHtml: '' },
    { ...question, choices: question.choices.slice(0, 3) },
    { ...question, choices: [...question.choices].reverse() },
    { ...question, choices: [{ id: 'A', html: '' }, ...question.choices.slice(1)] },
    { ...question, correctAnswer: 'E' },
    { ...question, module: 2 },
    { ...question, number: 2 },
    { ...question, sourcePage: 21 },
    { ...question, answerPages: [] },
    { ...question, answerPages: [21] },
    { ...question, figure: { src: 'https://example.invalid/figure.png', alt: 'Domain graphic' } },
    { ...question, figure: { src: '/figures/../elsewhere.png', alt: 'Domain graphic' } },
    { ...question, figure: { src: '/figures/domain.png', alt: '' } },
  ]
  for (const invalid of invalidQuestions) {
    assert.throws(() => parseTestContent({ ...valid, modules: [{ ...valid.modules[0], questions: [invalid] }] }), /Invalid test content/)
  }
  assert.throws(() => parseTestContent({ ...valid, sources: { ...valid.sources, testPdfPages: [] } }), /source/)
})

test('figure URLs support both Pages subpaths and Test 11 legacy root figure paths', () => {
  assert.equal(figureUrl('/figures/test-4/m1-q14.png', '/sat-reading-practice/'), '/sat-reading-practice/figures/test-4/m1-q14.png')
  assert.equal(figureUrl('/figures/test-4/m1-q14.png', '/'), '/figures/test-4/m1-q14.png')
  assert.equal(figureUrl('/figures/m1-q15.png', '/sat-reading-practice/'), '/sat-reading-practice/figures/m1-q15.png')
  assert.equal(figureUrl('/figures/test-4/m1-q14.png', '/sat-reading-practice'), '/sat-reading-practice/figures/test-4/m1-q14.png')
})
