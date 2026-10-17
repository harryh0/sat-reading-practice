# Reading and Writing practice

A browser-local practice library built with React, TypeScript, and Vite. Open **Tests** to choose a test or see every recorded completion, read the selected introduction, and select **Start test** to begin. The unbranded interface has a pale-blue header, centered elapsed timer, side-by-side passage and answer panes, review bookmarks, and direct question navigation. Source mappings and provenance remain in the import data, not in the practice interface.

**Live app:** https://harryh0.github.io/sat-reading-practice/

## Run locally

Use Node.js 24, matching the deployment workflow and the built-in test runner's lightweight TSX/JSON module adapters.

```powershell
npm install
npm run dev
```

Open **http://127.0.0.1:5173**. The server binds only to this computer. To create and serve a production build:

```powershell
npm run build
npm run preview
```

Run the content, catalog, model, state/session, and UI tests with `npm test`. The build also runs strict TypeScript checks.

## GitHub Pages deployment

The public source repository is [harryh0/sat-reading-practice](https://github.com/harryh0/sat-reading-practice). Pushes to `main` run `.github\workflows\deploy-pages.yml`, which installs locked dependencies, runs the tests and type check, builds the static app, and deploys only `dist` through GitHub Pages. The workflow can also be run manually from GitHub Actions.

The Pages build uses the configured site's base path so that scripts, styles, the favicon, and all question graphs work under `/sat-reading-practice/`. Local development and the default local build keep the root path. To preview a Pages-style build while the development server is running:

```powershell
npm run build -- --base=/sat-reading-practice/
npm run preview -- --port 5174 --base=/sat-reading-practice/
```

Open `http://127.0.0.1:5174/sat-reading-practice/` for that preview. The hosted app and localhost are different browser origins, so they have separate saved attempts. Existing local progress is not uploaded or transferred.

The public repository includes the app and the user-authorized question content, not the full original PDFs, staged attachments, credentials, saved attempts, or temporary artifacts. Those sensitive/local inputs are not deployment requirements.

## Included content

The eight tests contain **528 actual Reading and Writing questions, 2,112 choices, and 528 supplied answer explanations**. Only Reading and Writing is imported; Math is excluded. Counts were checked against each uploaded edition rather than inferred from Test 11.

| Practice test | Module 1 | Module 2 | Total | Original graph/table crops |
| --- | ---: | ---: | ---: | ---: |
| 4 | 33 | 33 | 66 | 4 |
| 5 | 33 | 33 | 66 | 4 |
| 6 | 33 | 33 | 66 | 4 |
| 7 | 33 | 33 | 66 | 5 |
| 8 | 33 | 33 | 66 | 5 |
| 9 | 33 | 33 | 66 | 5 |
| 10 | 33 | 33 | 66 | 5 |
| 11 | 33 | 33 | 66 | 4 |

The supplied PDF pairs are the authority, not subsequently downloaded editions. Each `src\data\practice-test-N.json` records its source SHA-256 hashes and actual page ranges. Source prose, notes, meaning-bearing italics/underlines, options, correct answers, and explanations are retained. Original graphics are high-resolution crops; source tables also have exact text-table data. Complex plots retain their original images and descriptive axis/series alt text rather than fabricated numeric transcriptions. Test 11's existing dataset and original asset paths are retained unchanged.

## Content and application modules

| Location | Responsibility |
| --- | --- |
| `src\catalog.ts` | Small neutral-title catalog and lazy, validated per-test JSON loaders |
| `src\content.ts` | Shared typed content model, validation, scoped question lookup, and asset URL handling |
| `src\data\practice-test-N.json` | One derived Reading and Writing dataset per supplied test |
| `public\figures\test-N\` | Test-specific original figure crops for Tests 4-10 |
| `src\attempt.ts` | Pure lifecycle, answer, navigation, timing, and scoring helpers scoped to content |
| `src\history.ts` | Validated completed-result metadata, stable submission identities, deduplication, and history merging |
| `src\persistence.ts` | Per-test progress/history keys, legacy Test 11 restoration, and selected-test/page persistence |
| `src\practiceSession.ts` | Loading, library navigation, pause/save switching, history backfill, and storage-error recovery |
| `src\TestLibrary.tsx` | Full-page test cards and accessible completed-attempt history |
| `src\usePracticeSession.ts`, `src\App.tsx` | React integration and responsive practice views |
| `scripts\pdf_importer.py` | Reusable PDF discovery, extraction, typography, mapping, coverage, and validation |
| `scripts\import_layouts.json` | Reviewed per-test identities/counts, figure crop bounds, alt text, and table data |
| `scripts\import_pdfs.py` | Small local import/check command |

The first visit defaults to Test 11 to preserve existing users' attempts. Other selections and the current Tests/Practice page are remembered. The initial practice view loads only its selected dataset. Opening Tests loads the remaining separate chunks to validate each current attempt and backfill any existing submissions; the content is not combined into one initial bundle.

## Reproducing an import and adding tests

Use Python 3.11 and copies of the PDFs you have permission to reuse. Originals remain outside the published project:

```powershell
python -m pip install -r .\scripts\requirements.txt
python .\scripts\import_pdfs.py --test-number 4 "C:\sources\sat-practice-test-4-digital.pdf" "C:\sources\sat-practice-test-4-answers-digital.pdf"
python .\scripts\import_pdfs.py --check --test-number 4 "C:\sources\sat-practice-test-4-digital.pdf" "C:\sources\sat-practice-test-4-answers-digital.pdf"
```

The shared engine identifies the actual module headers and Math boundary, handles subset font names and merged number badges, validates the ordered source questions against the configured/header counts, and pairs every question with its numbered explanation and explicit best-answer statement. It checks that every rendered source character is retained and that no body text is left unassigned. Nonbreaking spaces, PDF reading-order differences, caption typography, notes, and referenced underlines are handled centrally. Known PDF accessibility-tag artifacts are ignored in favor of the visible glyph text. Unclassified content and mismatched mappings fail explicitly.

`--check` rebuilds and compares the JSON and figure bytes without changing them. `--audit "C:\path\report.json"` optionally writes local per-question coverage/hash information. Never use an original PDF as the audit output. The default test number is 11 for compatibility with the original command; new imports should always specify it.

To add another test:

1. Inspect that exact question/answer PDF pair, its Reading and Writing headers/counts, figures, and explanation coverage. Add one entry to `scripts\import_layouts.json`; record only real source crop bounds and data, not guessed values.
2. Run the import and `--check` with `--test-number N`. New figure assets are isolated beneath `public\figures\test-N\`.
3. Add a neutral catalog entry and lazy loader in `src\catalog.ts` matching the new JSON's ID. Use a new content ID and an intentional migration if replacing an existing edition's questions; do not silently reuse saved answers against different content.
4. Run `npm test` and the Pages-style build/preview. Check each question/choice/explanation mapping and all source images before pushing `main`.

Source binaries and local audits/attachments are not needed by the hosted app and should not be committed. The per-test layout is the only source-specific configuration; do not clone the extraction engine or hardcode a new test into UI/scoring logic.

## Practice behavior

- A fresh attempt opens an introduction with a **Start test** button. No passage, question, choices, or elapsed timer is displayed before starting. Waiting or refreshing the introduction never counts as test time.
- Open the **Tests** tab in the header for the full-page library of Tests 4-11. Each card identifies its current state (Not started, In progress, Paused, or Completed), answered count, and every recorded completion. Start opens the introduction, Resume explicitly continues a paused attempt, and Review results opens the current submitted attempt. The **Practice** tab returns to the selected test.
- Entering Tests pauses and saves running practice immediately; no clock keeps running invisibly while browsing. Returning preserves the exact cursor, answers, marks, and elapsed time. Switching to another test retains independent progress and history.
- **Start test** opens the first question and starts elapsed time at zero. Existing started, paused, or completed attempts continue to resume/review normally; the update does not reset saved answers or elapsed time.
- Choose one answer per question, change it, or clear it. Use native radio-button keyboard controls, Prev/Next, the module selector, or the question navigator.
- Bookmark questions for review; the navigator can filter to unanswered or marked questions.
- Time counts **up without a limit**. It never auto-submits. While running, time includes refreshes, closed tabs, and time away. Hiding the timer does not pause it.
- **Pause** at the top right stops elapsed-time accumulation, hides the passage/question/answers and question navigation, and blocks submission. **Resume** restores the same question and selections without resetting time. Paused time, including time away, is excluded; a paused attempt stays paused after refresh.
- Answers, bookmarks, the current question, pause state, accumulated paused duration, timer visibility, and the current completed attempt are saved independently per test in `localStorage`. Test 11 keeps `sat-reading-practice:test-11:v1`; other tests use `reading-writing-practice:<testId>:v1`. The selected ID uses `reading-writing-practice:selected-test:v1`, and Tests/Practice uses `reading-writing-practice:view:v1`. Existing Test 11 saved states are restored without clearing them.
- Storage failures are shown explicitly with **Retry saving**; in-memory progress stays available while switching. Loading/validation failures identify the chosen test and never silently substitute another test. Once progress is safely saved, **Try again** reloads the app to recover from cached failed/stale data imports; unsaved in-memory work is never automatically reloaded away. There is no backend, account, analytics, external font, or upload of personal progress.
- Submission confirms unanswered and marked counts, stops the timer, and locks answers. The score is **X out of the selected test's total**. Results and history separate **Right** (answered correctly), **Wrong** (answered incorrectly), and **Skipped** (unanswered); these counts sum to that attempt's total. Unanswered questions do not add to the score but are never folded into Wrong. Every submitted question can then be reviewed with its full supplied explanation. Unfinished attempts never reveal correctness.
- Starting another attempt requires confirmation, clears only the selected test's current attempt, and returns to its introduction. All completed history and other tests are retained. Time remains stopped until **Start test** is selected again. A completed current attempt cannot be replaced until its result is safely saved to history.

## Completed-attempt history

Every submission is recorded once under `reading-writing-practice:history:<testId>:v1`. Records contain a stable attempt ID, test ID, start/completion timestamps, elapsed milliseconds, total questions, and Right/Wrong/Skipped counts, not duplicate answer snapshots. The library displays every record newest first, with local completion date/time. Historical detailed answer replay is not provided; the current submitted attempt remains fully reviewable.

New attempts receive a UUID when explicitly started, so even identical clock timestamps cannot combine separate submissions. Repeated submission, review navigation, rerenders, refresh, and library entry cannot duplicate an existing result. Existing saved completed attempts are backfilled once using a deterministic legacy identity without rewriting their saved source progress. Opening Tests backfills currently saved submissions across all tests, not just the selected one. Previously reset/overwritten attempts cannot be reconstructed; the app does not invent them.

Current progress is saved before a new completed result. History writes merge with valid stored records, preserving prior completions. Invalid/unreadable/conflicting history is kept rather than silently replaced with an empty list. Read/write failures are explicit; pending results remain in memory, and replacing an unsaved completed attempt is blocked until **Retry saving** succeeds.

This is a fixed, nonadaptive practice section, not an official proctored/adaptive SAT or a scaled-score estimator. Browser storage is specific to the browser and URL origin; use the same URL to resume. There is no cross-device synchronization. Clearing site data removes progress and completed history; local and hosted histories are separate.

SAT is a registered trademark of College Board. This independent app is not affiliated with or endorsed by College Board. The user authorized public hosting of the app and its included question content. Imported materials retain their existing rights; public availability does not grant additional reuse or redistribution permissions.
