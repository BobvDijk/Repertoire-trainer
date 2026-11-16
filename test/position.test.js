import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLines } from '../src/pgn.js';
import { posKey, prepare, posKeys, edgeKeys, pathText, buildRepIndex, analyzeGame, buildGraph, spanTree, lineThrough, stripCheck } from '../src/position.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

test('posKey ignores en passant square and move clocks', () => {
  assert.equal(posKey(START), posKey(START.replace('- 0 1', 'e3 5 9')));
  assert.notEqual(posKey(START), posKey(START.replace(' w ', ' b ')));
  assert.notEqual(posKey(START), posKey(START.replace('KQkq', 'Qkq')));
});

test('prepare plays the line and stops at an illegal move', () => {
  const L2 = prepare({ sans: ['e4', 'e5', 'Ke7'] });
  assert.equal(L2.bad, true); assert.equal(L2.n, 2);
  const ok = prepare({ sans: ['e4', 'c5'] });
  assert.equal(ok.bad, false); assert.equal(ok.n, 2); assert.equal(ok.num, 1); assert.equal(ok.black, false);
  assert.equal(ok.mv[2].san, 'c5');
});

test('prepare honours a FEN start and falls back on a bad FEN', () => {
  const L = prepare({ fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', sans: ['c5', 'Nf3'] });
  assert.equal(L.black, true); assert.equal(L.n, 2);
  assert.equal(pathText(L, 2), '1…c5 2.Nf3');
  const B = prepare({ fen: 'garbage', sans: ['e4'] });
  assert.equal(B.n, 1); assert.equal(B.black, false);
});

test('transpositions share position keys', () => {
  const a = prepare({ sans: ['Nf3', 'd5', 'd4'] }), b = prepare({ sans: ['d4', 'd5', 'Nf3'] });
  assert.equal(posKeys(a)[3], posKeys(b)[3]);
  assert.notEqual(edgeKeys(a)[3], edgeKeys(b)[3]);
  assert.equal(edgeKeys(a)[0], '');
});

test('pathText', () => {
  const L = prepare({ sans: ['e4', 'e5', 'Nf3'] });
  assert.equal(pathText(L, 0), 'Start position');
  assert.equal(pathText(L, 3), '1.e4 e5 2.Nf3');
});

const W = buildLines('1. e4 e5 2. Nf3 Nc6 (2... d6 3. d4) 3. Bb5 *', 'w').lines;
const B = buildLines('1. e4 c5 2. Nf3 d6 *', 'b').lines;
const ALL = [...W, ...B];

test('buildRepIndex only uses lines of that colour and records line ends', () => {
  const R = buildRepIndex(ALL, 'w');
  const afterE4 = posKeys(W[0])[1];
  assert.deepEqual([...R.moves.get(afterE4).keys()], ['e5']);
  assert.ok(R.ends.has(posKeys(W[0])[5]));
  const RB = buildRepIndex(ALL, 'b');
  assert.deepEqual([...RB.moves.get(afterE4).keys()], ['c5']);
});

test('analyzeGame: stays in book to the end', () => {
  const R = buildRepIndex(ALL, 'w');
  assert.deepEqual(analyzeGame(R, { c: 'w', m: 'e4 e5 Nf3 Nc6 Bb5' }), { t: 'ok' });
});

test('analyzeGame: I deviate', () => {
  const R = buildRepIndex(ALL, 'w');
  const r = analyzeGame(R, { c: 'w', m: 'e4 e5 Nf3 Nc6 Bc4 Bc5' });
  assert.equal(r.t, 'dev'); assert.equal(r.san, 'Bc4'); assert.equal(r.ply, 4); assert.equal(r.mine, true);
  assert.deepEqual(r.exp, ['Bb5']); assert.equal(r.from, 'f1'); assert.equal(r.to, 'c4');
});

test('analyzeGame: opponent move not covered', () => {
  const R = buildRepIndex(ALL, 'w');
  const r = analyzeGame(R, { c: 'w', m: 'e4 c5 Nf3' });
  assert.equal(r.t, 'opp'); assert.equal(r.san, 'c5'); assert.equal(r.mine, false);
});

test('analyzeGame: game goes past the end of a line', () => {
  const R = buildRepIndex(ALL, 'w');
  const r = analyzeGame(R, { c: 'w', m: 'e4 e5 Nf3 d6 d4 Nf6' });
  assert.equal(r.t, 'end'); assert.equal(r.san, 'Nf6'); assert.equal(r.mine, false);
});

test('analyzeGame: check symbols are ignored; a different first move is a deviation; illegal or untouched games give null', () => {
  const lines = buildLines('1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# *', 'w').lines;
  const R = buildRepIndex(lines, 'w');
  assert.deepEqual(analyzeGame(R, { c: 'w', m: 'e4 e5 Qh5 Nc6 Bc4 Nf6 Qxf7' }), { t: 'ok' });
  assert.equal(analyzeGame(R, { c: 'w', m: 'd4 d5' }).t, 'dev');
  assert.equal(analyzeGame(R, { c: 'w', m: 'e4 e5 Ke3' }), null);
  // As Black there are no black lines, so the game never touches the repertoire.
  assert.equal(analyzeGame(buildRepIndex(lines, 'b'), { c: 'b', m: 'e4 e5' }), null);
  assert.equal(stripCheck('Qxf7#'), 'Qxf7');
});

test('analyzeGame follows transpositions between lines', () => {
  const lines = buildLines('1. d4 d5 2. Nf3 Nf6 *\n\n[Event "x"]\n\n1. Nf3 d5 2. d4 *', 'w').lines;
  const R = buildRepIndex(lines, 'w');
  // 1.Nf3 d5 2.d4 lands in the 1.d4 line's position, where ...Nf6 is covered.
  assert.deepEqual(analyzeGame(R, { c: 'w', m: 'Nf3 d5 d4 Nf6' }), { t: 'ok' });
  // But a game is not followed past the first move the repertoire doesn't know.
  assert.equal(analyzeGame(R, { c: 'w', m: 'c4 d5 d4' }).t, 'dev');
});

test('lineThrough prefers the requested side', () => {
  const k = posKeys(W[0])[1];
  assert.equal(lineThrough(ALL, k, 'b').side, 'b');
  assert.equal(lineThrough(ALL, k).side, 'w');
  assert.equal(lineThrough(ALL, 'nope'), undefined);
});

test('buildGraph + spanTree merge lines and turn transpositions into refs', () => {
  const lines = buildLines('1. d4 d5 2. Nf3 Nf6 (2... c6) *\n\n[Event "x"]\n\n1. Nf3 d5 2. d4 Nf6 *', 'w').lines;
  const roots = buildGraph(lines, 'w');
  assert.equal(roots.size, 1);
  const [[rk, r]] = [...roots];
  const t = spanTree(r.g, rk);
  assert.deepEqual(t.kids.map(k => k.san), ['d4', 'Nf3']);
  const afterNf3 = t.kids[0].kids[0].kids[0];
  assert.equal(afterNf3.san, 'Nf3');
  assert.deepEqual(afterNf3.kids.map(k => k.san), ['Nf6', 'c6']);
  // 1.Nf3 d5 2.d4 reaches the same position as 1.d4 d5 2.Nf3: shown as a reference.
  const viaNf3 = t.kids[1].kids[0];
  assert.deepEqual(viaNf3.refs.map(x => x.san), ['d4']);
  assert.equal(viaNf3.refs[0].key, afterNf3.key);
});
