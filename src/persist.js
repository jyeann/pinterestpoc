'use strict';
// Persistence (design 6): load with corrupt-file quarantine, debounced atomic save, synchronous flush.
const fs = require('node:fs');
const path = require('node:path');

function createPersist(opts) {
  const file = opts.file;
  const getData = opts.getData;
  const delay = opts.delay === undefined ? 50 : opts.delay;
  const log = opts.log || ((line) => process.stderr.write(`${line}\n`));
  const nowMs = opts.nowMs || Date.now;
  let timer = null;
  let dirty = false;

  function quarantine(reason) {
    const target = `${file}.corrupt-${nowMs()}`;
    try {
      fs.renameSync(file, target);
      log(`persist: data file unusable (${reason}); moved to ${target}, starting empty`);
    } catch (err) {
      log(`persist: data file unusable (${reason}); could not move it aside (${err.code || 'error'}), starting empty`);
    }
  }

  // -> parsed {format:1, walls:[...]} or null (missing or quarantined)
  function load() {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      quarantine(`read ${err.code || 'error'}`);
      return null;
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      quarantine('invalid JSON');
      return null;
    }
    if (data === null || typeof data !== 'object' || data.format !== 1 || !Array.isArray(data.walls)) {
      quarantine('wrong format');
      return null;
    }
    return data;
  }

  function writeNow() {
    const tmp = `${file}.tmp-${process.pid}`;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(getData()));
      fs.renameSync(tmp, file);
      return true;
    } catch (err) {
      log(`persist: save failed (${err.code || 'error'}); memory stays authoritative`);
      try { fs.rmSync(tmp, { force: true }); } catch { /* nothing to clean */ }
      return false;
    }
  }

  function scheduleSave() {
    dirty = true;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (writeNow()) dirty = false;
    }, delay);
    if (timer.unref) timer.unref();
  }

  // Synchronous: writes now if a save is pending. Returns true when a write was attempted and succeeded.
  function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!dirty) return false;
    if (!writeNow()) return false;
    dirty = false;
    return true;
  }

  return { load, scheduleSave, flush, pending: () => dirty };
}

module.exports = { createPersist };
