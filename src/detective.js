'use strict';

const { fnv1a32 } = require('./hash');

function pairKey(pa, pb) {
  const ka = String(pa.phrase).toLowerCase();
  const kb = String(pb.phrase).toLowerCase();
  return ka <= kb ? ka + '\u0000' + kb : kb + '\u0000' + ka;
}

function suggest(wall) {
  const pins = wall.pins || [];
  const strings = wall.strings || [];
  if (pins.length < 2) return { decline: 'too_few' };
  const deg = new Map();
  const tied = new Set();
  for (const p of pins) deg.set(p.id, 0);
  for (const s of strings) {
    if (deg.has(s.a)) deg.set(s.a, deg.get(s.a) + 1);
    if (deg.has(s.b)) deg.set(s.b, deg.get(s.b) + 1);
    tied.add(s.a + '\u0000' + s.b);
    tied.add(s.b + '\u0000' + s.a);
  }
  let best = null;
  for (let i = 0; i < pins.length; i++) {
    for (let j = i + 1; j < pins.length; j++) {
      if (tied.has(pins[i].id + '\u0000' + pins[j].id)) continue;
      const d = deg.get(pins[i].id) + deg.get(pins[j].id);
      const h = fnv1a32('detective:' + pairKey(pins[i], pins[j]));
      if (best === null || d < best.d || (d === best.d && h > best.h)) {
        best = { d, h, pair: [pins[i].id, pins[j].id] };
      }
    }
  }
  if (best === null) return { decline: 'all_connected' };
  return { pair: best.pair };
}

function message(result, wall) {
  if (result.pair) {
    const phraseOf = (id) => {
      const p = ((wall && wall.pins) || []).find((x) => x.id === id);
      return p ? p.phrase : '';
    };
    return 'I like ' + phraseOf(result.pair[0]) + ' and ' + phraseOf(result.pair[1]) +
      ' together. Nobody ever asks why.';
  }
  if (result.decline === 'too_few') return 'Two pins minimum. Even I cannot connect a single dot.';
  return 'Everything is already connected. That is what worries me.';
}

module.exports = { suggest, message };
