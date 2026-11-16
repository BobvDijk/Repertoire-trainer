// Smart review: spaced repetition per move ("edge" = position + move).
// edges[key] = [timesReviewed, lastReviewedMs]. A move is due when the time since its
// last review exceeds the interval for its review count.
import { edgeKeys } from './position.js';

/** Review intervals by review count: 0h, 4h, 1d, 3d, 7d, 16d, 35d (capped at the last). */
export const INTERVALS = [0, 4, 24, 72, 168, 384, 840].map(h => h * 36e5);
const MAX = 10;

/** How overdue a move is: >= 1 means due; never-seen moves score the maximum (10). */
export function dueness(edges, key, now = Date.now()) {
  const e = edges[key];
  if (!e) return MAX;
  return Math.min(MAX, (now - e[1]) / INTERVALS[Math.min(e[0], INTERVALS.length - 1)]);
}

/** Line priority: sum of dueness over its due moves. */
export function linePriority(L, edges, now = Date.now()) {
  const k = edgeKeys(L);
  let s = 0;
  for (let i = 1; i <= L.n; i++) { const v = dueness(edges, k[i], now); if (v >= 1) s += v; }
  return s;
}

/** Ply to start a line from in Smart mode: just before its first due move (0 if none due). */
export function smartStartIndex(L, edges, now = Date.now()) {
  const k = edgeKeys(L);
  for (let i = 1; i <= L.n; i++) if (dueness(edges, k[i], now) >= 1) return i - 1;
  return 0;
}

/** Record that a move was reviewed now. */
export function recordReview(edges, key, now = Date.now()) {
  const e = edges[key] || (edges[key] = [0, 0]);
  e[0]++; e[1] = now;
  return e;
}

/** Pool order for Smart mode: highest priority first (tiny random jitter breaks ties). */
export function smartOrder(pool, edges, now = Date.now(), rand = Math.random) {
  const p = pool.map(l => linePriority(l, edges, now) + rand() * 0.01);
  return pool.map((_, i) => i).sort((a, b) => p[b] - p[a]);
}

/** Unique move keys of a pool of lines (transposed moves count once). */
export const poolEdgeKeys = pool => [...new Set(pool.flatMap(l => edgeKeys(l).slice(1)))];

/** How many of the given move keys are due. */
export function dueSummary(keys, edges, now = Date.now()) {
  return { due: keys.filter(k => dueness(edges, k, now) >= 1).length, total: keys.length };
}
