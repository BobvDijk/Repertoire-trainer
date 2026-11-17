import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeProgress, sameProgress, decide, createSync, SYNC_KEYS } from '../src/sync.js';

test('mergeProgress unions seen sets and keeps the latest review per move', () => {
  const a = { seen: ['l1', 'l2'], pos: ['p1'], edges: { e1: [2, 100], e2: [1, 50] }, resetAt: 0 };
  const b = { seen: ['l2', 'l3'], pos: ['p2'], edges: { e1: [1, 200], e3: [1, 10] }, resetAt: 0 };
  assert.deepEqual(mergeProgress(a, b), { seen: ['l1', 'l2', 'l3'], pos: ['p1', 'p2'], edges: { e1: [1, 200], e2: [1, 50], e3: [1, 10] }, resetAt: 0 });
});

test('mergeProgress: a more recent reset wins outright', () => {
  const old = { seen: ['l1'], pos: ['p1'], edges: { e1: [3, 100] }, resetAt: 0 };
  const reset = { seen: ['l9'], pos: [], edges: {}, resetAt: 500 };
  assert.deepEqual(mergeProgress(old, reset), { seen: ['l9'], pos: [], edges: {}, resetAt: 500 });
  assert.deepEqual(mergeProgress(reset, old), mergeProgress(old, reset));
  assert.deepEqual(mergeProgress(null, undefined), { seen: [], pos: [], edges: {}, resetAt: 0 });
});

test('sameProgress ignores order', () => {
  assert.ok(sameProgress({ seen: ['b', 'a'], edges: { y: [1, 1], x: [1, 2] } }, { seen: ['a', 'b'], pos: [], edges: { x: [1, 2], y: [1, 1] }, resetAt: 0 }));
  assert.ok(!sameProgress({ seen: ['a'] }, { seen: ['b'] }));
});

test('decide: newest change wins for repertoires and settings', () => {
  assert.deepEqual(decide('pgn-w', { v: 'old', t: 1 }, { v: 'new', t: 2 }), { apply: 'new' });
  assert.deepEqual(decide('pgn-w', { v: 'mine', t: 3 }, { v: 'theirs', t: 2 }), { push: 'mine' });
  assert.deepEqual(decide('pgn-w', { v: 'same', t: 1 }, { v: 'same', t: 2 }), {});
  assert.deepEqual(decide('state', { v: { a: 1 }, t: 5 }, null), { push: { a: 1 } });
  assert.deepEqual(decide('pgn-b', { v: '', t: 0 }, null), { push: undefined }, 'nothing to upload from an empty new device');
  assert.deepEqual(decide('pgn-w', { v: 'local only, never synced', t: 0 }, { v: 'account', t: 1 }), { apply: 'account' }, 'a new device takes the account data');
});

test('decide: progress is merged both ways', () => {
  const r = decide('progress', { v: { seen: ['a'] }, t: 1 }, { v: { seen: ['b'] }, t: 1 });
  assert.deepEqual(r.apply.seen, ['a', 'b']); assert.deepEqual(r.push.seen, ['a', 'b']);
  const same = decide('progress', { v: { seen: ['a'] }, t: 1 }, { v: { seen: ['a'], pos: [], edges: {}, resetAt: 0 }, t: 1 });
  assert.equal(same.apply, undefined); assert.equal(same.push, undefined);
});

// Two devices against one fake server
function fakeServer() {
  const docs = {}, subs = new Set();
  return {
    docs,
    backend: () => ({
      pull: async () => JSON.parse(JSON.stringify(docs)),
      push: async (k, d) => { docs[k] = { ...d }; for (const cb of subs) cb(k, { ...d }); },
      subscribe: cb => { subs.add(cb); return () => subs.delete(cb); },
    }),
  };
}
function device(server, name, data, clock) {
  const store = { ...data }, times = {};
  const s = createSync({
    backend: server.backend(), device: name, now: () => clock.t,
    read: k => store[k], write: (k, v) => { store[k] = v; },
    meta: { get: k => times[k], set: (k, t) => { times[k] = t; } },
    delays: { progress: 0, default: 0 },
  });
  return { s, store, times };
}
const tick = () => new Promise(r => setTimeout(r, 5));

test('first device uploads, second device receives, edits flow both ways live', async () => {
  const server = fakeServer(), clock = { t: 1000 };
  const empty = { 'pgn-w': '', 'pgn-b': '', state: {}, progress: { seen: [], pos: [], edges: {}, resetAt: 0 } };
  const A = device(server, 'A', { ...empty, 'pgn-w': '1. e4 *', state: { spd: 2 }, progress: { seen: ['l1'], pos: [], edges: {}, resetAt: 0 } }, clock);
  A.times['pgn-w'] = 900; A.times.state = 900;
  await A.s.syncAll();
  assert.equal(JSON.parse(server.docs['pgn-w'].json), '1. e4 *');
  assert.equal(server.docs['pgn-b'], undefined, 'empty Black repertoire not uploaded');

  const B = device(server, 'B', empty, clock);
  await B.s.syncAll();
  assert.equal(B.store['pgn-w'], '1. e4 *');
  assert.deepEqual(B.store.state, { spd: 2 });
  assert.deepEqual(B.store.progress.seen, ['l1']);

  // B changes settings and trains; A gets both while open
  clock.t = 2000;
  B.store.state = { spd: 1 }; B.s.dirty('state');
  B.store.progress = { ...B.store.progress, seen: ['l1', 'l2'] }; B.s.dirty('progress');
  await tick(); await tick();
  assert.deepEqual(A.store.state, { spd: 1 });
  assert.deepEqual(A.store.progress.seen, ['l1', 'l2']);

  // A imports a Black repertoire; B gets it
  clock.t = 3000;
  A.store['pgn-b'] = '1. e4 c5 *'; A.s.dirty('pgn-b');
  await tick(); await tick();
  assert.equal(B.store['pgn-b'], '1. e4 c5 *');
  A.s.stop(); B.s.stop();
});

test('progress made on two devices while one was offline is merged on the next sync', async () => {
  const server = fakeServer(), clock = { t: 1000 };
  const p = seen => ({ seen, pos: [], edges: {}, resetAt: 0 });
  const A = device(server, 'A', { 'pgn-w': '', 'pgn-b': '', state: {}, progress: p(['a']) }, clock);
  await A.s.syncAll(); A.s.stop();
  const B = device(server, 'B', { 'pgn-w': '', 'pgn-b': '', state: {}, progress: p(['b']) }, clock);
  await B.s.syncAll(); B.s.stop();
  assert.deepEqual(B.store.progress.seen, ['a', 'b']);
  assert.deepEqual(JSON.parse(server.docs.progress.json).seen, ['a', 'b']);
  const A2 = device(server, 'A', { 'pgn-w': '', 'pgn-b': '', state: {}, progress: p(['a', 'c']) }, clock);
  await A2.s.syncAll(); A2.s.stop();
  assert.deepEqual(A2.store.progress.seen, ['a', 'b', 'c']);
});

test('nothing is uploaded when the value equals what the server has', async () => {
  const server = fakeServer(), clock = { t: 1000 };
  let pushes = 0; const be = server.backend; server.backend = () => { const b = be(); const p = b.push; b.push = (...a) => { pushes++; return p(...a); }; return b; };
  const A = device(server, 'A', { 'pgn-w': 'x', 'pgn-b': '', state: {}, progress: {} }, clock);
  A.times['pgn-w'] = 5;
  await A.s.syncAll(); const after = pushes;
  A.s.dirty('pgn-w'); await tick();
  assert.equal(pushes, after);
  A.s.stop();
});

test('documents larger than Firestore allows are not uploaded', async () => {
  const server = fakeServer(), clock = { t: 1 }, msgs = [];
  const s = createSync({ backend: server.backend(), device: 'A', now: () => clock.t, read: () => 'x'.repeat(1_000_000), write: () => {},
    meta: { get: () => 1, set: () => {} }, status: m => msgs.push(m), delays: { default: 0, progress: 0 } });
  await s.syncAll();
  assert.equal(server.docs['pgn-w'], undefined);
  assert.ok(msgs.some(m => /Too large/.test(m)));
  s.stop();
});

test('keys', () => assert.deepEqual(SYNC_KEYS, ['pgn-w', 'pgn-b', 'state', 'progress']));
