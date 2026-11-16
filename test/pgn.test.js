import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitGames, parseMoveTree, leafPaths, buildLines, chapterName } from '../src/pgn.js';

const sans = root => leafPaths(root).map(p => p.map(n => n.san).join(' '));

test('splitGames separates games by header blocks', () => {
  const gs = splitGames('[Event "A"]\n[Site "x"]\n\n1. e4 e5 *\n\n[Event "B"]\n\n1. d4\nd5 *\n');
  assert.equal(gs.length, 2);
  assert.deepEqual(gs[0].h, { Event: 'A', Site: 'x' });
  assert.equal(gs[1].m, '1. d4\nd5 *\n');
});

test('splitGames handles CRLF and movetext without headers', () => {
  const gs = splitGames('1. e4 e5\r\n2. Nf3 *\r\n');
  assert.equal(gs.length, 1);
  assert.deepEqual(gs[0].h, {});
  assert.match(gs[0].m, /Nf3/);
});

test('variations become separate leaf paths', () => {
  const root = parseMoveTree('1. e4 e5 2. Nf3 Nc6 (2... d6 3. d4) 3. Bb5 *');
  assert.deepEqual(sans(root), ['e4 e5 Nf3 Nc6 Bb5', 'e4 e5 Nf3 d6 d4']);
});

test('nested variations and variations on the first move', () => {
  const root = parseMoveTree('1. e4 (1. d4 d5 (1... Nf6 2. c4)) 1... c5 *');
  assert.deepEqual(sans(root), ['e4 c5', 'd4 d5', 'd4 Nf6 c4']);
});

test('comments, arrows and circles are attached to the move they follow', () => {
  const root = parseMoveTree('{Intro} 1. e4 {Best by test [%cal Gd2d4,Rg1f3] [%csl Ge4]} e5 *');
  assert.equal(root.c.trim(), 'Intro');
  const e4 = root.ch[0];
  assert.equal(e4.c.trim(), 'Best by test');
  assert.equal(e4.a, 'Gd2d4,Rg1f3,Ge4,');
});

test('NAGs, annotations, results, move numbers and e.p. are ignored; 0-0 is normalised', () => {
  const root = parseMoveTree('1. e4!! $1 e5?! 2. Nf3 Nc6 3. Bc4 Bc5 4. 0-0 Nf6 5. d3 0-0 6. exd5 e.p. 1-0');
  assert.deepEqual(sans(root), ['e4 e5 Nf3 Nc6 Bc4 Bc5 O-O Nf6 d3 O-O exd5']);
});

test('semicolon comments are skipped', () => {
  const root = parseMoveTree('1. e4 ; rest of line ignored (not a variation\n1... e5 *');
  assert.deepEqual(sans(root), ['e4 e5']);
});

test('black-to-move numbering "3..." is accepted', () => {
  const root = parseMoveTree('3... Nf6 4. d3 *');
  assert.deepEqual(sans(root), ['Nf6 d3']);
});

test('chapterName falls back from Event to players to index', () => {
  assert.equal(chapterName({ Event: 'Italian' }, 0), 'Italian');
  assert.equal(chapterName({ Event: '?', White: 'A', Black: 'B' }, 0), 'A – B');
  assert.equal(chapterName({}, 2), 'Game 3');
});

test('buildLines produces one line per leaf with chapter info, comments and FEN', () => {
  const pgn = '[Event "Ch1"]\n\n1. e4 {c1} e5 (1... c5) *\n\n[Event "Ch2"]\n[FEN "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"]\n\n1... e5 *\n\n[Event "Empty"]\n\n*\n';
  const { chapters, lines } = buildLines(pgn, 'b', 3);
  assert.deepEqual(chapters.map(c => [c.name, c.count]), [['♚ Ch1', 2], ['♚ Ch2', 1]]);
  assert.equal(lines.length, 3);
  assert.deepEqual(lines.map(l => l.g), [3, 3, 4]);
  assert.deepEqual(lines[0].sans, ['e4', 'e5']);
  assert.deepEqual(lines[0].cm, ['', 'c1', '']);
  assert.equal(lines[1].k, 2); assert.equal(lines[1].of, 2);
  assert.equal(lines[2].fen.split(' ')[1], 'b');
  assert.equal(lines[0].or, 'black');
  assert.notEqual(lines[0].id, lines[1].id);
});

test('line ids are stable across parses and depend on side', () => {
  const a = buildLines('1. e4 e5 *', 'w').lines[0].id;
  assert.equal(buildLines('1. e4 e5 *', 'w').lines[0].id, a);
  assert.notEqual(buildLines('1. e4 e5 *', 'b').lines[0].id, a);
});
