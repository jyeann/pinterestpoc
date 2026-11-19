'use strict';

const { fnv1a32 } = require('./hash');

const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

function isPlainObject(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function isId(s) {
  return typeof s === 'string' && ID_RE.test(s);
}

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function clampRound(v) {
  return Math.round(Math.min(1000, Math.max(0, v)));
}

function coords(body) {
  const src = body !== null && typeof body === 'object' ? body : {};
  const hasX = src.x !== undefined;
  const hasY = src.y !== undefined;
  if (!hasX && !hasY) return { ok: true, absent: true };
  if (!hasX || !hasY || !isNum(src.x) || !isNum(src.y)) return { ok: false, code: 'bad_coords' };
  return { ok: true, x: clampRound(src.x), y: clampRound(src.y) };
}

function defaultPos(key, pinCount) {
  const h = fnv1a32('pos:' + key + ':' + pinCount);
  return { x: 100 + (h % 801), y: 100 + ((h >>> 12) % 801) };
}

module.exports = { coords, defaultPos, isId, isPlainObject };
