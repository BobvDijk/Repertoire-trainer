# Repertoire Trainer

Play through, explore and drill a chess opening repertoire from PGN files, in the browser.
Data is stored on the device (localStorage). The app only goes online for the optional Lichess game review
(public game data) and, if you sign in, to sync your repertoires, settings and progress through your account
(Firebase; each user can only read their own data).

## Features
- Import White and Black repertoires (PGN with variations, comments, `[%cal]`/`[%csl]` arrows).
- Auto-play lines, step through them, or explore from any position by making moves on the board.
- Modes: full lines, from the branch point, and **Smart review** (spaced repetition per move).
- Repertoire tree view with transpositions.
- **Lichess game review**: finds where your games left your repertoire, plus a quiz on those positions.
- Installable and works offline (service worker).
- **Sync between devices** (optional, Firebase): sign in with email + password on each device to keep
  repertoires, settings, removed moves, Lichess accounts and progress in step.

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
src/sync.js           sync engine (what to upload / take over / merge), no Firebase code
src/sync-firebase.js  Firebase Auth + Firestore glue, loaded only when sync is used
src/firebase-config.js  your Firebase project settings (null = no sync)
vendor/firebase/      Firebase JS SDK 10.14.1 (Apache-2.0), served from this site
firestore.rules       security rules: each user can only read/write their own data
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

## Sync between devices (Firebase)

Sync is off until `src/firebase-config.js` has your Firebase project's settings. One-time setup
(free "Spark" plan, no credit card):

1. Go to <https://console.firebase.google.com>, **Create a project** (Google Analytics not needed).
2. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable**.
   Then **Settings → Authorized domains → Add domain**: `bobvdijk.github.io`.
3. **Build → Firestore Database → Create database**, pick a location near you, start in
   **production mode**. Open the **Rules** tab, replace everything with the contents of
   [`firestore.rules`](firestore.rules) and **Publish**.
4. **Project settings (gear) → General → Your apps → Web (`</>`)**, register an app (no Hosting).
   Copy the `firebaseConfig` values into `src/firebase-config.js` (or send them to Claude).
   These values are not secret; the rules decide who can read what.
5. Optional hardening: in Google Cloud console → APIs & Services → Credentials, restrict the
   "Browser key" to the website `https://bobvdijk.github.io/*`.

What syncs: White/Black PGN, settings, import options, removed moves, linked Lichess accounts
(newest change wins) and progress: seen lines and Smart review (merged, so training on two
devices adds up). Downloaded Lichess games are not synced; each device fetches its own.
On a device that already has data, signing in takes the account's repertoires and settings.

Data model: `users/{uid}/data/{pgn-w|pgn-b|state|progress}` = `{t, by, json}`.

### Developing with the Firebase emulators
```bash
npx firebase-tools emulators:start --project demo-repertoire
```
Then open `http://localhost:8000/?emulator`: the app uses the local emulators instead of a real
project (only on localhost).
