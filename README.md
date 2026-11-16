# Repertoire Trainer

Play through, explore and drill a chess opening repertoire from PGN files, in the browser.
Everything is stored locally (localStorage); the only network call is the optional Lichess game review.

## Features
- Import White and Black repertoires (PGN with variations, comments, `[%cal]`/`[%csl]` arrows).
- Auto-play lines, step through them, or explore from any position by making moves on the board.
- Modes: full lines, from the branch point, and **Smart review** (spaced repetition per move).
- Repertoire tree view with transpositions.
- **Lichess game review**: finds where your games left your repertoire, plus a quiz on those positions.
- Installable and works offline (service worker).

## Layout
```
index.html            page markup + piece SVGs
styles.css            all styles (phone layout at the bottom)
src/app.js            UI wiring (DOM, playback, controls)
src/pgn.js            PGN parsing -> chapters and lines
src/position.js       position keys, line preparation, repertoire index, game analysis, tree graph
src/smart.js          Smart review (spaced repetition) scheduling
src/review.js         Lichess API URL, NDJSON parsing, deviation summary
src/quiz.js           mistake quiz state and texts
src/effects.js        move sounds and speech
vendor/chess.mjs      chess.js 0.10.3 (BSD-2) with an ES-module export appended
sw.js, manifest.webmanifest, icons/   offline / install support
test/                 node:test unit tests
```

No build step and no dependencies: ES modules are loaded directly by the browser.

## Develop
```bash
npm test          # node --test (Node 20+)
npm run serve     # http://localhost:8000 (modules and the service worker need http, not file://)
```

When you add or rename a file the app loads, add it to `SHELL` in `sw.js` and bump `VERSION`.

## Hosting
`.github/workflows/pages.yml` runs the tests on every push and deploys the default branch to GitHub Pages.
One-time setup: repository **Settings → Pages → Build and deployment → Source: GitHub Actions**.
