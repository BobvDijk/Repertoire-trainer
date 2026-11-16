// UI: wires the pure modules to the page. Ported from the original single-file version.
import { Chess } from '../vendor/chess.mjs';
import { buildLines } from './pgn.js';
import { posKey, prepare, posKeys, edgeKeys, pathText, isWhitePly, plyNumber,
  buildRepIndex, lineThrough, buildGraph, spanTree } from './position.js';
import { linePriority, smartStartIndex, recordReview, smartOrder, poolEdgeKeys, dueSummary } from './smart.js';
import { lichessGamesUrl, parseLichessGames, mergeGames, summarize, shouldAutoCheck, newGames, advanceMark } from './review.js';
import * as Q from './quiz.js';
import { unlockAudio, thump, speak } from './effects.js';

let pw = null;
const $ = s => document.querySelector(s) || (pw && pw.document.querySelector(s));
let lines = [], chapters = [], pool = [], order = [], oi = 0, mi = 0, cur = null, playing = false, timer = null, flip = false, lastG = -1, wake = null;

/* ---------- storage ---------- */
const load = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* full or blocked */ } };
const S = { spd: 2, pau: 3, shuf: false, loop: true, stay: false, skip: true, mode: 'full', snd: false, say: false, ...load('rp-set', {}) };
const save = () => store('rp-set', S);
const seen = new Set(load('rp-seen', []));
const saveSeen = () => store('rp-seen', [...seen]);
const seenPos = new Set(load('rp-pos', []));
const savePos = () => store('rp-pos', [...seenPos]);
let edges = load('rp-edges', {});
const saveEdges = () => store('rp-edges', edges);
addEventListener('pagehide', saveEdges);

/* ---------- line selection ---------- */
function startIdx(l) { const k = posKeys(l); for (let i = 1; i <= l.n; i++) if (!seenPos.has(k[i])) return i - 1; return -1; }
const done = l => seen.has(l.id) || (S.mode === 'branch' && startIdx(l) < 0);
function skipDone() { if (S.mode === 'branch' && S.skip && !anchor) while (oi + 1 < order.length && startIdx(pool[order[oi]]) < 0) oi++; }
let PE = null, anchor = null, baseCi = -1, exKids = [], sel = null;
const base = () => baseCi < 0 ? lines : lines.filter(l => l.g === baseCi);

function setAnchor(L, j) {
  const k = posKeys(L)[j], m = new Map(), arr = [];
  for (const l of base()) { const i = posKeys(l).indexOf(k); if (i >= 0) { m.set(l, i); arr.push(l); } }
  anchor = { k, L, j, m }; pool = arr; PE = null; mkOrder();
  const p = order.indexOf(pool.indexOf(L)); oi = p >= 0 ? p : 0; loadLine();
}
function renderEx() {
  const on = !!anchor;
  $('#exback').classList.toggle('hide', !on || anchor.j < 1); $('#exoff').classList.toggle('hide', !on);
  if (!on) { exKids = []; $('#expath').textContent = 'Tap a piece, then a square, to follow a move in your repertoire — or press ⚓ to explore from here.'; $('#exmv').innerHTML = ''; return; }
  const g = {}; let ends = 0;
  anchor.m.forEach((i, l) => { if (i >= l.n) { ends++; return; } const s = l.mv[i + 1].san; (g[s] = g[s] || { n: 0, l, i, s }).n++; });
  exKids = Object.values(g).sort((a, b) => b.n - a.n);
  $('#expath').textContent = pathText(anchor.L, anchor.j) + ' · ' + pool.length + (pool.length === 1 ? ' line' : ' lines') + (ends ? ' · ' + ends + ' end here' : '');
  $('#exmv').innerHTML = exKids.map((c, x) => '<button data-k="' + x + '" style="padding:4px 10px">' + c.s + ' <span class="sub">×' + c.n + '</span></button>').join('') || '<span class="sub">No further moves from here.</span>';
}
function updProg() {
  if (S.mode === 'smart') { const d = dueSummary(PE || (PE = poolEdgeKeys(pool)), edges); $('#prog').textContent = d.due + ' of ' + d.total + ' moves due for review'; return; }
  const n = pool.filter(l => seen.has(l.id)).length; $('#prog').textContent = 'Seen ' + n + ' of ' + pool.length + ' lines';
}

/* ---------- effects ---------- */
function fx(m) { if (!m) return; if (S.snd) thump(/x/.test(m.san)); if (S.say) speak(m.san); }
function slide(m) {
  const b = $('#board'), dur = Math.min(260, S.spd * 700), pairs = [[m.from, m.to]];
  if (m.flags.includes('k')) pairs.push(m.color === 'w' ? ['h1', 'f1'] : ['h8', 'f8']);
  else if (m.flags.includes('q')) pairs.push(m.color === 'w' ? ['a1', 'd1'] : ['a8', 'd8']);
  pairs.forEach(([a, z]) => {
    const A = b.querySelector('[data-s="' + a + '"]'), Z = b.querySelector('[data-s="' + z + '"]'), sv = Z && Z.querySelector('svg');
    if (!A || !sv) return;
    const ra = A.getBoundingClientRect(), rz = Z.getBoundingClientRect();
    sv.style.transition = 'none'; sv.style.transform = 'translate(' + (ra.left - rz.left) + 'px,' + (ra.top - rz.top) + 'px)'; sv.classList.add('mv'); sv.getBoundingClientRect();
    sv.style.transition = 'transform ' + dur + 'ms ease-out'; sv.style.transform = 'none'; setTimeout(() => sv.classList.remove('mv'), dur + 20);
  });
}
function drawArrows(s) {
  let h = ''; const col = { G: '#15781b', R: '#882020', Y: '#e68f00', B: '#003088' };
  const P = q => { let f = 'abcdefgh'.indexOf(q[0]), r = 8 - q[1]; if (flip) { f = 7 - f; r = 7 - r; } return [f + .5, r + .5]; };
  for (const t of (s || '').split(',')) {
    const m = t.trim().match(/^([GRYB])([a-h][1-8])([a-h][1-8])?$/); if (!m) continue;
    const c = col[m[1]], [x1, y1] = P(m[2]);
    if (!m[3]) { h += `<circle cx="${x1}" cy="${y1}" r=".46" fill="none" stroke="${c}" stroke-width=".07" opacity=".8"/>`; continue; }
    const [x2, y2] = P(m[3]), dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, ex = x2 - ux * .4, ey = y2 - uy * .4;
    h += `<g opacity=".8" fill="${c}" stroke="${c}"><line x1="${x1}" y1="${y1}" x2="${ex}" y2="${ey}" stroke-width=".15" stroke-linecap="round"/><polygon stroke="none" points="${x2},${y2} ${ex - uy * .22},${ey + ux * .22} ${ex + uy * .22},${ey - ux * .22}"/></g>`;
  }
  $('#ov').innerHTML = h;
}

/* ---------- rendering ---------- */
function drawBoard(fen, mv, anim) {
  const rows = fen.split(' ')[0].split('/'), grid = [];
  rows.forEach(r => { const a = []; for (const c of r) { if (/\d/.test(c)) for (let i = 0; i < +c; i++) a.push(''); else a.push(c); } grid.push(a); });
  let h = '', chk = '';
  if (mv && /[+#]/.test(mv.san)) { const K = fen.split(' ')[1] === 'w' ? 'K' : 'k'; for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) if (grid[r][f] === K) chk = 'abcdefgh'[f] + (8 - r); }
  for (let ri = 0; ri < 8; ri++) for (let fi = 0; fi < 8; fi++) {
    const r = flip ? 7 - ri : ri, f = flip ? 7 - fi : fi, name = 'abcdefgh'[f] + (8 - r), p = grid[r][f];
    const light = (r + f) % 2 === 0, hl = mv && (mv.from === name || mv.to === name);
    const coordF = ri === 7 ? `<i class="f">${'abcdefgh'[f]}</i>` : '', coordR = fi === 7 ? `<i class="r">${8 - r}</i>` : '';
    h += `<div class="sq ${light ? 'l' : 'd'}${hl ? ' hl' : ''}${chk === name ? ' chk' : ''}" data-s="${name}">${coordR}${coordF}${p ? `<svg viewBox="0 0 45 45"><use href="#${p === p.toLowerCase() ? 'b' : 'w'}${p.toUpperCase()}"/></svg>` : ''}</div>`;
  }
  $('#board').innerHTML = h; sel = null;
  if (anim && mv) slide(mv);
}
function drawMoves() {
  let h = '', num = cur.num;
  for (let i = 1; i <= cur.n; i++) {
    if (isWhitePly(cur, i)) h += `<b>${num}.</b>`; else { if (i === 1) h += `<b>${num}…</b>`; num++; }
    h += `<span data-i="${i}">${cur.mv[i].san}</span>`;
  }
  $('#mv').innerHTML = h || '<span class="sub">No playable moves in this line.</span>';
}
let et = null;
function show(a) {
  drawBoard(cur.pos[mi], cur.mv[mi], a); drawArrows((cur.ar || [])[mi]); if (a) fx(cur.mv[mi]);
  if (a && mi > 0) { recordReview(edges, edgeKeys(cur)[mi]); clearTimeout(et); et = setTimeout(saveEdges, 500); }
  $('#mv').querySelectorAll('span').forEach(s => s.classList.toggle('on', +s.dataset.i === mi));
  const on = $('#mv span.on');
  if (on) { const box = $('#mv'); const t = on.offsetTop - box.offsetTop; if (t < box.scrollTop || t > box.scrollTop + box.clientHeight - 40) box.scrollTop = t - 60; }
  $('#cm').textContent = cur.cm[mi] || '';
  $('#big').textContent = mi > 0 ? plyNumber(cur, mi) + (isWhitePly(cur, mi) ? '. ' : '… ') + cur.mv[mi].san : 'Start';
  if (mi === cur.n && cur.n > 0 && !seen.has(cur.id)) { seen.add(cur.id); saveSeen(); }
  { const k = posKeys(cur)[mi]; if (!seenPos.has(k)) { seenPos.add(k); savePos(); } }
  updProg(); if (TT) treeSync();
}
function loadLine() {
  cur = pool[order[oi]]; prepare(cur);
  mi = anchor ? anchor.m.get(cur) : S.mode === 'branch' ? Math.max(0, startIdx(cur)) : S.mode === 'smart' ? smartStartIndex(cur, edges) : 0;
  if (cur.g !== lastG) { lastG = cur.g; if (cur.or) flip = cur.or === 'black'; }
  $('#lname').textContent = cur.name;
  $('#lsub').textContent = `Line ${cur.k} of ${cur.of} · ${oi + 1}/${order.length} in queue${seen.has(cur.id) ? ' · ✓ seen' : ''}${mi > 0 ? ' · from move ' + (cur.num + Math.floor((mi + (cur.black ? 1 : 0)) / 2)) : ''}` + (cur.bad ? ' · (stopped at an unreadable move)' : '');
  drawMoves(); show(); renderEx();
}
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } }
function mkOrder() {
  order = pool.map((_, i) => i);
  if (anchor) { if (S.shuf) shuffle(order); return; }
  if (S.mode === 'smart') { order = smartOrder(pool, edges); return; }
  if (S.skip) {
    const u = order.filter(i => !done(pool[i]));
    if (u.length) order = u;
    else { pool.forEach(l => { seen.delete(l.id); posKeys(l).forEach(k => seenPos.delete(k)); }); saveSeen(); savePos(); }
  }
  if (S.shuf) shuffle(order);
}
function setPool(ci) { baseCi = ci; anchor = null; PE = null; pool = base(); oi = 0; lastG = -1; mkOrder(); loadLine(); }
function nextLine(auto) {
  if (S.mode === 'smart' && !anchor) { mkOrder(); if (auto && !S.loop && linePriority(pool[order[0]], edges) < 1) return false; oi = 0; }
  else if (oi + 1 >= order.length) { if (auto && !S.loop) return false; mkOrder(); oi = 0; }
  else oi++;
  skipDone(); loadLine(); return true;
}
function prevLine() { oi = oi > 0 ? oi - 1 : order.length - 1; loadLine(); }

/* ---------- playback ---------- */
function tick() {
  clearTimeout(timer); if (!playing) return;
  const end = mi >= cur.n;
  timer = setTimeout(() => {
    if (end) { if (!nextLine(true)) { setPlay(false); return; } } else { mi++; show(true); }
    tick();
  }, end ? S.pau * 1000 : (mi === 0 ? 900 : S.spd * 1000));
}
async function setPlay(v) {
  playing = v; if (v) unlockAudio(); $('#pp').innerHTML = v ? PAUSE : PLAY;
  if (v) tick(); else clearTimeout(timer);
  try {
    if (v && S.stay && navigator.wakeLock && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => wake = null); }
    if (!v && wake) { wake.release(); wake = null; }
  } catch (e) { /* wake lock refused */ }
}
function step(d) { const w = playing, o = mi; mi = Math.max(0, Math.min(cur.n, mi + d)); show(mi === o + 1); if (w) tick(); }

/* ---------- loading ---------- */
const TX = { w: '', b: '' };
try { TX.w = localStorage.getItem('rp-pgn-w') || ''; TX.b = localStorage.getItem('rp-pgn-b') || ''; const old = localStorage.getItem('rp-pgn'); if (old && !TX.w && !TX.b) TX.w = old; } catch (e) { /* no storage */ }
let REPC = {};
const repFor = c => REPC[c] || (REPC[c] = buildRepIndex(lines, c));
function buildAll() {
  lines = []; chapters = []; REPC = {};
  const counts = [0, 0];
  ['w', 'b'].forEach((sd, x) => {
    if (!TX[sd]) return;
    const r = buildLines(TX[sd], sd, chapters.length);
    chapters.push(...r.chapters); lines.push(...r.lines); counts[x] = r.lines.length;
  });
  return counts;
}
function impStatus() { const w = lines.filter(l => l.side === 'w').length, b = lines.filter(l => l.side === 'b').length; $('#impst').textContent = 'White: ' + (w ? w + ' lines' : 'not loaded') + ' · Black: ' + (b ? b + ' lines' : 'not loaded'); }
function start(text, side) {
  if (text !== undefined) {
    const prev = TX[side]; TX[side] = text; const r = buildAll();
    if (!r[side === 'w' ? 0 : 1]) { TX[side] = prev; buildAll(); impStatus(); $('#impst').textContent = 'No readable lines in that PGN. ' + $('#impst').textContent; return false; }
    try { localStorage.setItem('rp-pgn-' + side, text); } catch (e) { /* full */ }
  } else buildAll();
  impStatus(); if (!lines.length) return false;
  $('#empty').classList.add('hide'); $('#player').classList.remove('hide'); ['#load2', '#glb', '#pop'].forEach(x => $(x).classList.remove('hide'));
  $('#chap').innerHTML = `<option value="-1">All chapters (${lines.length} lines)</option>` + chapters.map((c, i) => `<option value="${i}">${c.name.replace(/</g, '&lt;')} (${c.count})</option>`).join('');
  setPlay(false); setPool(-1); rvRender(); return true;
}
const readFile = f => { const r = new FileReader(); r.onload = () => start(String(r.result), $('#side').value); r.readAsText(f); };
$('#pick').onclick = () => $('#file').click();
$('#file').onchange = e => e.target.files[0] && readFile(e.target.files[0]);
const dz = $('#drop');
['dragover', 'dragenter'].forEach(ev => document.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => document.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('over'); }));
document.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) readFile(f); });
$('#go').onclick = () => { const t = $('#paste').value.trim(); if (t) start(t, $('#side').value); };
$('#sample').onclick = () => {
  start(`[Event "Italian Game"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 {The Italian. Aim for a quick d4 and a strong centre. [%cal Gc2c3,Gd2d4] [%csl Gd4]} Bc5 (3... Nf6 4. d3 {A calm setup (Giuoco Pianissimo).} Bc5 5. c3 d6) 4. c3 {Prepares d4.} Nf6 5. d3 d6 6. O-O O-O *`, 'w');
  start(`[Event "Caro-Kann"]

1. e4 c6 2. d4 d5 3. Nc3 dxe4 4. Nxe4 Bf5 {The main idea: develop the bishop before ...e6.} 5. Ng3 Bg6 6. h4 h6 (6... h5 7. Nh3) 7. Nf3 Nd7 *`, 'b');
};
$('#load2').onclick = () => { setPlay(false); $('#player').classList.add('hide'); $('#empty').classList.remove('hide'); $('#load2').classList.add('hide'); $('#glb').classList.add('hide'); $('#pop').classList.add('hide'); document.body.classList.remove('glance'); $('#back').classList.toggle('hide', !lines.length); impStatus(); };

/* ---------- controls ---------- */
$('#pp').onclick = () => { if (!playing && mi >= cur.n && cur.n === 0) return; setPlay(!playing); };
$('#sf').onclick = () => step(1); $('#sb').onclick = () => step(-1);
$('#nl').onclick = () => { nextLine(); if (playing) tick(); }; $('#pl').onclick = () => { prevLine(); if (playing) tick(); };
$('#fl').onclick = () => { flip = !flip; show(); };
$('#exgo').onclick = () => setAnchor(cur, mi);
$('#exroot').onclick = () => setAnchor(cur, 0);
$('#exback').onclick = () => { if (anchor && anchor.j > 0) setAnchor(anchor.L, anchor.j - 1); };
$('#exoff').onclick = () => setPool(baseCi);
function boardClick(e) {
  const sq = e.target.closest('.sq'); if (!sq || !cur) return;
  const s = sq.dataset.s, fen = cur.pos[mi], ch = new Chess(fen), b = $('#board');
  const clear = () => { sel = null; b.querySelectorAll('.sel,.tgt').forEach(x => x.classList.remove('sel', 'tgt', 'cap')); };
  if (sel && sel !== s) {
    const cands = ch.moves({ square: sel, verbose: true }).filter(m => m.to === s);
    if (cands.length) {
      if (QZ && QZ.on && !QZ.done) {
        if (!Q.isRepertoireMove(QZ.o, cands.map(m => m.san))) { Q.miss(QZ); clear(); $('#qzm').textContent = '✗ ' + cands[0].san + ' isn’t your repertoire move here — try again, or show the answer.'; return; }
        qzDone(true);
      }
      const key = posKeys(cur)[mi];
      for (const m of cands) {
        const c2 = new Chess(fen); c2.move(m); const nk = posKey(c2.fen());
        for (const l of base()) { const K = posKeys(l); for (let i = 0; i < l.n; i++) if (K[i] === key && K[i + 1] === nk) { clear(); if (playing) setPlay(false); setAnchor(l, i + 1); return; } }
      }
      clear(); $('#expath').textContent = '“' + cands[0].san + '” isn’t in your repertoire from here.'; setTimeout(renderEx, 2200); return;
    }
  }
  clear();
  const mv = ch.moves({ square: s, verbose: true });
  if (!mv.length) return;
  sel = s; sq.classList.add('sel');
  mv.forEach(m => { const t = b.querySelector('[data-s="' + m.to + '"]'); if (t) { t.classList.add('tgt'); if (m.flags.includes('c') || m.flags.includes('e')) t.classList.add('cap'); } });
}
$('#board').onclick = boardClick;
const glance = on => document.body.classList.toggle('glance', on);
$('#glb').onclick = () => { const on = !document.body.classList.contains('glance'); glance(on); try { if (on) document.documentElement.requestFullscreen().catch(() => {}); else if (document.fullscreenElement) document.exitFullscreen(); } catch (e) { /* no fullscreen */ } };
$('#gex').onclick = () => { glance(false); try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) { /* no fullscreen */ } };
$('#pop').onclick = async () => {
  if (pw) { pw.close(); return; }
  const el = $('#player');
  try {
    let w;
    if (window.documentPictureInPicture) w = await documentPictureInPicture.requestWindow({ width: 560, height: 760 });
    else { w = window.open('', 'rp-pop', 'width=560,height=760'); if (!w) throw 0; }
    document.querySelectorAll('style,link[rel=stylesheet]').forEach(s => {
      if (s.tagName === 'LINK') { const l = w.document.createElement('link'); l.rel = 'stylesheet'; l.href = s.href; w.document.head.appendChild(l); }
      else w.document.head.appendChild(s.cloneNode(true));
    });
    const mt = w.document.createElement('meta'); mt.name = 'viewport'; mt.content = 'width=device-width,initial-scale=1'; w.document.head.appendChild(mt);
    w.document.body.className = 'glance';
    w.document.body.appendChild(document.querySelector('svg[aria-hidden]').cloneNode(true));
    const ph = document.createElement('div'); ph.className = 'card'; ph.textContent = 'Playing in the pop-out window. Close it to bring the player back here.';
    el.before(ph); w.document.body.appendChild(el); pw = w;
    w.addEventListener('pagehide', () => { const e2 = w.document.querySelector('#player'); pw = null; if (e2) ph.before(e2); ph.remove(); });
  } catch (e) { $('#lsub').textContent = 'Pop-out is not available in this browser or page.'; }
};
$('#exmv').onclick = e => { const x = e.target.closest('button'); if (!x || x.dataset.k === undefined) return; const c = exKids[+x.dataset.k]; if (c) setAnchor(c.l, c.i + 1); };
$('#chap').onchange = e => { setPool(+e.target.value); if (playing) tick(); };
$('#mv').onclick = e => { const i = e.target.dataset && e.target.dataset.i; if (i) { mi = +i; show(); if (playing) tick(); } };
function bind(id, key, fmt) {
  const el = $('#' + id), out = $('#' + id + 'v'); el.value = S[key]; S[key] = +el.value;
  const u = () => { if (out) out.textContent = fmt(S[key]); }; u();
  el.oninput = () => { S[key] = +el.value; u(); save(); };
}
bind('spd', 'spd', v => (Math.round(v * 10) / 10) + 's'); bind('pau', 'pau', v => v + 's');
$('#mode').value = S.mode; $('#mode').onchange = e => { S.mode = e.target.value; save(); if (pool.length) { mkOrder(); oi = 0; loadLine(); } };
let rt;
$('#rst').onclick = e => {
  const b = e.target;
  if (b.dataset.arm) { seen.clear(); saveSeen(); seenPos.clear(); savePos(); edges = {}; saveEdges(); delete b.dataset.arm; b.textContent = 'Reset progress'; clearTimeout(rt); if (pool.length) { mkOrder(); oi = 0; loadLine(); } }
  else { b.dataset.arm = 1; b.textContent = 'Tap again to confirm'; rt = setTimeout(() => { delete b.dataset.arm; b.textContent = 'Reset progress'; }, 3000); }
};
for (const k of ['shuf', 'loop', 'stay', 'skip', 'snd', 'say']) {
  const el = $('#' + k); el.checked = S[k];
  el.onchange = () => { S[k] = el.checked; save(); if (k === 'snd' || k === 'say') unlockAudio(); if ((k === 'shuf' || k === 'skip') && pool.length) { mkOrder(); oi = 0; loadLine(); } if (k === 'stay' && playing) { setPlay(false); setPlay(true); } };
}
document.addEventListener('keydown', e => {
  if (!cur || $('#player').classList.contains('hide') || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if (e.code === 'Space') { e.preventDefault(); setPlay(!playing); }
  else if (e.key === 'ArrowRight') step(1); else if (e.key === 'ArrowLeft') step(-1);
  else if (e.key === 'n' || e.key === 'N') { nextLine(); if (playing) tick(); }
  else if (e.key === 'p' || e.key === 'P') { prevLine(); if (playing) tick(); }
  else if (e.key === 'f' || e.key === 'F') { flip = !flip; show(); }
  else if (e.key === 'g' || e.key === 'G') $('#glb').click();
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && playing && S.stay && !wake) { setPlay(false); setPlay(true); } });

/* ---------- Lichess game review ---------- */
// mark/viewed: games played after `mark` count as new; see advanceMark(). view: 'new' | 'all'.
const RV = { u: '', games: [], last: 0, checked: 0, auto: true, mark: 0, viewed: false, view: 'new', res: null, busy: false, ...load('rp-lichess', {}) };
const rvSave = () => store('rp-lichess', { u: RV.u, games: RV.games, last: RV.last, checked: RV.checked, auto: RV.auto, mark: RV.mark, viewed: RV.viewed, view: RV.view });
const rvNewCount = () => newGames(RV.games, RV.mark).length;
// "· N new" in the closed review header while there are new games you haven't looked at.
function rvBadge() { const n = rvNewCount(); $('#rvnew').textContent = !$('#rv').open && !RV.viewed && n ? ' \u00b7 ' + n + ' new' : ''; }
function rvMarkViewed() { if ($('#rv').open && !RV.viewed) { RV.viewed = true; rvSave(); } rvBadge(); }
function rvRender() {
  const out = $('#rvout'), cf = $('#rvc').value, onlyNew = RV.view !== 'all';
  const G = (onlyNew ? newGames(RV.games, RV.mark) : RV.games).filter(g => !cf || g.c === cf);
  rvMarkViewed();
  if (!RV.games.length || !lines.length) { out.innerHTML = '<div class="sub">Load a repertoire, enter your username and press Fetch.</div>'; RV.res = null; return; }
  const markBtn = '<button id="rvmark" style="padding:3px 12px;min-height:0;font-size:13px;margin-left:6px">Mark as seen</button>';
  const head = onlyNew
    ? '<div class="sub">' + (G.length ? G.length + ' new game' + (G.length > 1 ? 's' : '') + ' since you last looked' + markBtn
      : 'No new games since you last looked. <button id="rvall" style="padding:3px 12px;min-height:0;font-size:13px">Show all games</button>') + '</div>'
    : '';
  if (!G.length) { out.innerHTML = head || '<div class="sub">No games for this colour.</div>'; RV.res = null; return; }
  const { checked, ok, rows } = summarize(G, repFor); RV.res = rows;
  const sec = (t, title, f) => {
    const a = rows[t];
    return '<h4>' + title + ' (' + a.reduce((s, o) => s + o.n, 0) + ')</h4>' + (a.slice(0, 12).map((o, i) => '<div class="rvr" data-t="' + t + '" data-i="' + i + '"><div>' + f(o) + '</div><div class="sub">' + o.txt + ' · ×' + o.n + ' (W' + o.w + ' D' + o.d + ' L' + o.l + ') · <a href="https://lichess.org/' + o.id + '/' + (o.c === 'w' ? 'white' : 'black') + '" target="_blank" rel="noopener">game</a></div></div>').join('') || '<div class="sub">None — nice.</div>');
  };
  out.innerHTML = head + '<div class="sub">' + checked + ' of ' + G.length + ' games checked · ' + ok + ' stayed in your repertoire to the end</div>'
    + sec('dev', '⚠ You left your repertoire <button class="p" id="qzgo" style="padding:3px 14px;min-height:0;font-size:13px;margin-left:6px">Quiz me</button>', o => 'You played <b>' + o.r.san + '</b> instead of ' + (o.r.exp.join(', ') || '—'))
    + sec('opp', '➕ Opponent moves not covered', o => 'They played <b>' + o.r.san + '</b>')
    + sec('end', '⛔ Where your lines end', o => 'Out of book: ' + (o.r.mine ? 'you' : 'they') + ' played <b>' + o.r.san + '</b>');
}
// auto = quiet check for new games when the app is opened or brought back to the front.
async function rvFetch(auto) {
  const st = $('#rvst'), u = auto ? RV.u : $('#rvu').value.trim();
  if (!u || RV.busy) return;
  if (auto && !shouldAutoCheck({ user: u, enabled: RV.auto, online: navigator.onLine, lastCheck: RV.checked })) return;
  if (u.toLowerCase() !== (RV.u || '').toLowerCase()) { RV.games = []; RV.last = 0; RV.mark = 0; RV.viewed = false; }
  RV.u = u; RV.busy = true; st.textContent = auto ? 'Checking Lichess for new games…' : 'Fetching games…';
  try {
    const r = await fetch(lichessGamesUrl(u, $('#rvn').value, RV.last), { headers: { Accept: 'application/x-ndjson' } });
    if (!r.ok) throw new Error(r.status === 404 ? 'User not found.' : r.status === 429 ? 'Lichess asks to wait a minute (rate limit).' : 'Lichess answered ' + r.status + '.');
    const { games: add, last } = parseLichessGames(await r.text(), u, RV.last);
    Object.assign(RV, advanceMark(RV, RV.last, add.length));
    RV.last = last; RV.games = mergeGames(RV.games, add); RV.checked = Date.now();
    rvSave();
    st.textContent = auto
      ? (add.length ? add.length + ' new game' + (add.length > 1 ? 's' : '') + ' since your last visit' : 'No new games') + ' · checked ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : add.length + ' new games fetched · ' + RV.games.length + ' stored.';
    rvRender();
  } catch (e) { st.textContent = (auto ? 'Automatic check failed: ' : 'Could not fetch games: ') + e.message + (navigator.onLine === false ? ' (you are offline)' : ''); }
  finally { RV.busy = false; }
}
$('#rvu').value = RV.u || ''; $('#rvgo').onclick = () => rvFetch(false); $('#rvc').onchange = rvRender;
$('#rvauto').checked = RV.auto; $('#rvauto').onchange = e => { RV.auto = e.target.checked; rvSave(); };
$('#rvv').value = RV.view === 'all' ? 'all' : 'new'; $('#rvv').onchange = e => { RV.view = e.target.value; rvSave(); rvRender(); };
$('#rv').addEventListener('toggle', rvMarkViewed);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') rvFetch(true); });
$('#rvout').onclick = e => {
  if (e.target.closest('a')) return;
  if (e.target.closest('#rvmark')) { RV.mark = RV.last; RV.viewed = false; rvSave(); rvRender(); return; }
  if (e.target.closest('#rvall')) { RV.view = 'all'; $('#rvv').value = 'all'; rvSave(); rvRender(); return; }
  if (e.target.closest('#qzgo')) { if (RV.res && RV.res.dev.length) qzStart(RV.res.dev, 0); return; }
  const r = e.target.closest('.rvr'); if (!r || !RV.res) return;
  const o = RV.res[r.dataset.t][+r.dataset.i]; if (!o) return;
  if (r.dataset.t === 'dev') { qzStart(RV.res.dev, +r.dataset.i); return; }
  const l = lineThrough(lines, o.r.key); if (!l) return;
  if (playing) setPlay(false);
  if (baseCi >= 0 && l.g !== baseCi) { $('#chap').value = '-1'; setPool(-1); }
  setAnchor(l, posKeys(l).indexOf(o.r.key));
  flip = o.c === 'b'; show(); drawArrows((o.r.mine ? 'R' : 'Y') + o.r.from + o.r.to);
};

/* ---------- icons ---------- */
const ic = p => '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
const PLAY = ic('<path d="M8 5.5v13l11-6.5z"/>') + '<span>Play</span>';
const PAUSE = ic('<rect x="6.5" y="5.5" width="3.8" height="13" rx="1"/><rect x="13.7" y="5.5" width="3.8" height="13" rx="1"/>') + '<span>Pause</span>';
$('#pp').innerHTML = PLAY;
$('#pl').innerHTML = ic('<rect x="5" y="5.5" width="2.4" height="13" rx="1"/><path d="M19 5.5v13L9.5 12z"/>');
$('#sb').innerHTML = ic('<path d="M16 5.5v13L7 12z"/>');
$('#sf').innerHTML = ic('<path d="M8 5.5v13L17 12z"/>');
$('#nl').innerHTML = ic('<path d="M5 5.5v13L14.5 12z"/><rect x="16.6" y="5.5" width="2.4" height="13" rx="1"/>');
$('#back').onclick = () => { $('#empty').classList.add('hide'); $('#player').classList.remove('hide'); ['#load2', '#glb', '#pop'].forEach(x => $(x).classList.remove('hide')); };

/* ---------- mistake quiz ---------- */
let QZ = null;
// Bring the quiz card into view. On phones the side panel scrolls on its own and the quiz
// card sits at its top, so starting the quiz from the review list left it off-screen.
function qzReveal() {
  const panel = $('#player > div:last-child');
  if (panel && panel.scrollHeight > panel.clientHeight + 1) panel.scrollTop = 0;
  else $('#qz').scrollIntoView({ block: 'nearest' });
}
function qzStart(list, i) { QZ = Q.createQuiz(list, i); document.body.classList.add('quizon'); qzShow(); }
function qzShow() {
  while (QZ.o && !lineThrough(lines, QZ.o.r.key, QZ.o.c)) QZ.o = QZ.list[++QZ.i] || null;
  const o = QZ.o; if (!o) { qzEnd(); return; }
  const l = lineThrough(lines, o.r.key, o.c);
  QZ.done = false; QZ.tries = 0; if (playing) setPlay(false);
  if (baseCi >= 0) { $('#chap').value = '-1'; setPool(-1); }
  setAnchor(l, posKeys(l).indexOf(o.r.key)); flip = o.c === 'b'; show();
  document.body.classList.add('quizq'); $('#qz').classList.remove('hide'); $('#qzs').textContent = Q.scoreText(QZ);
  $('#qzm').textContent = Q.promptText(o);
  $('#qznext').classList.add('hide'); $('#qzshow').classList.remove('hide');
  qzReveal();
}
function qzDone(good) {
  Q.finish(QZ, good); $('#qzs').textContent = Q.scoreText(QZ); document.body.classList.remove('quizq');
  $('#qzm').textContent = Q.resultText(QZ.o, good, QZ.tries);
  $('#qzshow').classList.add('hide'); $('#qznext').textContent = QZ.i + 1 < QZ.list.length ? 'Next' : 'Finish'; $('#qznext').classList.remove('hide');
  qzReveal();
}
function qzAnswer() { if (!QZ || !QZ.on || QZ.done) return; qzDone(false); drawArrows(Q.answerArrows(QZ.o)); }
function qzEnd() { document.body.classList.remove('quizq'); QZ.on = false; $('#qzm').textContent = 'Quiz finished: ' + QZ.good + ' of ' + QZ.seen + ' correct.'; $('#qzshow').classList.add('hide'); $('#qznext').classList.add('hide'); qzReveal(); }
function qzExit() {
  if (QZ) QZ.on = false;
  document.body.classList.remove('quizq', 'quizon'); $('#qz').classList.add('hide');
  $('#rv').open = true; $('#rvout').scrollIntoView({ block: 'start' }); // back to the review list
}
$('#qzshow').onclick = qzAnswer; $('#qznext').onclick = () => { Q.advance(QZ); qzShow(); }; $('#qzexit').onclick = qzExit;

/* ---------- repertoire tree ---------- */
let TSIG = '', TT = false; const TC = new Set();
function trLab(n, r, force) { const d = n.d - 1 + (r.black ? 1 : 0), w = d % 2 === 0, num = r.num + Math.floor(d / 2); return w ? num + '.' + n.san : (force ? num + '…' : '') + n.san; }
function trRow(n, r) {
  const run = [n]; let last = n;
  while (last.kids.length === 1 && !last.refs.length) { last = last.kids[0]; run.push(last); }
  const id = r.sd + ':' + n.key, col = TC.has(id), kids = last.kids.length > 0;
  const chips = run.map((x, i) => '<span class="tm" data-k="' + x.key + '">' + trLab(x, r, i === 0) + '</span>').join(' ')
    + (last.refs.length ? ' (' + last.refs.map(f => '<span class="tr" data-k="' + f.key + '">' + trLab(f, r, true) + ' →</span>').join(', ') + ')' : '');
  return '<div class="tn' + (col ? ' col' : '') + '" data-r="' + id + '"><div class="tr1">' + (kids ? '<span class="tg">' + (col ? '+' : '−') + '</span>' : '<span class="tg0"></span>') + '<div class="tmv">' + chips + '</div></div>'
    + (kids ? '<div class="tb">' + last.kids.map(c => trRow(c, r)).join('') + '</div>' : '') + '</div>';
}
function buildTree() {
  const by = {}; base().forEach(l => { (by[l.side || ''] = by[l.side || ''] || []).push(l); }); let h = '';
  for (const sd of Object.keys(by)) {
    const roots = buildGraph(by[sd], sd);
    h += '<div class="tn0" data-s="' + sd + '"><div class="sub" style="margin:4px 0"><b>' + (sd === 'b' ? '♚ Black' : sd === 'w' ? '♔ White' : 'Repertoire') + '</b></div>';
    roots.forEach((r, rk) => { const root = spanTree(r.g, rk); h += root.kids.map(c => trRow(c, r)).join(''); });
    h += '</div>';
  }
  $('#tree').innerHTML = h || '<div class="sub">No lines loaded.</div>';
}
function treeSync() {
  const sig = [baseCi, lines.length, TX.w.length, TX.b.length].join('|');
  if (sig !== TSIG) { TSIG = sig; buildTree(); }
  const t = $('#tree'); t.querySelectorAll('.tm.on').forEach(x => x.classList.remove('on'));
  const el = t.querySelector('.tm[data-k="' + posKeys(cur)[mi] + '"]'); if (!el) return;
  for (let n = el.closest('.tn'); n; n = n.parentElement.closest('.tn')) { if (n.classList.contains('col')) { n.classList.remove('col'); TC.delete(n.dataset.r); const g = n.querySelector(':scope>.tr1>.tg'); if (g) g.textContent = '−'; } }
  el.classList.add('on');
  const sc = t.scrollHeight > t.clientHeight + 2 ? t : t.parentElement, a = el.getBoundingClientRect(), b = sc.getBoundingClientRect(), top = b.top + (sc === t ? 0 : ($('.ctl') ? $('.ctl').offsetHeight : 0));
  if (a.top < top || a.bottom > b.bottom) sc.scrollTop += a.top - top - (b.bottom - top) / 3;
}
function setTab(t) { TT = t; $('#mv').classList.toggle('hide', t); $('#tree').classList.toggle('hide', !t); $('#tabm').classList.toggle('p', !t); $('#tabt').classList.toggle('p', t); $('#tcol').classList.toggle('hide', !t); $('#texp').classList.toggle('hide', !t); if (t) { TSIG = ''; treeSync(); } }
$('#tabm').onclick = () => setTab(false); $('#tabt').onclick = () => setTab(true);
$('#tcol').onclick = () => { $('#tree').querySelectorAll('.tn').forEach(n => { if (n.querySelector(':scope>.tb')) { n.classList.add('col'); TC.add(n.dataset.r); n.querySelector(':scope>.tr1>.tg').textContent = '+'; } }); };
$('#texp').onclick = () => { TC.clear(); $('#tree').querySelectorAll('.tn.col').forEach(n => { n.classList.remove('col'); n.querySelector(':scope>.tr1>.tg').textContent = '−'; }); };
$('#tree').onclick = e => {
  const g = e.target.closest('.tg');
  if (g) { const n = g.closest('.tn'), c = n.classList.toggle('col'); g.textContent = c ? '+' : '−'; c ? TC.add(n.dataset.r) : TC.delete(n.dataset.r); return; }
  const c = e.target.closest('.tm,.tr'); if (!c) return;
  const sd = c.closest('.tn0').dataset.s, k = c.dataset.k, l = lines.find(l => (l.side || '') === sd && posKeys(l).includes(k)); if (!l) return;
  if (playing) setPlay(false); setAnchor(l, posKeys(l).indexOf(k));
};

/* ---------- offline / install ---------- */
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});

try { if (TX.w || TX.b) start(); else impStatus(); } catch (e) { console.error(e); }
rvFetch(true);
