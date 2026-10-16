# Reading and Writing practice

A browser-local practice app built with React, TypeScript, and Vite. The unbranded interface has a pale-blue header, centered elapsed timer, side-by-side passage and answer panes, review bookmarks, and direct question navigation. Source mappings and provenance remain in the import data, not in the practice interface.

**Live app:** https://harryh0.github.io/sat-reading-practice/

## Run locally

Requires Node.js 22.12 or newer.

```powershell
npm install
npm run dev
```

Open **http://127.0.0.1:5173**. The server binds only to this computer. To create and serve a production build:

```powershell
npm run build
npm run preview
```

Run the content and attempt-state tests with `npm test`. The build also runs strict TypeScript checks.

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

The app contains **66 actual Reading and Writing questions: Module 1 (33) and Module 2 (33)** from the two user-provided **2026 Practice Test 11 nondigital-format PDFs**. It includes all four original graphs, accessible approximate graph-data tables, source emphasis and referenced underlines, all 264 answer choices, and all 66 official answer explanations. No questions or explanations were generated. Math is excluded.

The source files are the supplied copies of [Practice Test 11](https://satsuite.collegeboard.org/media/pdf/sat-practice-test-11-digital.pdf) and its [answer explanations](https://satsuite.collegeboard.org/media/pdf/sat-practice-test-11-answers-digital.pdf). The import records their SHA-256 hashes and the PDF page ranges in `src\data\practice-test-11.json`. Full PDFs are not copied to the app's public directory.

To reproduce the local import from copies you have permission to use:

```powershell
python -m pip install -r .\scripts\requirements.txt
python .\scripts\import_pdfs.py "C:\path\sat-practice-test-11-digital.pdf" "C:\path\sat-practice-test-11-answers-digital.pdf"
```

The importer reads only the Reading and Writing pages, matches each module/question to its explanation, preserves inline typography, crops the original graphs, and verifies that every imported source character is retained in the rendered question/choices and explanations. PDF accessibility-tag artifacts are deliberately ignored in favor of the actual visible text.

## Practice behavior

- A fresh attempt opens an introduction with a **Start test** button. No passage, question, choices, or elapsed timer is displayed before starting. Waiting or refreshing the introduction never counts as test time.
- **Start test** opens the first question and starts elapsed time at zero. Existing started, paused, or completed attempts continue to resume/review normally; the update does not reset saved answers or elapsed time.
- Choose one answer per question, change it, or clear it. Use native radio-button keyboard controls, Prev/Next, the module selector, or the question navigator.
- Bookmark questions for review; the navigator can filter to unanswered or marked questions.
- Time counts **up without a limit**. It never auto-submits. While running, time includes refreshes, closed tabs, and time away. Hiding the timer does not pause it.
- **Pause** at the top right stops elapsed-time accumulation, hides the passage/question/answers and question navigation, and blocks submission. **Resume** restores the same question and selections without resetting time. Paused time, including time away, is excluded; a paused attempt stays paused after refresh.
- Answers, bookmarks, the current question, pause state, accumulated paused duration, timer visibility, and the completed attempt are saved to `localStorage` in this browser. Existing saved attempts are upgraded without losing progress. Storage failures are shown explicitly. There is no backend, account, analytics, external font, or upload of personal progress.
- Submission confirms unanswered and marked counts, stops the timer, and locks answers. The score is **X out of 66**, with unanswered questions counted as incorrect. Every question can then be reviewed with its full supplied explanation.
- Starting another attempt requires confirmation, clears the previous attempt, and returns to the introduction. Time remains stopped until **Start test** is selected again. There is no attempt history or cross-device synchronization.

This is a fixed, nonadaptive practice section, not an official proctored/adaptive SAT or a scaled-score estimator. Browser storage is specific to the browser and URL origin; use the same URL to resume. Clearing site data removes saved progress.

SAT is a registered trademark of College Board. This independent app is not affiliated with or endorsed by College Board. The user authorized public hosting of the app and its included question content. Imported materials retain their existing rights; public availability does not grant additional reuse or redistribution permissions.
