// Mistake quiz: replay positions where I left my repertoire and ask for the right move.
// Items are the `dev` rows from review.summarize().
import { Chess } from '../vendor/chess.mjs';
import { stripCheck } from './position.js';

export function createQuiz(list, i = 0) {
  return { on: true, list, i, o: list[i] || null, done: false, good: 0, seen: 0, tries: 0 };
}

/** Is any of the candidate SANs (moves to the clicked square) a repertoire move here? */
export function isRepertoireMove(item, sans) {
  return sans.some(s => item.r.exp.includes(stripCheck(s)));
}

/** Register a wrong attempt. */
export function miss(q) { q.tries++; return q; }

/** Finish the current item. */
export function finish(q, good) {
  q.done = true; q.seen++; if (good) q.good++;
  return q;
}

/** Move to the next item; returns false when the quiz is over. */
export function advance(q) {
  q.i++; q.o = q.list[q.i] || null; q.done = false; q.tries = 0;
  return !!q.o;
}

export const scoreText = q => (q.i + 1) + ' / ' + q.list.length + ' · ' + q.good + ' correct';

export const promptText = o =>
  (o.c === 'w' ? 'White' : 'Black') + ' to move after ' + o.txt +
  '. What does your repertoire play here? Make the move on the board.';

export function resultText(o, good, tries) {
  return (good
    ? '✓ Correct' + (tries ? ' (after ' + tries + ' miss' + (tries > 1 ? 'es' : '') + ')' : '') + '. '
    : 'Answer: ' + o.r.exp.join(' or ') + '. ') +
    'In your games you played ' + o.r.san + ' here (' + o.n + '×).';
}

/** Arrow annotation ("Ge2e4,...") showing the repertoire answer(s). */
export function answerArrows(o) {
  const ch = new Chess(o.r.fen), ar = [];
  for (const x of o.r.exp) { const m = ch.move(x, { sloppy: true }); if (m) { ar.push('G' + m.from + m.to); ch.undo(); } }
  return ar.join(',');
}
