'use strict';

const THRESHOLDS = [0, 20, 60, 120, 200];
const STATUSES = ['Hunch', 'Theory', 'Pattern', 'Cover-up', "They don't want you to know"];

function score(wall) {
  const pins = wall.pins || [];
  const strings = wall.strings || [];
  const deg = new Map();
  for (const p of pins) deg.set(p.id, 0);
  for (const s of strings) {
    if (deg.has(s.a)) deg.set(s.a, deg.get(s.a) + 1);
    if (deg.has(s.b)) deg.set(s.b, deg.get(s.b) + 1);
  }
  let connected = 0;
  let extra = 0;
  for (const d of deg.values()) {
    if (d >= 1) {
      connected++;
      extra += d - 1;
    }
  }
  const total = 10 * strings.length + 2 * connected + 5 * extra;
  let level = 0;
  for (let i = 0; i < THRESHOLDS.length; i++) {
    if (total >= THRESHOLDS[i]) level = i;
  }
  return { score: total, level, status: STATUSES[level] };
}

module.exports = { score, THRESHOLDS, STATUSES };
