# NEET PG Mastery

A topic-priority NEET PG MCQ mastery app, built from an annotated PYQ compilation (2018–2025, all 19 subjects). Static site, no backend — deploys straight to GitHub Pages.

## Status

- **Anatomy**: 1 of 84 topics has a full MCQ chapter live (Pharyngeal Arch Arteries, 12 questions). The other 83 topics are ranked and ready but not yet written.
- **18 other subjects**: topic lists are built and ranked (see `data/<subject>/topics.json`), no chapters yet.
- App shell: fully functional for whatever content exists — nothing here needs rebuilding as chapters are added.

## How content gets added

1. `data/manifest.json` — subject-level summary (topic counts, chapter counts). Update the relevant subject's `chapter_files_generated` and `total_mcqs` when a new chapter goes live.
2. `data/<subject>/topics.json` — flip the topic's `chapter_generated` to `true` and set `mcq_count` once its chapter file exists.
3. `data/<subject>/chXX_<slug>.json` — the actual chapter file (concept blueprint + MCQs + explanations), following the schema in `data/anatomy/ch01_pharyngeal_arch_arteries.json`.

Nothing in `index.html`, `css/`, or `js/` needs to change for any of this — `dataLoader.js` fetches whatever's there on demand. Upload the three files above through GitHub's web UI ("Add file → Upload files") and the site picks them up automatically.

## What's implemented (v1.1)

- Home screen — subject grid (locked/live), streak, export/import progress
- **Sprint tab** — walks every MCQ from every generated chapter, across all subjects or one chosen subject. A wrong answer rolls the position back 20 questions (clamped at 0) instead of restarting the run entirely. The question pool is assembled fresh from `manifest.json` every time it's opened — add a new chapter anywhere and Sprint picks it up automatically, no code changes needed. Rollback distance is a constant (`ROLLBACK_N` in `js/sessionEngine.js`) if you want to tune it.
- Topic list per subject — ranked by priority score, tagged must-do / repeated / image-based
- MCQ screen — question, options, immediate correct/wrong feedback
- Full explanation screen — the 14-part structure (core concept, why correct, why each distractor is wrong, high-yield facts, clinical correlation, common confusions, exceptions, related concepts, exam traps, image clues, memory aid, other ways tested, NEET PG takeaway, source citation)
- Mastery tracking — per-concept and per-topic scores, blended from accuracy, recent accuracy, difficulty spread, and variation-type coverage; visualized as a ring wherever progress is shown
- Progress persistence — IndexedDB, same-device/same-browser, survives closing the tab or restarting the device
- Export/Import progress as JSON — manual backup, since there's no server/login
- **Spaced repetition (SM-2)** — every answer updates a real SM-2 schedule (`js/schedulerSM2.js`) for that specific question: ease factor, repetition count, and a growing review interval on success (1 day → 6 days → ~17 → ~49...), reset straight back to a 1-day interval on a wrong answer. A question you've already solved automatically counts as "unsolved" again the moment its interval expires — reopening that topic resumes at that question instead of skipping past it. A "Due for review" card on Home surfaces everything overdue across every subject in one place, independent of which topic it originally came from.

## What's deliberately NOT built yet, and why

These aren't oversights — they need either more content or more usage data to be worth building:

- **Quick 10/25, Marathon, Weakness Test, and the rest of the session-mode roster** — Sprint covers "walk everything live," Review Due covers "spaced repetition"; the more targeted modes (weighted weakness sampling, fixed-length quick tests) need per-user attempt history and a bigger bank to be meaningfully different from those two. See `sessionEngine.js` for where these plug in once that exists.
- **Grand Test** — needs a substantial cross-subject question bank to sample from meaningfully rather than just replaying Sprint's same pool in a different wrapper.
- **A real self-rated confidence prompt after each answer** — SM-2's quality scale (0-5) was designed around a human rating their own recall, not a binary correct/wrong signal. `schedulerSM2.js` currently derives an approximate quality score from correctness + answer speed (see the honesty note at the top of that file) — good enough to drive real spacing, but a genuine "how well did you know that?" prompt would be more accurate. Swappable later without touching anything else in the scheduler.
- **Full FSRS spaced repetition** — spaced repetition is implemented via real SM-2 (`js/schedulerSM2.js`), not FSRS. FSRS fits per-card difficulty/stability parameters from review history using an optimizer — meaningfully more machinery than this app's current attempt volume would justify fitting well. SM-2 is a complete, correct, non-simplified algorithm in its own right (not a "lite" placeholder) and was what was actually requested. Worth revisiting once there's enough cross-concept review history for an FSRS fit to mean something.
- **Confidence tagging and time-to-answer-weighted mastery** — the attempt record already stores `time_ms` and has a `confidence` field ready to populate, but the mastery formula doesn't use them yet. See `masteryEngine.js`.
- **Dark theme** (`css/themes.css` mentioned in the original architecture) — not built; only the light "paper" theme exists.

## Known content caveats (carried over from the data-build phase)

- `is_must_do_topic` in `pyq_index.json` and every `topics.json` is a best-effort keyword match against the source PDF's "Must Must Do Topics" lists, not a manual verification — spot-check before treating it as authoritative for study prioritization.
- A few topics that are really the same concept ended up as separate entries because the source PDF phrased them slightly differently across years (e.g. "Measles" vs "Measles (SSPE)" in Paediatrics). Harmless for now, worth a manual merge pass eventually.
- Chapter 1's one image-based question (`anat_pharyngeal_arch_arteries_0007`) has a placeholder `GENERATED_IMAGE` reference with no actual image attached yet — needs a real image generated/sourced before that question is meaningfully usable.

## Local development

There isn't one, deliberately — this project is built and hand-delivered file-by-file in a Claude chat, not run through a local dev server or Claude Code (see the build protocol in the original project brief). To sanity-check a file before uploading, opening `index.html` directly in a browser works fine for anything that doesn't depend on `fetch()` of local JSON (which most browsers block for `file://` URLs) — for a real check, use GitHub Pages itself, or any static file server (`python3 -m http.server` from the repo root, then visit `localhost:8000`).
