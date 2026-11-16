import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLines } from '../src/pgn.js';
import { buildRepIndex } from '../src/position.js';
import { lichessGamesUrl, parseLichessGames, mergeGames, gameText, summarize, shouldAutoCheck, AUTO_CHECK_GAP } from '../src/review.js';

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

test('shouldAutoCheck: needs a username, the setting on, a connection, and 5 minutes since the last check', () => {
  const now = 1_700_000_000_000, base = { user: 'me', enabled: true, online: true, lastCheck: 0, now };
  assert.equal(shouldAutoCheck(base), true);
  assert.equal(shouldAutoCheck({ ...base, user: '' }), false);
  assert.equal(shouldAutoCheck({ ...base, enabled: false }), false);
  assert.equal(shouldAutoCheck({ ...base, online: false }), false);
  assert.equal(shouldAutoCheck({ ...base, lastCheck: now - AUTO_CHECK_GAP + 1 }), false);
  assert.equal(shouldAutoCheck({ ...base, lastCheck: now - AUTO_CHECK_GAP }), true);
  assert.equal(shouldAutoCheck({ user: 'me', now }), true, 'on by default');
});
