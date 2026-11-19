import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLines } from '../src/pgn.js';
import { buildRepIndex } from '../src/position.js';
import { lichessGamesUrl, parseLichessGames, mergeGames, gameText, summarize, shouldAutoCheck, AUTO_CHECK_GAP, gameKey, newestGame, migrateReview, addAccount, removeAccount, toReview, capReviewed, fetchMax } from '../src/review.js';

const g = (id, white, black, moves, extra = {}) => JSON.stringify({
  id, variant: 'standard', moves, createdAt: extra.t || 1,
  players: { white: { user: { name: white } }, black: black ? { user: { name: black } } : { aiLevel: 3 } },
  ...(extra.winner ? { winner: extra.winner } : {}),
});

test('lichessGamesUrl', () => {
  assert.equal(lichessGamesUrl('Some User', 100),
    'https://lichess.org/api/games/user/Some%20User?moves=true&tags=false&clocks=false&evals=false&opening=false&max=100');
  assert.match(lichessGamesUrl('u', 300, 42), /max=300&since=43$/);
});

test('parseLichessGames: colour, result, variants, anonymous/AI opponents, bad lines', () => {
  const nd = [
    g('a', 'Me', 'X', 'e4 e5', { t: 10, winner: 'white' }),
    g('b', 'X', 'me', 'd4 d5', { t: 30, winner: 'white' }),
    g('c', 'me', null, 'e4 c5', { t: 20 }),
    JSON.stringify({ id: 'd', variant: 'chess960', moves: 'e4', createdAt: 99, players: { white: { user: { name: 'me' } }, black: {} } }),
    g('e', 'Other', 'Person', 'e4', { t: 5 }),
    'not json', '',
  ].join('\n');
  const { games, last } = parseLichessGames(nd, 'ME');
  assert.deepEqual(games.map(x => [x.id, x.c, x.res]), [['a', 'w', 'w'], ['b', 'b', 'l'], ['c', 'w', 'd']]);
  assert.equal(last, 30);
});

test('mergeGames dedupes, sorts newest first and caps', () => {
  const old = [{ id: 'a', t: 1 }, { id: 'b', t: 3 }];
  const m = mergeGames(old, [{ id: 'b', t: 3 }, { id: 'c', t: 2 }], 2);
  assert.deepEqual(m.map(x => x.id), ['b', 'c']);
});

test('gameText', () => {
  assert.equal(gameText(['e4', 'e5', 'Nf3'], 3), '1.e4 e5 2.Nf3');
  assert.equal(gameText(['e4'], 0), 'start position');
});

test('summarize groups deviations by position and move with W/D/L', () => {
  const lines = buildLines('1. e4 e5 2. Nf3 Nc6 3. Bb5 *', 'w').lines;
  const R = { w: buildRepIndex(lines, 'w'), b: buildRepIndex(lines, 'b') };
  const games = [
    { id: '1', c: 'w', m: 'e4 e5 Nf3 Nc6 Bc4', res: 'w' },
    { id: '2', c: 'w', m: 'e4 e5 Nf3 Nc6 Bc4 Bc5', res: 'l' },
    { id: '3', c: 'w', m: 'e4 e5 Nf3 Nc6 Bb5 a6', res: 'd' },
    { id: '4', c: 'w', m: 'e4 c5', res: 'd' },
    { id: '5', c: 'w', m: 'e4 e5 Nf3 Nc6 Bb5', res: 'w' },
    { id: '6', c: 'w', m: 'd4 d5', res: 'w' },
  ];
  const s = summarize(games, c => R[c]);
  assert.equal(s.checked, 6); assert.equal(s.ok, 1);
  assert.deepEqual(s.rows.dev.map(o => [o.r.san, o.n]), [['Bc4', 2], ['d4', 1]]);
  const d = s.rows.dev[0];
  assert.equal(d.n, 2); assert.equal(d.w, 1); assert.equal(d.l, 1); assert.equal(d.txt, '1.e4 e5 2.Nf3 Nc6');
  assert.deepEqual(d.r.exp, ['Bb5']);
  assert.equal(s.rows.opp[0].r.san, 'c5');
  assert.equal(s.rows.end[0].r.san, 'a6'); assert.equal(s.rows.end[0].d, 1);
});

test('shouldAutoCheck: needs an account, a connection, and 5 minutes since the last check', () => {
  const now = 1_700_000_000_000, base = { user: 'me', online: true, lastCheck: 0, now };
  assert.equal(shouldAutoCheck(base), true);
  assert.equal(shouldAutoCheck({ ...base, user: '' }), false);
  assert.equal(shouldAutoCheck({ ...base, online: false }), false);
  assert.equal(shouldAutoCheck({ ...base, lastCheck: now - AUTO_CHECK_GAP + 1 }), false);
  assert.equal(shouldAutoCheck({ ...base, lastCheck: now - AUTO_CHECK_GAP }), true);
  assert.equal(shouldAutoCheck({ user: 'me', now }), true);
});

test('parsed games are tagged with the account (lowercase)', () => {
  const { games } = parseLichessGames(g('a', 'Me', 'X', 'e4 e5', { t: 1 }), 'ME');
  assert.equal(games[0].a, 'me');
});

test('mergeGames keeps a game between two of your accounts once per account', () => {
  const m = mergeGames([{ id: 'x', a: 'one', t: 1 }], [{ id: 'x', a: 'two', t: 1 }, { id: 'x', a: 'one', t: 1 }]);
  assert.deepEqual(m.map(gameKey).sort(), ['one:x', 'two:x']);
});

test('migrateReview turns older saved state into accounts + reviewed keys', () => {
  const m = migrateReview({ u: 'Bob', last: 9, games: [{ id: 'a', t: 4 }, { id: 'b', t: 9 }], mark: 5, viewed: true, view: 'new', auto: true });
  assert.deepEqual(m.accs, [{ u: 'Bob', last: 9 }]);
  assert.equal(m.games[0].a, 'bob');
  assert.deepEqual(m.reviewed, ['bob:a'], 'games up to the old "seen" mark count as reviewed');
  assert.equal(m.view, 'review');
  for (const k of ['u', 'last', 'mark', 'viewed', 'auto']) assert.equal(m[k], undefined, k);
  assert.deepEqual(migrateReview({}).reviewed, []);
  const already = { accs: [{ u: 'x', last: 1 }], games: [{ id: 'b', a: 'x', t: 1 }], reviewed: ['x:b'], view: 'all' };
  assert.deepEqual(migrateReview(already), already);
});

test('toReview hides reviewed games; capReviewed keeps the newest keys', () => {
  const gs = [{ id: '1', a: 'me' }, { id: '2', a: 'me' }, { id: '1', a: 'alt' }];
  assert.deepEqual(toReview(gs, new Set(['me:1'])).map(gameKey), ['me:2', 'alt:1']);
  assert.deepEqual(capReviewed(['a', 'b', 'c'], 2), ['b', 'c']);
});

test('fetchMax: 20 games when an account is first linked, up to 100 new ones afterwards', () => {
  assert.equal(fetchMax({ u: 'x', last: 0 }), 20);
  assert.equal(fetchMax({ u: 'x', last: 123 }), 100);
});

test('summarize lists the games behind each row', () => {
  const lines = buildLines('1. e4 e5 2. Nf3 Nc6 3. Bb5 *', 'w').lines;
  const R = buildRepIndex(lines, 'w');
  const s = summarize([{ id: '1', a: 'me', c: 'w', m: 'e4 e5 Nf3 Nc6 Bc4', res: 'w' }, { id: '2', a: 'alt', c: 'w', m: 'e4 e5 Nf3 Nc6 Bc4', res: 'l' }], () => R);
  assert.deepEqual(s.rows.dev[0].ids, ['me:1', 'alt:2']);
});

test('addAccount ignores blanks and duplicates (any case); removeAccount drops its games', () => {
  const a = addAccount([], ' Bob ');
  assert.deepEqual(a, [{ u: 'Bob', last: 0 }]);
  assert.equal(addAccount(a, 'BOB'), null);
  assert.equal(addAccount(a, '  '), null);
  const b = addAccount(a, 'Alt');
  const r = removeAccount({ accs: b, games: [{ id: '1', a: 'bob' }, { id: '2', a: 'alt' }] }, 'BOB');
  assert.deepEqual(r.accs.map(x => x.u), ['Alt']); assert.deepEqual(r.games.map(x => x.id), ['2']);
});

test('newestGame', () => {
  assert.equal(newestGame([]), 0);
  assert.equal(newestGame([{ t: 3 }, { t: 7 }, { t: 5 }]), 7);
});
