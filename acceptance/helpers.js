'use strict';
// HTTP-only helpers for the Red String acceptance and holdout tests.
// Spawns the real server as a child process and talks to it over HTTP.
// Paths resolve from this file's directory so a copy of the project (mutation run) tests itself.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

// design.md section 1: `node src/main.js` is the entry that listens. Fall back to src/server.js if only that exists.
function entryFile() {
  for (const f of ['main.js', 'server.js']) {
    const p = path.join(ROOT, 'src', f);
    if (fs.existsSync(p)) return p;
  }
  throw new Error('server entry missing: neither src/main.js nor src/server.js exists');
}

const STRIP_ENV = ['PORT', 'HOST', 'RED_STRING_DATA', 'RATE_LIMIT'];
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'redstring-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, ms = 8000, what = 'condition') {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(20);
  }
}

// call(method, path, body, {raw, headers, clientId}) -> {status, headers, body, text}
function makeCall(base) {
  return async (method, urlPath, body, opts = {}) => {
    const headers = {};
    let payload;
    if (opts.raw !== undefined) payload = opts.raw;
    else if (body !== undefined) payload = JSON.stringify(body);
    if (payload !== undefined) headers['content-type'] = 'application/json';
    if (opts.clientId) headers['x-client-id'] = opts.clientId;
    for (const [k, v] of Object.entries(opts.headers || {})) headers[k.toLowerCase()] = v;
    const res = await fetch(base + urlPath, { method, headers, body: payload });
    const text = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, headers: Object.fromEntries(res.headers), body: parsed, text };
  };
}

// Raw path GET that keeps the path byte-for-byte (fetch would normalise "..").
function rawGet(server, rawPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.port, method: 'GET', path: rawPath, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

// opts: {dataFile, rateLimit (true = leave the limiter on), env}
async function startServer(opts = {}) {
  const env = { ...process.env };
  for (const k of STRIP_ENV) delete env[k];
  env.PORT = '0';
  if (!opts.rateLimit) env.RATE_LIMIT = '0';
  if (opts.dataFile) env.RED_STRING_DATA = opts.dataFile;
  Object.assign(env, opts.env || {});
  const child = spawn(process.execPath, [entryFile()], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (c) => { stdout += c; });
  child.stderr.on('data', (c) => { stderr += c; });
  let exitInfo = null;
  const stopped = new Promise((resolve) => {
    child.once('exit', (code, signal) => { exitInfo = { code, signal }; resolve(exitInfo); });
  });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`server did not print "listening on http://127.0.0.1:<port>" within 10s. stdout: ${stdout} stderr: ${stderr}`)); }, 10000);
    const check = () => {
      const m = /^listening on http:\/\/127\.0\.0\.1:(\d+)$/m.exec(stdout);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    };
    child.stdout.on('data', check);
    stopped.then((info) => { clearTimeout(timer); reject(new Error(`server exited early (code ${info.code}, signal ${info.signal}). stderr: ${stderr}`)); });
  });
  const base = `http://127.0.0.1:${port}`;
  const stop = async () => {
    if (exitInfo) return exitInfo;
    child.kill('SIGTERM');
    const killer = setTimeout(() => child.kill('SIGKILL'), 8000);
    const info = await stopped;
    clearTimeout(killer);
    return info;
  };
  return { base, port, call: makeCall(base), stop, child, logs: () => ({ stdout, stderr }) };
}

async function restart(server, opts) {
  await server.stop();
  return startServer(opts);
}

// ---- wall building helpers (each returns what the API returned) ----
async function createWall(s, title) {
  const res = await s.call('POST', '/api/walls', title === undefined ? undefined : { title });
  return { res, id: res.body && res.body.id };
}
async function addPin(s, wallId, phrase, xy) {
  const body = { phrase };
  if (xy) { body.x = xy[0]; body.y = xy[1]; }
  const res = await s.call('POST', `/api/walls/${wallId}/pins`, body);
  return { res, pin: res.body && res.body.pin, id: res.body && res.body.pin && res.body.pin.id };
}
async function tie(s, wallId, a, b, opts) {
  const res = await s.call('POST', `/api/walls/${wallId}/strings`, { a, b }, opts);
  return { res, string: res.body && res.body.string };
}
const getWall = (s, id) => s.call('GET', `/api/walls/${id}`);

// n distinct pins "<prefix> <i>" added in order; returns ids
async function addPins(s, wallId, n, prefix = 'evidence') {
  const ids = [];
  for (let i = 0; i < n; i += 1) {
    const r = await addPin(s, wallId, `${prefix} ${i}`);
    if (r.res.status !== 201) throw new Error(`addPin ${i} failed: ${r.res.status} ${r.res.text}`);
    ids.push(r.id);
  }
  return ids;
}
// tie edges [[i,j],...] over pin id list, sequentially; throws on non-201
async function tieEdges(s, wallId, ids, edges) {
  for (const [i, j] of edges) {
    const r = await tie(s, wallId, ids[i], ids[j]);
    if (r.res.status !== 201) throw new Error(`tie ${i}-${j} failed: ${r.res.status} ${r.res.text}`);
  }
}
// wall with n pins and the given edges; returns {id, ids, last (last tie response body)}
async function buildGraph(s, n, edges, title) {
  const { id } = await createWall(s, title);
  const ids = await addPins(s, id, n);
  await tieEdges(s, id, ids, edges);
  return { id, ids };
}
const allPairs = (n) => { const out = []; for (let i = 0; i < n; i += 1) for (let j = i + 1; j < n; j += 1) out.push([i, j]); return out; };

// ---- spec formulas, written independently of the code under test (design 2.5, 2.2, 2.6) ----
// score = 10*S + 2*C + 5 * sum(max(0, deg-1))
function scoreOf(n, edges) {
  const deg = new Array(n).fill(0);
  for (const [i, j] of edges) { deg[i] += 1; deg[j] += 1; }
  const C = deg.filter((d) => d >= 1).length;
  return 10 * edges.length + 2 * C + 5 * deg.reduce((a, d) => a + Math.max(0, d - 1), 0);
}
const THRESHOLDS = [0, 20, 60, 120, 200];
const STATUSES = ['Hunch', 'Theory', 'Pattern', 'Cover-up', "They don't want you to know"];
function levelOf(score) { let l = 0; THRESHOLDS.forEach((t, i) => { if (score >= t) l = i; }); return l; }

function fnv1a32(str) {
  let h = 2166136261;
  for (const b of Buffer.from(str, 'utf8')) { h ^= b; h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ---- SSE ----
// openEvents(server, wallId, {clientId}) -> stream with .res, .frames, .events, .raw, .waitEvent(pred), .close()
async function openEvents(server, wallId, opts = {}) {
  const ctrl = new AbortController();
  const headers = {};
  if (opts.clientId) headers['x-client-id'] = opts.clientId;
  const res = await fetch(`${server.base}/api/walls/${wallId}/events`, { headers, signal: ctrl.signal });
  const stream = { res, raw: '', frames: [], events: [], ended: false, ctrl };
  if (res.status !== 200 || !res.body) { stream.close = () => ctrl.abort(); return stream; }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  stream.done = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = dec.decode(value, { stream: true });
        stream.raw += chunk;
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          stream.frames.push(frame);
          const ev = { id: undefined, event: undefined, dataText: '', data: undefined };
          for (const line of frame.split('\n')) {
            if (line.startsWith(':')) continue;
            const k = line.indexOf(':');
            const name = k < 0 ? line : line.slice(0, k);
            const val = k < 0 ? '' : line.slice(k + 1).replace(/^ /, '');
            if (name === 'id') ev.id = val;
            else if (name === 'event') ev.event = val;
            else if (name === 'data') ev.dataText += val;
          }
          if (ev.event) {
            try { ev.data = JSON.parse(ev.dataText); } catch { /* leave undefined */ }
            stream.events.push(ev);
          }
        }
      }
    } catch { /* aborted */ }
    stream.ended = true;
  })();
  stream.waitEvent = (pred, ms = 6000) => waitFor(() => stream.events.find(pred), ms, 'SSE event');
  stream.close = () => ctrl.abort();
  return stream;
}

// ---- tiny HTML helpers (no DOM available) ----
const decodeEntities = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#0*39;|&#x0*27;|&apos;/gi, "'").replace(/&amp;/g, '&');
// opening tags carrying data-testid="<id>" -> [{tag, attrs, start, end, name}]
function tagsWith(html, testid) {
  const out = [];
  const re = new RegExp(`<([a-zA-Z][a-zA-Z0-9]*)\\b[^>]*\\bdata-testid="${testid}"[^>]*>`, 'g');
  let m;
  while ((m = re.exec(html))) out.push({ tag: m[0], name: m[1], start: m.index, end: m.index + m[0].length });
  return out;
}
const attrOf = (tag, name) => { const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag); return m ? decodeEntities(m[1]) : null; };
// inner html of an element found by tagsWith (balanced on the same tag name)
function innerOf(html, t) {
  const open = new RegExp(`<${t.name}\\b`, 'g');
  const close = new RegExp(`</${t.name}\\s*>`, 'g');
  let depth = 1;
  let pos = t.end;
  for (;;) {
    open.lastIndex = pos; close.lastIndex = pos;
    const o = open.exec(html);
    const c = close.exec(html);
    if (!c) return html.slice(t.end);
    if (o && o.index < c.index) { depth += 1; pos = o.index + 1; } else {
      depth -= 1;
      if (depth === 0) return html.slice(t.end, c.index);
      pos = c.index + 1;
    }
  }
}
const textOf = (html, testid, n = 0) => {
  const t = tagsWith(html, testid)[n];
  if (!t) return null;
  return decodeEntities(innerOf(html, t).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
};
const hasTestId = (html, testid) => tagsWith(html, testid).length > 0;

module.exports = {
  ROOT, startServer, restart, tmpDir, sleep, waitFor, rawGet, makeCall,
  createWall, addPin, tie, getWall, addPins, tieEdges, buildGraph, allPairs,
  scoreOf, levelOf, THRESHOLDS, STATUSES, fnv1a32, openEvents,
  decodeEntities, tagsWith, attrOf, innerOf, textOf, hasTestId,
};
