// Move sounds (synthesised) and spoken moves.
let AC = null;

/** Create/resume the AudioContext; must be called from a user gesture on iOS. */
export function unlockAudio() {
  try {
    if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === 'suspended') AC.resume();
  } catch (e) { /* no audio */ }
}

/** Short wooden "thump"; a bit louder and longer for captures. */
export function thump(cap) {
  if (!AC) return;
  const t = AC.currentTime, o = AC.createOscillator(), g = AC.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(cap ? 260 : 200, t);
  o.frequency.exponentialRampToValueAtTime(cap ? 90 : 70, t + .07);
  g.gain.setValueAtTime(cap ? .9 : .6, t);
  g.gain.exponentialRampToValueAtTime(.001, t + (cap ? .14 : .1));
  o.connect(g); g.connect(AC.destination); o.start(t); o.stop(t + .16);
  const n = AC.sampleRate * .02 | 0, b = AC.createBuffer(1, n, AC.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = AC.createBufferSource(); s.buffer = b;
  const f = AC.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1500;
  const h = AC.createGain(); h.gain.value = cap ? .5 : .25;
  s.connect(f); f.connect(h); h.connect(AC.destination); s.start(t);
}

const SW = { N: 'knight ', B: 'bishop ', R: 'rook ', Q: 'queen ', K: 'king ' };

/** SAN -> words for speech synthesis ("Nxe5+" -> "knight takes e 5 check"). */
export function sanToSpeech(san) {
  return san.replace(/O-O-O/, 'castles queenside').replace(/O-O/, 'castles kingside')
    .replace(/^([NBRQK])/, (m, p) => SW[p]).replace(/x/g, ' takes ')
    .replace(/=([NBRQ])/, (m, p) => ' promotes to ' + SW[p])
    .replace(/\+/, ' check').replace(/#/, ' checkmate').replace(/([a-h])([1-8])/g, '$1 $2');
}

export function speak(san) {
  if (!window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(sanToSpeech(san));
  u.rate = 1.15; speechSynthesis.cancel(); speechSynthesis.speak(u);
}
