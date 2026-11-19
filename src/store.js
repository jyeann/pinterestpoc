'use strict';
// In-memory walls and mutations (design 2.7, 3, 4). Every mutation returns {ok:true, ..., meta} or {ok:false, code}
// and notifies listeners synchronously after the commit.
const crypto = require('node:crypto');
const { normalizePhrase, normalizeTitle } = require('./normalize');
const { coords, defaultPos, isId, isPlainObject } = require('./validate');
const { artSvg } = require('./art');
const { finding } = require('./findings');
const { score } = require('./score');
const detective = require('./detective');

const LIMITS = { pins: 100, strings: 500, walls: 10000 };

const rid = (bytes) => crypto.randomBytes(bytes).toString('base64url');
const fail = (code) => ({ ok: false, code });
const copyPin = (p) => ({ id: p.id, phrase: p.phrase, x: p.x, y: p.y, art: p.art, createdAt: p.createdAt });
const copyString = (s) => ({ id: s.id, a: s.a, b: s.b, finding: s.finding, createdAt: s.createdAt });
const metaOf = (w) => ({ ...score(w), version: w.version });

function wallJson(w) {
  return {
    id: w.id,
    title: w.title,
    createdAt: w.createdAt,
    version: w.version,
    pins: w.pins.map(copyPin),
    strings: w.strings.map(copyString),
    ...score(w),
  };
}

function createStore(opts = {}) {
  const walls = new Map();
  const listeners = [];
  if (typeof opts.onChange === 'function') listeners.push(opts.onChange);
  const now = opts.now || (() => new Date().toISOString());

  function emit(wallId, name, data) {
    for (const fn of listeners.slice()) {
      try { fn(wallId, name, data); } catch { /* the mutation is already committed */ }
    }
  }

  function uniqueId(prefix, bytes, taken) {
    for (;;) {
      const id = prefix + rid(bytes);
      if (!taken(id)) return id;
    }
  }

  function commit(w, name, data) {
    w.version += 1;
    const meta = metaOf(w);
    emit(w.id, name, { ...data, ...meta });
    return meta;
  }

  const pinById = (w, pid) => w.pins.find((p) => p.id === pid);
  const bodyOf = (body) => (isPlainObject(body) ? body : {});

  return {
    subscribe(fn) { listeners.push(fn); },

    createWall(body) {
      const b = bodyOf(body);
      let title = null;
      if (b.title !== undefined) {
        const t = normalizeTitle(b.title);
        if (!t.ok) return fail(t.code);
        title = t.value;
      }
      if (walls.size >= LIMITS.walls) return fail('capacity');
      const id = uniqueId('', 9, (x) => walls.has(x));
      const w = { id, title: title === null ? `Case #${id}` : title, createdAt: now(), version: 0, pins: [], strings: [] };
      walls.set(id, w);
      const wall = wallJson(w);
      emit(id, 'wall-created', wall);
      return { ok: true, wall, meta: metaOf(w) };
    },

    getWall(id) {
      const w = walls.get(id);
      return w ? wallJson(w) : null;
    },

    setTitle(id, raw) {
      const w = walls.get(id);
      if (!w) return fail('not_found');
      const t = normalizeTitle(raw);
      if (!t.ok) return fail(t.code);
      w.title = t.value;
      const meta = commit(w, 'title', { title: w.title });
      return { ok: true, title: w.title, meta };
    },

    addPin(id, body) {
      const w = walls.get(id);
      if (!w) return fail('not_found');
      const b = bodyOf(body);
      const n = normalizePhrase(b.phrase);
      if (!n.ok) return fail(n.code);
      const c = coords(b);
      if (!c.ok) return fail(c.code);
      if (w.pins.length >= LIMITS.pins) return fail('wall_full');
      const pos = c.absent ? defaultPos(n.key, w.pins.length) : { x: c.x, y: c.y };
      const pin = {
        id: uniqueId('p', 6, (x) => Boolean(pinById(w, x))),
        phrase: n.value,
        x: pos.x,
        y: pos.y,
        art: artSvg(n.value),
        createdAt: now(),
      };
      w.pins.push(pin);
      const meta = commit(w, 'pin-added', { pin: copyPin(pin) });
      return { ok: true, pin: copyPin(pin), meta };
    },

    movePin(id, pid, body) {
      const w = walls.get(id);
      if (!w) return fail('not_found');
      const pin = pinById(w, pid);
      if (!pin) return fail('not_found');
      const c = coords(bodyOf(body));
      if (!c.ok || c.absent) return fail('bad_coords');
      pin.x = c.x;
      pin.y = c.y;
      const meta = commit(w, 'pin-moved', { id: pin.id, x: pin.x, y: pin.y });
      return { ok: true, pin: copyPin(pin), meta };
    },

    removePin(id, pid) {
      const w = walls.get(id);
      if (!w) return fail('not_found');
      const idx = w.pins.findIndex((p) => p.id === pid);
      if (idx < 0) return fail('not_found');
      const [pin] = w.pins.splice(idx, 1);
      const removedStrings = w.strings.filter((s) => s.a === pid || s.b === pid).map((s) => s.id);
      w.strings = w.strings.filter((s) => s.a !== pid && s.b !== pid);
      const meta = commit(w, 'pin-removed', { id: pid, phrase: pin.phrase, removedStrings });
      return { ok: true, id: pid, removedStrings: removedStrings.slice(), meta };
    },

    addString(id, a, b) {
      const w = walls.get(id);
      if (!w) return fail('not_found');
      if (typeof a === 'string' && a === b) return fail('self_link');
      const pa = typeof a === 'string' ? pinById(w, a) : undefined;
      const pb = typeof b === 'string' ? pinById(w, b) : undefined;
      if (!pa || !pb) return fail('bad_pin');
      if (w.strings.some((s) => (s.a === a && s.b === b) || (s.a === b && s.b === a))) return fail('duplicate_string');
      if (w.strings.length >= LIMITS.strings) return fail('strings_full');
      const str = {
        id: uniqueId('s', 6, (x) => w.strings.some((s) => s.id === x)),
        a,
        b,
        finding: finding(pa.phrase, pb.phrase),
        createdAt: now(),
      };
      w.strings.push(str);
      const meta = commit(w, 'string-added', { string: copyString(str) });
      return { ok: true, string: copyString(str), meta };
    },

    removeString(id, sid) {
      const w = walls.get(id);
      if (!w) return fail('not_found');
      const idx = w.strings.findIndex((s) => s.id === sid);
      if (idx < 0) return fail('not_found');
      w.strings.splice(idx, 1);
      const meta = commit(w, 'string-removed', { id: sid });
      return { ok: true, id: sid, meta };
    },

    // Does not mutate: no version bump, no event.
    detective(id) {
      const w = walls.get(id);
      if (!w) return fail('not_found');
      const result = detective.suggest(w);
      const message = detective.message(result, w);
      if (result.pair) return { ok: true, suggestion: { a: result.pair[0], b: result.pair[1], message } };
      return { ok: true, suggestion: null, reason: result.decline, message };
    },

    toJSON() {
      return {
        format: 1,
        walls: [...walls.values()].map((w) => ({
          id: w.id, title: w.title, createdAt: w.createdAt, version: w.version,
          pins: w.pins.map(copyPin), strings: w.strings.map(copyString),
        })),
      };
    },

    // Replaces the contents with the valid parts of `data`; art and findings are recomputed. Returns wall count.
    load(data) {
      walls.clear();
      if (!isPlainObject(data) || !Array.isArray(data.walls)) return 0;
      for (const rec of data.walls) {
        if (walls.size >= LIMITS.walls) break;
        const w = loadWall(rec);
        if (w && !walls.has(w.id)) walls.set(w.id, w);
      }
      return walls.size;
    },
  };

  function loadWall(rec) {
    if (!isPlainObject(rec) || !isId(rec.id)) return null;
    const t = normalizeTitle(rec.title);
    const w = {
      id: rec.id,
      title: t.ok ? t.value : `Case #${rec.id}`,
      createdAt: typeof rec.createdAt === 'string' ? rec.createdAt : now(),
      version: Number.isInteger(rec.version) && rec.version >= 0 ? rec.version : 0,
      pins: [],
      strings: [],
    };
    for (const p of Array.isArray(rec.pins) ? rec.pins : []) {
      if (w.pins.length >= LIMITS.pins) break;
      if (!isPlainObject(p) || !isId(p.id) || pinById(w, p.id)) continue;
      const n = normalizePhrase(p.phrase);
      const c = coords(p);
      if (!n.ok || !c.ok || c.absent) continue;
      w.pins.push({
        id: p.id, phrase: n.value, x: c.x, y: c.y, art: artSvg(n.value),
        createdAt: typeof p.createdAt === 'string' ? p.createdAt : w.createdAt,
      });
    }
    for (const s of Array.isArray(rec.strings) ? rec.strings : []) {
      if (w.strings.length >= LIMITS.strings) break;
      if (!isPlainObject(s) || !isId(s.id) || w.strings.some((x) => x.id === s.id)) continue;
      const pa = typeof s.a === 'string' ? pinById(w, s.a) : undefined;
      const pb = typeof s.b === 'string' ? pinById(w, s.b) : undefined;
      if (!pa || !pb || s.a === s.b) continue;
      if (w.strings.some((x) => (x.a === s.a && x.b === s.b) || (x.a === s.b && x.b === s.a))) continue;
      w.strings.push({
        id: s.id, a: s.a, b: s.b, finding: finding(pa.phrase, pb.phrase),
        createdAt: typeof s.createdAt === 'string' ? s.createdAt : w.createdAt,
      });
    }
    return w;
  }
}

module.exports = { createStore, LIMITS };
