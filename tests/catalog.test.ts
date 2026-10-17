import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import test from 'node:test'
import { DEFAULT_TEST_ID, getCatalogEntry, testCatalog } from '../src/catalog.ts'
import { choiceIds, getQuestion } from '../src/content.ts'
import importLayouts from '../scripts/import_layouts.json' with { type: 'json' }

test('the additive catalog offers exactly Practice Tests 4–11 with neutral titles and the preserved default ID', () => {
  assert.deepEqual(testCatalog.map((entry) => entry.number), [4, 5, 6, 7, 8, 9, 10, 11])
  assert.equal(new Set(testCatalog.map((entry) => entry.id)).size, testCatalog.length)
  for (const entry of testCatalog) {
    assert.equal(entry.title, `Practice Test ${entry.number}`)
    assert.equal(typeof entry.load, 'function')
    assert.doesNotMatch(entry.title, /SAT|PDF|College Board/i)
    if (entry.number !== 11) assert.equal(entry.id, `practice-test-${entry.number}-rw`)
  }
  assert.equal(DEFAULT_TEST_ID, 'sat-practice-test-11-rw-2026')
  assert.equal(getCatalogEntry(DEFAULT_TEST_ID).number, 11)
  assert.throws(() => getCatalogEntry('missing'), /not in the catalog/)
})

test('every lazy catalog loader resolves the matching Reading and Writing dataset and complete question/figure content', async (t) => {
  for (const entry of testCatalog) {
    await t.test(entry.title, async () => {
      const pending = entry.load()
      assert.equal(entry.load(), pending)
      const content = await pending
      const layout = Object.values(importLayouts).find((layout) => layout.id === entry.id)
      assert.ok(layout, `${entry.title}: missing reviewed import configuration`)
      assert.equal(content.test.id, entry.id)
      assert.equal(content.test.section, 'Reading and Writing')
      const total = content.modules.reduce((sum, module) => sum + module.questions.length, 0)
      assert.equal(content.test.questionCount, total)
      assert.equal(content.questions.length, total)
      assert.equal(content.questionById.size, total)
      assert.deepEqual(content.modules.map((module) => module.questions.length), layout.moduleQuestionCounts)
      assert.deepEqual(content.questions.filter((question) => question.figure).map((question) => question.id).sort(), Object.keys(layout.figures).sort())
      assert.match(content.test.sources.testSha256 ?? '', /^[a-f0-9]{64}$/)
      assert.match(content.test.sources.answersSha256 ?? '', /^[a-f0-9]{64}$/)
      for (const question of content.questions) {
        assert.equal(getQuestion(content, question.id), question)
        assert.ok(question.passageHtml.trim() || question.figure, question.id)
        assert.ok(question.promptHtml.trim(), question.id)
        assert.ok(question.explanationHtml.trim(), question.id)
        const explanationText = question.explanationHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
        assert.ok(explanationText.startsWith(`Choice ${question.correctAnswer} is the best answer`), `${entry.title}: ${question.id} answer/explanation mismatch`)
        if (/underlined/i.test(question.promptHtml)) assert.match(question.passageHtml, /<u>/, `${entry.title}: ${question.id} referenced underline`)
        if (/notes/i.test(question.promptHtml)) assert.match(question.passageHtml, /<ul class="source-notes">/, `${entry.title}: ${question.id} notes`)
        assert.deepEqual(question.choices.map((choice) => choice.id), [...choiceIds], question.id)
        assert.ok(question.choices.every((choice) => choice.html.trim()), question.id)
        assert.doesNotMatch(JSON.stringify(question), /ContentStart|Start referenced|\uFFFD|Lorem ipsum|TODO/, question.id)
        if (!question.figure) continue
        if (entry.number !== 11) assert.ok(question.figure.src.startsWith(`/figures/test-${entry.number}/`), question.id)
        const path = new URL(`../public${question.figure.src}`, import.meta.url)
        assert.ok(statSync(path).size > 100, `${entry.title}: ${question.id}`)
        assert.equal(readFileSync(path).subarray(1, 4).toString(), 'PNG', question.id)
        assert.ok(question.figure.alt.trim(), question.id)
        if (question.figure.table) {
          const table = question.figure.table
          assert.ok(table.rows.every((row) => row.length === table.headers.length), question.id)
        }
      }
      assert.equal(await entry.load(), content)
    })
  }
})
