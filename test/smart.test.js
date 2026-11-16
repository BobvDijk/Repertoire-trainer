import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLines } from '../src/pgn.js';
import { edgeKeys, prepare } from '../src/position.js';
import { INTERVALS, dueness, linePriority, smartStartIndex, recordReview, smartOrder, poolEdgeKeys, dueSummary } from '../src/smart.js';

const H = 36e5, NOW = 1_700_000_000_000;
const lines = buildLines('1. e4 e5 2. Nf3 Nc6 (2... d6) *', 'w').lines.map(prepare);

test('intervals grow: 0h, 4h, 1d, 3d, 7d, 16d, 35d', () => {
  assert.deepEqual(INTERVALS.map(x => x / H), [0, 4, 24, 72, 168, 384, 840]);
});

test('unseen moves are maximally due', () => {
  assert.equal(dueness({}, 'k', NOW), 10);
});

test('a move reviewed once is due after 4h, twice after 1 day', () => {
  const e = {};
  recordReview(e, 'k', NOW);
  assert.deepEqual(e.k, [1, NOW]);
  assert.ok(dueness(e, 'k', NOW + 3 * H) < 1);
  assert.ok(dueness(e, 'k', NOW + 4 * H) >= 1);
  recordReview(e, 'k', NOW);
  assert.ok(dueness(e, 'k', NOW + 23 * H) < 1);
  assert.ok(dueness(e, 'k', NOW + 24 * H) >= 1);
});

test('dueness caps at 10 and the interval caps at the last one', () => {
  const e = { k: [50, NOW] };
  assert.equal(dueness(e, 'k', NOW + 840 * H), 1);
  assert.equal(dueness(e, 'k', NOW + 1e6 * H), 10);
});

test('smartStartIndex starts just before the first due move', () => {
  const L = lines[0], k = edgeKeys(L), e = {};
  [1, 2].forEach(i => recordReview(e, k[i], NOW));
  assert.equal(smartStartIndex(L, e, NOW + H), 2);
  [3, 4].forEach(i => recordReview(e, k[i], NOW));
  assert.equal(smartStartIndex(L, e, NOW + H), 0, 'nothing due -> from the start');
});

test('linePriority sums only due moves', () => {
  const L = lines[0], k = edgeKeys(L), e = {};
  assert.equal(linePriority(L, e, NOW), 40);
  [1, 2, 3].forEach(i => recordReview(e, k[i], NOW));
  assert.equal(linePriority(L, e, NOW + H), 10);
});

test('smartOrder puts the line with most due work first', () => {
  const e = {}, k = edgeKeys(lines[0]);
  [1, 2, 3, 4].forEach(i => recordReview(e, k[i], NOW));
  const order = smartOrder(lines, e, NOW + H, () => 0);
  assert.deepEqual(order, [1, 0]);
});

test('shared moves count once in the due summary', () => {
  const keys = poolEdgeKeys(lines);
  assert.equal(keys.length, 5, 'e4 e5 Nf3 shared, then Nc6 / d6');
  const e = {};
  recordReview(e, keys[0], NOW);
  assert.deepEqual(dueSummary(keys, e, NOW + H), { due: 4, total: 5 });
});
