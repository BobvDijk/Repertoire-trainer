// Sync engine: keeps a few data "documents" in step between this device and the server.
// The server side is a small backend object (see sync-firebase.js), so this file has no
// Firebase code and can be tested with a fake backend.
//
// Documents (key -> value):
//   pgn-w, pgn-b  the stored White / Black PGN text            -> newest change wins
//   state         settings, import options, removed moves, Lichess accounts -> newest change wins
//   progress      seen lines, seen positions, Smart review data -> merged
// On the server each document is {t: changed-at ms, by: device id, json: JSON of the value}.

export const SYNC_KEYS = ['pgn-w', 'pgn-b', 'state', 'progress'];
export const MAX_DOC = 900_000; // Firestore allows 1 MiB per document

const json = v => JSON.stringify(v);

/**
 * Merge two progress values {seen: [], pos: [], edges: {key: [count, lastMs]}, resetAt}.
 * If one side reset its progress more recently, that side wins outright (everything it has was
 * recorded after the reset). Otherwise sets are unioned and, per move, the most recent review wins.
 */
export function mergeProgress(a, b) {
  const A = { seen: [], pos: [], edges: {}, resetAt: 0, ...(a || {}) };
  const B = { seen: [], pos: [], edges: {}, resetAt: 0, ...(b || {}) };
  if (A.resetAt !== B.resetAt) {
    const w = A.resetAt > B.resetAt ? A : B;
    return { seen: [...new Set(w.seen)].sort(), pos: [...new Set(w.pos)].sort(), edges: { ...w.edges }, resetAt: w.resetAt };
  }
  const edges = { ...A.edges };
  for (const [k, e] of Object.entries(B.edges)) if (!edges[k] || e[1] > edges[k][1]) edges[k] = e;
  return {
    seen: [...new Set([...A.seen, ...B.seen])].sort(),
    pos: [...new Set([...A.pos, ...B.pos])].sort(),
    edges, resetAt: A.resetAt,
  };
}

/** Same progress? (order of sets and keys doesn't matter) */
const canon = p => {
  const m = mergeProgress(p, p);
  return json([m.seen, m.pos, Object.keys(m.edges).sort().map(k => [k, m.edges[k]]), m.resetAt]);
};
export const sameProgress = (a, b) => canon(a) === canon(b);

/**
 * What to do with one document. local = {v, t} (t = when it last changed on this device, 0 if
 * never), remote = {v, t} or null. Returns {apply: value to take over locally | undefined,
 * push: value to upload | undefined}.
 */
export function decide(key, local, remote) {
  if (key === 'progress') {
    const m = mergeProgress(local.v, remote ? remote.v : null);
    return { apply: sameProgress(m, local.v || {}) ? undefined : m, push: remote && sameProgress(m, remote.v || {}) ? undefined : m };
  }
  if (!remote) return { push: local.t || !isEmpty(local.v) ? local.v : undefined };
  if (remote.t > local.t) return json(remote.v) === json(local.v) ? {} : { apply: remote.v };
  if (local.t > remote.t) return json(remote.v) === json(local.v) ? {} : { push: local.v };
  return {};
}
const isEmpty = v => v == null || v === '' || (typeof v === 'object' && !Object.keys(v).length);

/**
 * Create a sync session for a signed-in user.
 *   backend: { pull(): Promise<{key: {t, by, json}}>, push(key, doc): Promise, subscribe(cb(key, doc)): unsubscribe }
 *   read(key) -> current local value;  write(key, value) -> take over a value locally (must not call dirty())
 *   meta: {get(key) -> t, set(key, t)} local change times;  status(text) for the UI
 *   delays: how long to wait after a change before uploading (progress changes often, so it waits longer)
 */
export function createSync({ backend, read, write, meta, device, status = () => {}, now = Date.now,
  delays = { progress: 60_000, default: 2_000 } }) {
  const timers = {}, lastServer = {};
  let unsub = null, stopped = false;

  async function upload(key, value) {
    const doc = { t: meta.get(key) || now(), by: device, json: json(value) };
    if (doc.json.length > MAX_DOC) { status('Too large to sync: ' + key); return; }
    if (lastServer[key] === doc.json) return;
    await backend.push(key, doc);
    lastServer[key] = doc.json; meta.set(key, doc.t);
  }
  function take(key, remote) {
    const { apply, push } = decide(key, { v: read(key), t: meta.get(key) || 0 }, remote);
    if (apply !== undefined) { write(key, apply); meta.set(key, key === 'progress' ? Math.max(meta.get(key) || 0, remote ? remote.t : 0) : remote.t); }
    return push;
  }
  const parse = d => d ? { v: JSON.parse(d.json), t: d.t || 0, by: d.by } : null;

  return {
    /** Full two-way sync: pull everything, apply what's newer, upload what's newer here. */
    async syncAll() {
      status('Syncing…');
      const docs = await backend.pull();
      for (const k of SYNC_KEYS) if (docs[k]) lastServer[k] = docs[k].json;
      for (const k of SYNC_KEYS) {
        const push = take(k, parse(docs[k]));
        if (push !== undefined) await upload(k, push);
      }
      if (!unsub && !stopped) unsub = backend.subscribe((k, d) => {
        if (!SYNC_KEYS.includes(k) || d.by === device || d.json === lastServer[k]) return;
        lastServer[k] = d.json;
        const push = take(k, parse(d));
        if (push !== undefined && k === 'progress') this.dirty(k, { keepTime: true });
      });
      status('Synced');
    },
    /** A local change: remember when, and upload after a short delay. */
    dirty(key, { keepTime = false } = {}) {
      if (stopped || !SYNC_KEYS.includes(key)) return;
      if (!keepTime) meta.set(key, now());
      clearTimeout(timers[key]);
      timers[key] = setTimeout(() => this.flush(key), delays[key] ?? delays.default);
    },
    /** Upload pending changes now (e.g. when the app goes to the background). */
    async flush(key) {
      const keys = key ? [key] : Object.keys(timers);
      for (const k of keys) {
        clearTimeout(timers[k]); delete timers[k];
        try { await upload(k, read(k)); status('Synced'); } catch (e) { status('Sync failed: ' + (e.message || e)); }
      }
    },
    pending: () => Object.keys(timers).length,
    stop() { stopped = true; for (const k in timers) clearTimeout(timers[k]); if (unsub) unsub(); unsub = null; },
  };
}
