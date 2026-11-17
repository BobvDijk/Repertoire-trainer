import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLines, writePgn, linesToTree, treeToMovetext, parseMoveTree, renumber } from '../src/pgn.js';
import { edgeKeys, removeMoves } from '../src/position.js';

const PGN = `[Event "Italian Game"]
[Site "Chess Tempo"]

{intro} 1. e4 e5 2. Nf3 Nc6 3. Bc4 {The Italian. [%cal Gc2c3,Gd2d4] [%csl Gd4]} Bc5 (3... Nf6 4. d3 {A calm setup.} Bc5 5. c3 d6) (3... Be7) 4. c3 {Prepares d4.} Nf6 5. d3 d6 6. O-O O-O *

[White "Me"]
[Black "Them"]

1. d4 d5 (1... Nf6 2. c4 (2. Nf3 g6) e6) 2. c4 *

[Event "From a position"]
[FEN "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"]

1... c5 (1... e5 2. Nf3) 2. Nf3 d6 *`;

// everything the app uses from a line, with arrows compared as a set
const view = ls => ls.map(l => ({ id: l.id, g: l.g, name: l.name, sans: l.sans, cm: l.cm, fen: l.fen,
  ar: l.ar.map(a => a.split(',').filter(Boolean).sort().join(',')) }));

test('export then re-import gives the same lines, ids, comments, arrows and chapters', () => {
  const a = buildLines(PGN, 'w');
  const out = writePgn(a.lines, a.chapters, 'w');
  const b = buildLines(out, 'w');
  assert.deepEqual(view(b.lines), view(a.lines));
  assert.deepEqual(b.chapters.map(c => c.name), a.chapters.map(c => c.name));
  assert.equal(writePgn(b.lines, b.chapters, 'w'), out, 'exporting again is stable');
});

test('headers are kept; Event, SetUp and Result are added when missing', () => {
  const a = buildLines(PGN, 'w');
  const out = writePgn(a.lines, a.chapters, 'w');
  assert.match(out, /\[Site "Chess Tempo"\]/);
  assert.match(out, /\[White "Me"\]\n\[Black "Them"\]\n\[Event "Me – Them"\]/);
  assert.match(out, /\[FEN "[^"]+"\]\n\[SetUp "1"\]/);
  assert.equal(out.match(/\[Result "\*"\]/g).length, 3);
});

test('movetext uses standard numbering for variations and after comments', () => {
  const t = treeToMovetext(parseMoveTree('1. e4 {c} e5 (1... c5 2. Nf3) 2. Nf3 *'));
  assert.equal(t, '1. e4 {c} 1... e5 (1... c5 2. Nf3) 2. Nf3 *');
  assert.equal(treeToMovetext(parseMoveTree('1... e5 2. Nf3 *'), true, 1), '1... e5 2. Nf3 *');
  assert.equal(treeToMovetext(parseMoveTree('12. Nf3 Nc6 *'), false, 12), '12. Nf3 Nc6 *');
});

test('long movetext is wrapped at 80 columns without splitting comments', () => {
  const moves = '1. Nf3 Nf6 2. Ng1 Ng8 '.repeat(10) + '{' + 'a long comment '.repeat(8) + '} *';
  const t = treeToMovetext(parseMoveTree(moves));
  for (const row of t.split('\n')) if (!row.includes('{')) assert.ok(row.length <= 80, row);
  assert.match(t, /\{a long comment .*a long comment\}/);
});

test('the export reflects removed moves', () => {
  const a = buildLines(PGN, 'w');
  const l = a.lines.find(x => x.sans.join(' ') === 'e4 e5 Nf3 Nc6 Bc4 Be7');
  const kept = removeMoves(a.lines, new Set([edgeKeys(l)[6]])).lines;
  renumber(kept, a.chapters);
  const out = writePgn(kept, a.chapters, 'w');
  assert.doesNotMatch(out, /Be7/);
  const b = buildLines(out, 'w');
  assert.deepEqual(b.lines.map(x => x.id), kept.map(x => x.id), 'remaining lines keep their progress');
});

test('a cut line keeps its id after export and re-import', () => {
  const a = buildLines('[Event "x"]\n\n1. e4 e5 2. Nf3 Nc6 (2... d6 3. d4) *', 'w');
  const l = a.lines[1];
  const kept = removeMoves(a.lines, new Set([edgeKeys(l)[5]])).lines; // remove 3.d4, the only move
  const b = buildLines(writePgn(kept, a.chapters, 'w'), 'w');
  assert.deepEqual(b.lines.map(x => x.sans.join(' ')), ['e4 e5 Nf3 Nc6', 'e4 e5 Nf3 d6']);
  assert.deepEqual(b.lines.map(x => x.id), kept.map(x => x.id));
});

test('the export reflects skipped alternatives, and chapters without lines are left out', () => {
  const a = buildLines(PGN, 'w', 0, { mainOnly: true });
  const out = writePgn(a.lines, a.chapters, 'w');
  assert.doesNotMatch(out, /Ng3|2\. Nf3 g6/);
  assert.equal(writePgn([], a.chapters, 'w'), '\n');
});

test('linesToTree keeps line order as main line first', () => {
  const { lines } = buildLines('1. e4 (1. d4) (1. c4) *', 'w');
  assert.deepEqual(linesToTree(lines).ch.map(n => n.san), ['e4', 'd4', 'c4']);
});
