import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLines, renumber } from '../src/pgn.js';
import { edgeKeys, posKeys, removeMoves, truncateLine, prepare } from '../src/position.js';

const REP = '1. e4 e5 2. Nf3 Nc6 (2... d6 3. d4) 3. Bb5 (3. Bc4 Bc5 4. c3) a6 *';
const fresh = () => buildLines(REP, 'w');
const sans = ls => ls.map(l => l.sans.join(' '));
// edge key of the move at ply i of the first line whose moves start with `prefix`
const edge = (ls, prefix) => { const l = ls.find(x => x.sans.join(' ').startsWith(prefix)); return edgeKeys(l)[prefix.split(' ').length]; };

test('removing a move with siblings drops the lines through it; others are untouched objects', () => {
  const { lines } = fresh();
  const r = removeMoves(lines, new Set([edge(lines, 'e4 e5 Nf3 Nc6 Bc4')]));
  assert.equal(r.changed, 1);
  assert.deepEqual(sans(r.lines), ['e4 e5 Nf3 Nc6 Bb5 a6', 'e4 e5 Nf3 d6 d4']);
  assert.equal(r.lines[0], lines[0], 'same object -> same id and progress');
});

test('removing the only move cuts the line short instead of deleting it', () => {
  const { lines } = fresh();
  const r = removeMoves(lines, new Set([edge(lines, 'e4 e5 Nf3 d6 d4')]));
  assert.deepEqual(sans(r.lines), ['e4 e5 Nf3 Nc6 Bb5 a6', 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3', 'e4 e5 Nf3 d6']);
  const cut = r.lines[2];
  assert.equal(cut.cm.length, 5); assert.equal(cut.pos, undefined);
  assert.equal(prepare(cut).n, 4);
  assert.notEqual(cut.id, lines[2].id);
});

test('a cut line that is the start of another line, or a duplicate, disappears', () => {
  const { lines } = fresh();
  // removing 3.Bb5 leaves "e4 e5 Nf3 Nc6", already covered by the 3.Bc4 line
  const r = removeMoves(lines, new Set([edge(lines, 'e4 e5 Nf3 Nc6 Bb5')]));
  assert.deepEqual(sans(r.lines), ['e4 e5 Nf3 Nc6 Bc4 Bc5 c3', 'e4 e5 Nf3 d6 d4']);
  // removing both 3rd moves cuts two lines to the same "e4 e5 Nf3 Nc6": kept once
  const r2 = removeMoves(lines, new Set([edge(lines, 'e4 e5 Nf3 Nc6 Bb5'), edge(lines, 'e4 e5 Nf3 Nc6 Bc4')]));
  assert.deepEqual(sans(r2.lines), ['e4 e5 Nf3 Nc6', 'e4 e5 Nf3 d6 d4']);
});

test('removing the first move deletes every line through it', () => {
  const { lines } = fresh();
  assert.deepEqual(removeMoves(lines, new Set([edgeKeys(lines[0])[1]])).lines, []);
});

test('removal works by position, so a transposition loses the move too', () => {
  const { lines } = buildLines('1. d4 d5 2. Nf3 Nf6 3. c4 *\n\n[Event "b"]\n\n1. Nf3 d5 2. d4 Nf6 3. c4 *', 'w');
  const k = edgeKeys(lines[0])[5]; // 3.c4 after 1.d4 d5 2.Nf3 Nf6
  assert.equal(edgeKeys(lines[1])[5], k, 'same position, same move');
  const r = removeMoves(lines, new Set([k]));
  assert.deepEqual(sans(r.lines), ['d4 d5 Nf3 Nf6', 'Nf3 d5 d4 Nf6']);
});

test('nothing removed returns the input', () => {
  const { lines } = fresh();
  assert.equal(removeMoves(lines, new Set()).lines, lines);
  assert.equal(removeMoves(lines, null).changed, 0);
});

test('truncateLine keeps comments and arrows for the kept moves', () => {
  const [l] = buildLines('{start} 1. e4 {a} e5 {b} 2. Nf3 {c} *', 'w').lines;
  posKeys(l);
  const t = truncateLine(l, 2);
  assert.deepEqual(t.cm, ['start', 'a', 'b']); assert.equal(t.pk, undefined);
});

test('renumber recounts lines per chapter', () => {
  const { lines, chapters } = buildLines('[Event "A"]\n\n1. e4 e5 (1... c5) *\n\n[Event "B"]\n\n1. d4 d5 *', 'w');
  const kept = lines.filter(l => l.sans[1] !== 'e5');
  renumber(kept, chapters);
  assert.deepEqual(kept.map(l => [l.g, l.k, l.of]), [[0, 1, 1], [1, 1, 1]]);
  assert.deepEqual(chapters.map(c => c.count), [1, 1]);
});
