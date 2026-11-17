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
    chapters.push({ name: pre + name, count: paths.length, h: { ...h }, side });
    paths.forEach((p, k) => lines.push({
      id: hid(side + name + '|' + p.map(n => n.san).join(' ')),
      g: ci, k: k + 1, of: paths.length, name: pre + name, cn: name, side,
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

/* ---------- writing PGN ---------- */

/** "{text [%csl Gd4] [%cal Gc2c3]}" from a comment and the stored arrow string ("Gc2c3,Gd4,"). */
function commentToken(c, a) {
  const parts = [], t = (a || '').split(',').map(x => x.trim()).filter(Boolean);
  c = (c || '').trim();
  if (c) parts.push(c.replace(/[{}]/g, ''));
  const csl = t.filter(x => x.length === 3), cal = t.filter(x => x.length === 5);
  if (csl.length) parts.push('[%csl ' + csl.join(',') + ']');
  if (cal.length) parts.push('[%cal ' + cal.join(',') + ']');
  return parts.length ? '{' + parts.join(' ') + '}' : '';
}

/** Merge a chapter's lines (in order, so the first line is the main line) back into a move tree. */
export function linesToTree(ls) {
  const root = { ch: [], c: ls[0].cm[0] || '', a: ls[0].ar[0] || '' };
  for (const l of ls) {
    let n = root;
    l.sans.forEach((san, i) => {
      let c = n.ch.find(x => x.san === san);
      if (!c) n.ch.push(c = { san, ch: [], c: l.cm[i + 1] || '', a: l.ar[i + 1] || '' });
      n = c;
    });
  }
  return root;
}

/** PGN movetext for a move tree: first child = main line, other children = variations. */
export function treeToMovetext(root, blackFirst = false, firstNum = 1) {
  const out = [], off = blackFirst ? 1 : 0;
  const num = (ply, force) => {
    const p = ply + off, n = firstNum + Math.floor(p / 2);
    return p % 2 === 0 ? n + '.' : force ? n + '...' : '';
  };
  const emit = (node, ply, force) => {
    const lb = num(ply, force);
    out.push((lb ? lb + ' ' : '') + node.san); // keep the number and its move on one row
    const cm = commentToken(node.c, node.a);
    if (cm) out.push(cm);
    return !!cm;
  };
  const walk = (n, ply, force) => {
    while (n.ch.length) {
      const [main, ...alts] = n.ch;
      const hadComment = emit(main, ply, force);
      for (const a of alts) {
        out.push('(');
        walk(a, ply + 1, emit(a, ply, true));
        out.push(')');
      }
      force = hadComment || alts.length > 0;
      n = main; ply++;
    }
  };
  const rc = commentToken(root.c, root.a);
  if (rc) out.push(rc);
  walk(root, 0, true);
  out.push('*');
  // wrap at ~80 columns between tokens (comments are never split)
  const rows = [];
  let row = '';
  for (const t of out) {
    const glue = !row || row.endsWith('(') || t === ')' ? '' : ' ';
    if (row && glue && row.length + 1 + t.length > 80) { rows.push(row); row = t; } else row += glue + t;
  }
  if (row) rows.push(row);
  return rows.join('\n');
}

/**
 * Write a repertoire back to PGN: one game per chapter that still has lines of `side`, with the
 * chapter's original headers (Event added if it had none, SetUp added for a FEN).
 */
export function writePgn(lines, chapters, side) {
  const games = [];
  chapters.forEach((ch, gi) => {
    const ls = lines.filter(l => l.g === gi && l.side === side);
    if (!ls.length) return;
    const h = { ...(ch.h || {}) };
    if (!h.Event || h.Event === '?') h.Event = ls[0].cn || ch.name.replace(/^[♔♚] /, '');
    if (h.FEN && !h.SetUp) h.SetUp = '1';
    if (!h.Result) h.Result = '*';
    const f = (h.FEN || '').split(' ');
    const head = Object.entries(h).map(([k, v]) => '[' + k + ' "' + String(v).replace(/"/g, "'") + '"]').join('\n');
    games.push(head + '\n\n' + treeToMovetext(linesToTree(ls), f[1] === 'b', parseInt(f[5]) || 1));
  });
  return games.join('\n\n') + '\n';
}
