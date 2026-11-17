// Position graph: stable position keys, line preparation (SAN -> moves/FENs),
// and the per-colour repertoire index used by game review and the quiz.
import { Chess } from '../vendor/chess.mjs';

/** djb2 string hash, base-36. Used for line ids and position keys. */
export const hid = s => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

/** Position key: placement + side to move + castling (ignores e.p./clocks), so transpositions match. */
export const posKey = fen => {
  const s = fen.split(' ').slice(0, 3).join(' ');
  return hid(s) + hid(s.split('').reverse().join(''));
};

/** Strip check/mate markers so "Nf3+" and "Nf3" compare equal. */
export const stripCheck = s => s.replace(/[+#]/g, '');

/** Play a line's SAN moves once and cache positions (L.pos), moves (L.mv), L.n, L.black, L.num, L.bad. */
export function prepare(L) {
  if (L.pos) return L;
  let ch = new Chess();
  // An invalid [FEN] header would leave chess.js with an empty board: use the start position instead.
  if (L.fen && ch.validate_fen(L.fen).valid) ch = new Chess(L.fen);
  L.pos = [ch.fen()]; L.mv = [null]; L.black = ch.turn() === 'b';
  L.num = parseInt(ch.fen().split(' ')[5]) || 1; L.bad = false;
  for (const s of L.sans) {
    const m = ch.move(s, { sloppy: true });
    if (!m) { L.bad = true; break; }
    L.pos.push(ch.fen()); L.mv.push(m);
  }
  L.n = L.mv.length - 1;
  return L;
}

/** Position keys for every ply of a line (index 0 = start). */
export function posKeys(L) { prepare(L); return L.pk || (L.pk = L.pos.map(posKey)); }

/** Edge keys "positionKey+SAN" for each move (index 0 = ''). Used by Smart review. */
export function edgeKeys(L) {
  const k = posKeys(L);
  return L.ek || (L.ek = ['', ...L.mv.slice(1).map((m, i) => k[i] + m.san)]);
}

/** Move-number text for the first j plies of a line, e.g. "1.e4 e5 2.Nf3". */
export function pathText(L, j) {
  let h = '', num = L.num;
  for (let i = 1; i <= j; i++) {
    const w = ((i - 1) + (L.black ? 1 : 0)) % 2 === 0;
    if (w) h += num + '.'; else { if (i === 1) h += num + '…'; num++; }
    h += L.mv[i].san + ' ';
  }
  return h.trim() || 'Start position';
}

/** Is ply i (1-based) of a line a white move? */
export const isWhitePly = (L, i) => ((i - 1) + (L.black ? 1 : 0)) % 2 === 0;
/** Full-move number of ply i. */
export const plyNumber = (L, i) => L.num + Math.floor((i - 1 + (L.black ? 1 : 0)) / 2);

/**
 * Repertoire index for one colour: for every position, which moves the repertoire
 * plays/expects (moves: Map<posKey, Map<san,1>>), and which positions end a line.
 * Lines without a side are included for both colours.
 */
export function buildRepIndex(lines, color) {
  const moves = new Map(), ends = new Set();
  for (const l of lines) {
    if (l.side && l.side !== color) continue;
    const K = posKeys(l);
    for (let i = 0; i < l.n; i++) {
      let m = moves.get(K[i]);
      if (!m) moves.set(K[i], m = new Map());
      m.set(stripCheck(l.mv[i + 1].san), 1);
    }
    ends.add(K[l.n]);
  }
  return { moves, ends };
}

/**
 * Follow a game through the repertoire index. Returns {t:'ok'} if it never left,
 * {t:'dev'|'opp'|'end', ...} for the first point it left, or null if the game never
 * touched the repertoire (or has an illegal move).
 *   dev = I played a move my repertoire doesn't have
 *   opp = opponent played a move my repertoire doesn't cover
 *   end = the game continued past the end of one of my lines
 * g = {c:'w'|'b', m:'e4 e5 Nf3 ...'}
 */
export function analyzeGame(R, g) {
  const ch = new Chess(), mv = g.m.split(' ');
  let key = posKey(ch.fen());
  for (let i = 0; i < mv.length; i++) {
    const exp = R.moves.get(key), fb = ch.fen(), m = ch.move(mv[i], { sloppy: true });
    if (!m) return null;
    if (exp && exp.has(stripCheck(m.san))) { key = posKey(ch.fen()); continue; }
    const mine = (i % 2 === 0) === (g.c === 'w');
    const t = exp ? (mine ? 'dev' : 'opp') : (R.ends.has(key) ? 'end' : null);
    if (!t) return null;
    return { t, key, fen: fb, ply: i, san: m.san, from: m.from, to: m.to, mine, exp: exp ? [...exp.keys()] : [] };
  }
  return { t: 'ok' };
}

/** Find the first line passing through a position key (optionally preferring a side). */
export function lineThrough(lines, key, side) {
  return (side && lines.find(l => l.side === side && posKeys(l).includes(key))) ||
    lines.find(l => posKeys(l).includes(key));
}

/**
 * Merge lines into a position graph per starting position:
 * Map<rootKey, {g: Map<posKey, Map<san, childKey>>, black, num, sd}>.
 */
export function buildGraph(lines, sd = '') {
  const roots = new Map();
  for (const l of lines) {
    const K = posKeys(l);
    let r = roots.get(K[0]);
    if (!r) roots.set(K[0], r = { g: new Map(), black: l.black, num: l.num, sd });
    for (let i = 0; i < l.n; i++) {
      let nd = r.g.get(K[i]);
      if (!nd) r.g.set(K[i], nd = new Map());
      nd.set(l.mv[i + 1].san, K[i + 1]);
    }
  }
  return roots;
}

/**
 * Spanning tree over a position graph from `key`. Transpositions into a position that
 * was already visited become `refs` instead of being expanded again.
 */
export function spanTree(g, key, vis = new Set([key]), d = 0) {
  const n = { key, kids: [], refs: [], d }, e = g.get(key);
  if (e) for (const [san, ck] of e) {
    if (vis.has(ck)) n.refs.push({ san, key: ck, d: d + 1 });
    else { vis.add(ck); const c = spanTree(g, ck, vis, d + 1); c.san = san; n.kids.push(c); }
  }
  return n;
}

/** A copy of a line cut down to its first m moves (cached positions dropped, new id). */
export function truncateLine(L, m) {
  const { pos, mv, pk, ek, n, black, num, bad, ...rest } = L;
  const sans = L.sans.slice(0, m);
  // same id formula as buildLines, so the line keeps its id after exporting and re-importing
  return { ...rest, sans, cm: L.cm.slice(0, m + 1), ar: L.ar.slice(0, m + 1), id: hid(L.side + (L.cn ?? L.name) + '|' + sans.join(' ')) };
}

/**
 * Remove moves from a repertoire. `removed` is a Set of edge keys (see edgeKeys): a move in a
 * given position, so the move disappears whatever move order reaches that position.
 * Lines through a removed move are cut just before it; a cut line that is now empty, a duplicate,
 * or the start of another line in the same chapter is dropped. Untouched lines are returned as is
 * (same objects and ids, so progress is kept). Returns {lines, changed: number of lines affected}.
 */
export function removeMoves(lines, removed) {
  if (!removed || !removed.size) return { lines, changed: 0 };
  let changed = 0;
  const out = [];
  for (const l of lines) {
    const ek = edgeKeys(l);
    let c = -1;
    for (let i = 1; i <= l.n; i++) if (removed.has(ek[i])) { c = i; break; }
    if (c < 0) { out.push(l); continue; }
    changed++;
    if (c > 1) { const t = truncateLine(l, c - 1); t.cut = true; out.push(t); }
  }
  const seen = new Set();
  const covered = t => {
    const s = t.sans.join(' ');
    return out.some(o => o !== t && o.g === t.g && o.sans.length > t.sans.length && o.sans.slice(0, t.sans.length).join(' ') === s);
  };
  return {
    changed,
    lines: out.filter(l => {
      if (!l.cut) return true;
      const k = l.g + '|' + l.sans.join(' ');
      if (seen.has(k) || covered(l)) return false;
      seen.add(k); delete l.cut; return true;
    }),
  };
}
