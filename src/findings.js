'use strict';

const { fnv1a32 } = require('./hash');

const TEMPLATES = [
  '{A} and {B} were never seen in the same room. That is not an accident.',
  'Ask yourself who benefits when {A} and {B} are mentioned together.',
  'Every record of {A} was edited the week {B} appeared. Coincidence?',
  '{A} is just {B} with better public relations.',
  'The paperwork linking {A} to {B} was shredded. Neatly.',
  'Nobody has ever seen {A} and {B} in the same photograph. Think about that.',
  'A source close to {A} says {B} knew all along.',
  'The timing of {A} and {B} is far too convenient.',
  'Follow the money from {A} to {B}. It goes in a circle.',
  '{A} denies knowing {B}. That is exactly what they would say.',
  'There is a locked drawer marked {A}, and the key is labelled {B}.',
  'Experts agree that {A} and {B} share a single, very quiet author.',
  'The pattern between {A} and {B} only shows up when you stop looking for it.',
  'If {A} is the question, {B} is the answer they do not want printed.',
  'Someone paid good money to keep {A} away from {B}.',
  'Three independent witnesses confirm {A} and {B} are somehow related.',
  'The official story never mentions {A} or {B}. Suspicious silence.',
  'A strange hum was recorded whenever {A} met {B}.',
];

function finding(phraseA, phraseB) {
  const a = String(phraseA);
  const b = String(phraseB);
  const ka = a.toLowerCase();
  const kb = b.toLowerCase();
  let swap;
  if (ka !== kb) swap = kb < ka;
  else swap = b < a;
  const first = swap ? b : a;
  const second = swap ? a : b;
  const k1 = swap ? kb : ka;
  const k2 = swap ? ka : kb;
  const h = fnv1a32('finding:' + k1 + '\u0000' + k2);
  return TEMPLATES[h % TEMPLATES.length]
    .replace('{A}', () => first)
    .replace('{B}', () => second);
}

module.exports = { finding, TEMPLATES };
