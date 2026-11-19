'use strict';

const { fnv1a32, mulberry32 } = require('./hash');

const PALETTES = [
  ['#1b1b2f', '#e43f5a', '#f9c74f', '#f8f1e4'],
  ['#162447', '#e94560', '#f4d160', '#fbeedc'],
  ['#2d2a32', '#d7263d', '#f46036', '#e8e1d5'],
  ['#0f3057', '#c0392b', '#e9b44c', '#ece5d3'],
  ['#222831', '#b5362f', '#d9a441', '#eeeeee'],
  ['#2b2d42', '#ef233c', '#edf2f4', '#ffb703'],
  ['#3d2c2e', '#a4161a', '#e5b25d', '#f5ebe0'],
  ['#1a1a1a', '#cc3333', '#e6c229', '#dcdcdc'],
];

const n1 = (v) => v.toFixed(1);

function artSvg(phrase) {
  const key = String(phrase).toLowerCase();
  const rnd = mulberry32(fnv1a32('art:' + key));
  const palette = PALETTES[Math.floor(rnd() * 8)];
  const count = 3 + Math.floor(rnd() * 4);
  let out = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" focusable="false">' +
    '<rect width="100" height="100" fill="' + palette[0] + '"/>';
  for (let i = 0; i < count; i++) {
    const kind = Math.floor(rnd() * 3);
    let shape;
    if (kind === 0) {
      shape = '<circle cx="' + n1(rnd() * 100) + '" cy="' + n1(rnd() * 100) + '" r="' + n1(5 + rnd() * 35) + '"';
    } else if (kind === 1) {
      shape = '<rect x="' + n1(rnd() * 100) + '" y="' + n1(rnd() * 100) + '" width="' + n1(5 + rnd() * 45) +
        '" height="' + n1(5 + rnd() * 45) + '"';
    } else {
      const pts = [];
      for (let k = 0; k < 3; k++) pts.push(n1(rnd() * 100) + ',' + n1(rnd() * 100));
      shape = '<polygon points="' + pts.join(' ') + '"';
    }
    shape += ' fill="' + palette[1 + Math.floor(rnd() * 3)] + '"';
    if (rnd() < 0.5) shape += ' opacity="' + n1(0.5 + rnd() * 0.5) + '"';
    if (kind === 1) shape += ' transform="rotate(' + n1(rnd() * 100) + ' 50 50)"';
    out += shape + '/>';
  }
  return out + '</svg>';
}

module.exports = { artSvg };
