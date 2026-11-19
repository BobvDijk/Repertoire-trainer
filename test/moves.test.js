import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from '../vendor/chess.mjs';
import { buildLines, parseMoveTree, leafPaths } from '../src/pgn.js';
import { prepare, playSan, moveLabel, posKeys } from '../src/position.js';

const sans = t => leafPaths(parseMoveTree(t)).map(p => p.map(n => n.san).join(' '));
const played = pgn => buildLines(pgn, 'w').lines.map(l => { prepare(l); return [l.n, l.sans.length, l.bad]; });

test('annotations written as text are not read as moves', () => {
  assert.deepEqual(sans('1. e4 += e5 2. Nf3 ± Nc6 3. Bb5 N a6 ∞ 4. Ba4 +- -+ = *'), ['e4 e5 Nf3 Nc6 Bb5 a6 Ba4']);
});

test('figurine notation is read', () => {
  assert.deepEqual(sans('1. ♘f3 d5 2. g3 ♞f6 3. ♗g2 ♛ *'), ['Nf3 d5 g3 Nf6 Bg2'], 'a lone figurine is skipped');
});

test('lines with annotations, figurines or over-specified moves play to the end', () => {
  assert.deepEqual(played('1. e4 e5 2. Nf3 += Nc6 3. Bb5 ± a6 *'), [[6, 6, false]]);
  assert.deepEqual(played('1. ♘f3 d5 2. g3 *'), [[3, 3, false]]);
  assert.deepEqual(played('1. e4 e5 2. Ngf3 Nbc6 3. Bf1c4 *'), [[5, 5, false]]);
});

test('playSan only accepts an unclear notation if exactly one legal move matches', () => {
  const ch = new Chess('4k3/8/8/8/8/8/8/1N2KN2 w - - 0 1'); // knights on b1 and f1: both can go to d2
  assert.equal(playSan(ch, 'Nd2'), null, 'ambiguous');
  assert.equal(playSan(new Chess('4k3/8/8/8/8/8/8/1N2KN2 w - - 0 1'), 'Nbd2').from, 'b1');
  assert.equal(playSan(new Chess(), 'Ke2'), null, 'illegal');
});

test('a move that really is illegal stops the line there and says where', () => {
  const [l] = buildLines('1. d4 d5 2. c4 e6 3. Nbd3 Nf6 *', 'w').lines;
  prepare(l);
  assert.equal(l.bad, true); assert.equal(l.n, 4);
  assert.deepEqual(l.badAt, { ply: 5, san: 'Nbd3' });
  assert.equal(moveLabel(l, l.badAt.ply, l.badAt.san), '3.Nbd3');
  assert.equal(moveLabel(l, 4, 'e6'), '2…e6');
});

test('lines sharing their first moves get the right positions (moves are played once and shared)', () => {
  const ls = buildLines('1. e4 e5 2. Nf3 Nc6 (2... d6 3. d4) 3. Bb5 (3. Bc4 Bc5) *', 'w').lines.map(prepare);
  for (const l of ls) {
    const ch = new Chess();
    l.sans.forEach((s, i) => { ch.move(s); assert.equal(l.pos[i + 1], ch.fen(), l.sans.join(' ') + ' ply ' + (i + 1)); });
  }
  assert.equal(posKeys(ls[0])[4], posKeys(ls[1])[4]);
  // a FEN start is kept apart from the normal start
  const [f] = buildLines('[FEN "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1"]\n\n1. e4 *', 'w').lines.map(prepare);
  assert.equal(f.pos[1].split(' ')[0], '4k3/8/8/8/4P3/8/8/4K3');
});
