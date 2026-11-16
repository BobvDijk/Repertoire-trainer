// Lichess game review: fetch URL, NDJSON parsing, merging, and grouping of the
// points where games left the repertoire.
import { analyzeGame } from './position.js';

export function lichessGamesUrl(user, max, since = 0) {
  return 'https://lichess.org/api/games/user/' + encodeURIComponent(user) +
    '?moves=true&tags=false&clocks=false&evals=false&opening=false&max=' + max +
    (since ? '&since=' + (since + 1) : '');
}

/**
 * Parse the Lichess NDJSON export into compact games for `user`:
 * {id, c:'w'|'b', m:'e4 e5 ...', t:createdAt, res:'w'|'d'|'l'}. Skips variants and
 * games without moves. Returns {games, last} where last = newest createdAt seen.
 */
export function parseLichessGames(ndjson, user, last = 0) {
  const games = [], lc = user.toLowerCase();
  for (const ln of ndjson.split('\n')) {
    if (!ln.trim()) continue;
    let j; try { j = JSON.parse(ln); } catch (e) { continue; }
    if (j.variant !== 'standard' || !j.moves) continue;
    const nm = p => p && p.user && p.user.name.toLowerCase();
    const w = nm(j.players.white) === lc;
    if (!w && nm(j.players.black) !== lc) continue;
    games.push({ id: j.id, c: w ? 'w' : 'b', m: j.moves, t: j.createdAt,
      res: !j.winner ? 'd' : ((j.winner === 'white') === w ? 'w' : 'l') });
    last = Math.max(last, j.createdAt);
  }
  return { games, last };
}

/** Add new games to stored ones (deduplicated by id, newest first, capped). */
export function mergeGames(old, add, cap = 1500) {
  const ids = new Set(old.map(g => g.id));
  return add.filter(g => !ids.has(g.id)).concat(old).sort((a, b) => b.t - a.t).slice(0, cap);
}

/** "1.e4 e5 2.Nf3" for the first n plies of a game. */
export const gameText = (mv, n) =>
  mv.slice(0, n).map((s, i) => (i % 2 ? '' : (i / 2 + 1) + '.') + s).join(' ') || 'start position';

/**
 * Analyse games against the repertoire. repFor(color) returns a buildRepIndex result.
 * Returns {checked, ok, rows:{dev,opp,end}} with rows grouped by position+move and sorted
 * by frequency: {r: analysis, c, id, n, w, d, l, txt}.
 */
export function summarize(games, repFor) {
  const A = { dev: {}, opp: {}, end: {} };
  let ok = 0, checked = 0;
  for (const g of games) {
    const r = analyzeGame(repFor(g.c), g);
    if (!r) continue;
    checked++;
    if (r.t === 'ok') { ok++; continue; }
    const k = r.key + '|' + r.san;
    const o = A[r.t][k] || (A[r.t][k] = { r, c: g.c, id: g.id, n: 0, w: 0, d: 0, l: 0, txt: gameText(g.m.split(' '), r.ply) });
    o.n++; o[g.res]++;
  }
  const rows = {};
  for (const t of ['dev', 'opp', 'end']) rows[t] = Object.values(A[t]).sort((x, y) => y.n - x.n);
  return { checked, ok, rows };
}

/** Minimum time between automatic checks, so switching apps back and forth doesn't hammer Lichess. */
export const AUTO_CHECK_GAP = 5 * 60e3;

/** Should the app quietly check Lichess for new games now? */
export function shouldAutoCheck({ user, enabled, online, lastCheck = 0, now = Date.now() }) {
  return !!user && enabled !== false && online !== false && now - lastCheck >= AUTO_CHECK_GAP;
}

/** Games played after the "seen up to" mark (createdAt ms). */
export const newGames = (games, mark = 0) => games.filter(g => g.t > mark);

/**
 * Move the "new" mark after a fetch that added `added` games. If you looked at the review
 * since the last batch arrived (viewed), that batch becomes old: the mark moves to the newest
 * game before this fetch. If you haven't looked yet, the mark stays so unseen batches add up.
 */
export function advanceMark({ mark = 0, viewed = false }, prevLast, added) {
  if (!added || !viewed) return { mark, viewed };
  return { mark: prevLast, viewed: false };
}
