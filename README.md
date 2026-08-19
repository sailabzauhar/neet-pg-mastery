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

## What's implemented (v1)

- Home screen — subject grid (locked/live), streak, export/import progress
- Topic list per subject — ranked by priority score, tagged must-do / repeated / image-based
- MCQ screen — question, options, immediate correct/wrong feedback
- Full explanation screen — the 14-part structure (core concept, why correct, why each distractor is wrong, high-yield facts, clinical correlation, common confusions, exceptions, related concepts, exam traps, image clues, memory aid, other ways tested, NEET PG takeaway, source citation)
- Mastery tracking — per-concept and per-topic scores, blended from accuracy, recent accuracy, difficulty spread, and variation-type coverage; visualized as a ring wherever progress is shown
- Progress persistence — IndexedDB, same-device/same-browser, survives closing the tab or restarting the device
- Export/Import progress as JSON — manual backup, since there's no server/login

## What's deliberately NOT built yet, and why

These aren't oversights — they need either more content or more usage data to be worth building:

- **Sprint Mode, Grand Test, and most other session modes** (Quick 10/25, Marathon, Weakness Test, etc.) — need multiple topics/subjects with real content to be meaningful. Right now they'd just be the same 12 questions in different wrapping. See `sessionEngine.js` for where these plug in once content exists.
- **Full FSRS spaced repetition** — `schedulerFSRS.js` ships a simplified, FSRS-*inspired* staged scheduler (fixed interval multipliers) rather than a fitted stability/difficulty model, because there isn't yet enough review-history volume across enough concepts for a fitted model to mean anything over a fixed one. Swap the file later without touching anything else.
- **Confidence tagging and time-to-answer-weighted mastery** — the attempt record already stores `time_ms` and has a `confidence` field ready to populate, but the mastery formula doesn't use them yet. See `masteryEngine.js`.
- **Dark theme** (`css/themes.css` mentioned in the original architecture) — not built; only the light "paper" theme exists.

## Known content caveats (carried over from the data-build phase)

- `is_must_do_topic` in `pyq_index.json` and every `topics.json` is a best-effort keyword match against the source PDF's "Must Must Do Topics" lists, not a manual verification — spot-check before treating it as authoritative for study prioritization.
- A few topics that are really the same concept ended up as separate entries because the source PDF phrased them slightly differently across years (e.g. "Measles" vs "Measles (SSPE)" in Paediatrics). Harmless for now, worth a manual merge pass eventually.
- Chapter 1's one image-based question (`anat_pharyngeal_arch_arteries_0007`) has a placeholder `GENERATED_IMAGE` reference with no actual image attached yet — needs a real image generated/sourced before that question is meaningfully usable.

## Local development

There isn't one, deliberately — this project is built and hand-delivered file-by-file in a Claude chat, not run through a local dev server or Claude Code (see the build protocol in the original project brief). To sanity-check a file before uploading, opening `index.html` directly in a browser works fine for anything that doesn't depend on `fetch()` of local JSON (which most browsers block for `file://` URLs) — for a real check, use GitHub Pages itself, or any static file server (`python3 -m http.server` from the repo root, then visit `localhost:8000`).
