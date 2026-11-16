// PGN parsing: split a file into games, parse movetext (with variations,
// comments and [%cal]/[%csl] annotations) into a tree, and flatten it into lines.
import { hid } from './position.js';

/** Split PGN text into games: [{h: {Tag: value}, m: movetext}]. */
export function splitGames(text) {
  const gs = [];
  let g = { h: {}, m: '' }, inM = false;
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const l = raw.trim();
    if (l[0] === '[' && /^\[\w+\s+"/.test(l)) {
      if (inM) { gs.push(g); g = { h: {}, m: '' }; inM = false; }
      const m = l.match(/^\[(\w+)\s+"(.*)"\]/);
      if (m) g.h[m[1]] = m[2];
    } else if (l) { inM = true; g.m += l + '\n'; }
  }
  if (inM) gs.push(g);
  return gs;
}

/**
 * Parse movetext into a tree of {san, ch: children, c: comment, a?: arrows/circles}.
 * The root holds any comment before the first move. Variations "(...)" become siblings
 * of the move they replace. NAGs, move numbers and results are ignored; !/? suffixes are
 * stripped; 0-0 / 0-0-0 are normalised to O-O / O-O-O.
 */
export function parseMoveTree(txt) {
  const root = { ch: [], c: '' };
  let cur = root, lp = null;
  const st = [];
  const re = /\{([^}]*)\}|;[^\n]*|\(|\)|\$\d+|\d+\.+|1-0|0-1|1\/2-1\/2|\*|([^\s(){}$;]+)/g;
  let t;
  while ((t = re.exec(txt))) {
    const x = t[0];
    if (t[1] !== undefined) {
      const m = [...t[1].matchAll(/\[%(?:cal|csl)\s+([^\]]*)\]/g)];
      if (m.length) cur.a = (cur.a || '') + m.map(x => x[1]).join(',') + ',';
      cur.c += t[1].replace(/\[%[^\]]*\]/g, '').trim() + ' ';
    } else if (x === '(') { if (lp) { st.push([cur, lp]); cur = lp; } }
    else if (x === ')') { if (st.length) [cur, lp] = st.pop(); }
    else if (t[2]) {
      const san = t[2].replace(/[!?]+$/, '').replace(/^0-0-0/, 'O-O-O').replace(/^0-0/, 'O-O');
      if (!san || /^e\.?p\.?$/i.test(san)) continue;
      const n = { san, ch: [], c: '' };
      cur.ch.push(n); lp = cur; cur = n;
    }
  }
  return root;
}

/** All root-to-leaf paths (arrays of nodes) of a move tree. */
export function leafPaths(root) {
  const out = [];
  const walk = (n, path) => {
    if (!n.ch.length) { if (path.length) out.push(path); return; }
    for (const c of n.ch) walk(c, [...path, c]);
  };
  walk(root, []);
  return out;
}

/**
 * Keep only the main (first) move wherever `side` is to move, dropping the alternative moves
 * for that side and everything after them. The opponent's alternatives are all kept.
 * firstToMove is the side to move at the root. Returns how many alternative moves were dropped.
 */
export function pruneAlternatives(root, side, firstToMove = 'w') {
  let dropped = 0;
  const walk = (n, toMove) => {
    if (toMove === side && n.ch.length > 1) { dropped += n.ch.length - 1; n.ch = [n.ch[0]]; }
    const next = toMove === 'w' ? 'b' : 'w';
    for (const c of n.ch) walk(c, next);
  };
  walk(root, firstToMove);
  return dropped;
}

/** Chapter name from PGN headers. */
export function chapterName(h, gi) {
  if (h.Event && h.Event !== '?') return h.Event;
  if (h.White && h.White !== '?') return h.White + ' – ' + (h.Black || '');
  return 'Game ' + (gi + 1);
}

/**
 * Turn a PGN into chapters and lines for one side ('w' | 'b').
 * Each game becomes a chapter; each root-to-leaf path becomes a line.
 * chapterOffset is the index of the first chapter (chapters of both sides share one list).
 * opts.mainOnly: skip alternative moves for `side` (see pruneAlternatives); the number of
 * skipped moves is returned as `skipped`.
 */
export function buildLines(text, side, chapterOffset = 0, opts = {}) {
  let skipped = 0;
  const chapters = [], lines = [], pre = side === 'b' ? '♚ ' : '♔ ';
  splitGames(text).forEach((g, gi) => {
    const h = g.h, root = parseMoveTree(g.m);
    if (opts.mainOnly) skipped += pruneAlternatives(root, side, (h.FEN || '').split(' ')[1] === 'b' ? 'b' : 'w');
    const paths = leafPaths(root);
    if (!paths.length) return;
    const name = chapterName(h, gi);
    const ci = chapterOffset + chapters.length;
    chapters.push({ name: pre + name, count: paths.length });
    paths.forEach((p, k) => lines.push({
      id: hid(side + name + '|' + p.map(n => n.san).join(' ')),
      g: ci, k: k + 1, of: paths.length, name: pre + name, side,
      sans: p.map(n => n.san),
      cm: [root.c.trim(), ...p.map(n => n.c.trim())],
      ar: [root.a || '', ...p.map(n => n.a || '')],
      fen: h.FEN, or: side === 'b' ? 'black' : 'white',
    }));
  });
  return { chapters, lines, skipped };
}

/** Recount lines per chapter after lines were removed: sets line.k / line.of and chapter.count. */
export function renumber(lines, chapters) {
  const n = chapters.map(() => 0);
  for (const l of lines) l.k = ++n[l.g];
  for (const l of lines) l.of = n[l.g];
  chapters.forEach((c, i) => { c.count = n[i]; });
}
