'use strict';

const ZERO_WIDTH = /[​-‍⁠﻿]/g;
// Cc characters that are not whitespace (tab, LF, VT, FF, CR are whitespace and kept for collapsing).
const CONTROL_NON_WS = /(?![\s])\p{Cc}/gu;
const MAX_CODE_POINTS = 60;

function normalizeText(raw, codes) {
  if (typeof raw !== 'string') return { ok: false, code: codes.invalid };
  let s = raw.normalize('NFC');
  s = s.replace(CONTROL_NON_WS, '').replace(ZERO_WIDTH, '');
  s = s.replace(/\s+/gu, ' ').trim();
  if (s.length === 0) return { ok: false, code: codes.empty };
  if ([...s].length > MAX_CODE_POINTS) return { ok: false, code: codes.tooLong };
  return { ok: true, value: s, key: s.toLowerCase() };
}

function normalizePhrase(raw) {
  return normalizeText(raw, { invalid: 'phrase_invalid', empty: 'phrase_empty', tooLong: 'phrase_too_long' });
}

function normalizeTitle(raw) {
  return normalizeText(raw, { invalid: 'title_empty', empty: 'title_empty', tooLong: 'title_too_long' });
}

module.exports = { normalizePhrase, normalizeTitle };
