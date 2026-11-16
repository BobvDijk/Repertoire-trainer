import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Q from '../src/quiz.js';

const item = (exp, san = 'Bc4') => ({
  c: 'w', n: 3, txt: '1.e4 e5 2.Nf3 Nc6',
  r: { exp, san, fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3' },
});

test('createQuiz starts at the given item', () => {
  const q = Q.createQuiz([item(['Bb5']), item(['d4'])], 1);
  assert.equal(q.on, true); assert.equal(q.i, 1); assert.deepEqual(q.o.r.exp, ['d4']);
  assert.equal(Q.scoreText(q), '2 / 2 · 0 correct');
});

test('isRepertoireMove ignores check marks and accepts any candidate', () => {
  const o = item(['Bb5']);
  assert.equal(Q.isRepertoireMove(o, ['Bb5+']), true);
  assert.equal(Q.isRepertoireMove(o, ['Bc4']), false);
  // promotion: several candidates for one click
  assert.equal(Q.isRepertoireMove(item(['e8=Q']), ['e8=N', 'e8=Q+']), true);
});

test('scoring: misses, finish, advance and end', () => {
  const q = Q.createQuiz([item(['Bb5']), item(['d4'])]);
  Q.miss(q); Q.miss(q);
  assert.equal(q.tries, 2);
  Q.finish(q, true);
  assert.equal(q.good, 1); assert.equal(q.seen, 1); assert.equal(q.done, true);
  assert.match(Q.resultText(q.o, true, q.tries), /^✓ Correct \(after 2 misses\)\. In your games you played Bc4 here \(3×\)\.$/);
  assert.equal(Q.advance(q), true);
  assert.equal(q.tries, 0); assert.equal(q.done, false);
  Q.finish(q, false);
  assert.equal(q.good, 1); assert.equal(q.seen, 2);
  assert.match(Q.resultText(q.o, false, 0), /^Answer: d4\./);
  assert.equal(Q.advance(q), false);
});

test('resultText singular miss', () => {
  assert.match(Q.resultText(item(['Bb5']), true, 1), /after 1 miss\)/);
});

test('promptText', () => {
  assert.equal(Q.promptText(item(['Bb5'])), 'White to move after 1.e4 e5 2.Nf3 Nc6. What does your repertoire play here? Make the move on the board.');
});

test('answerArrows draws every expected move and skips unplayable ones', () => {
  assert.equal(Q.answerArrows(item(['Bb5', 'd4', 'Qh8'])), 'Gf1b5,Gd2d4');
});
