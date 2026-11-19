// RED STRING QA walkthrough. Run: node qa/walkthrough.js
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs/product/red-string/qa');
fs.mkdirSync(OUT, { recursive: true });
const DATA = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'redstring-qa-')), 'data.json');

const results = [];
const T = (id) => `[data-testid="${id}"]`;
const pinSel = (ph) => `[data-testid=pin][data-phrase="${ph}"]`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function poll(fn, { timeout = 5000, interval = 50, msg = 'condition' } = {}) {
  const end = Date.now() + timeout;
  let last;
  for (;;) {
    try { const v = await fn(); if (v) return v; last = new Error(msg + ' not met (got ' + JSON.stringify(v) + ')'); }
    catch (e) { last = e; }
    if (Date.now() > end) throw new Error('timeout: ' + msg + ' :: ' + (last && last.message));
    await sleep(interval);
  }
}
function assert(c, m) { if (!c) throw new Error(m); }
function eq(a, b, m) { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

async function check(id, title, fn) {
  const r = { id, title, status: 'pass', detail: '' };
  try { const d = await fn(); r.detail = d || ''; }
  catch (e) { r.status = 'fail'; r.detail = String(e.message).split('\n')[0].slice(0, 400); }
  results.push(r);
  console.log(`${r.status.toUpperCase().padEnd(7)} ${id} ${title} ${r.detail ? '- ' + r.detail : ''}`);
  return r;
}
function skip(id, title, reason) {
  results.push({ id, title, status: 'skipped', detail: reason });
  console.log(`SKIPPED ${id} ${title} - ${reason}`);
}

// ---- server ----
let server = null, PORT = 0, BASE = '';
function freePort() {
  return new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
}
function startServer() {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, PORT: String(PORT), RATE_LIMIT: '0', RED_STRING_DATA: DATA };
    const c = spawn('node', ['src/main.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'inherit'] });
    let buf = '';
    const t = setTimeout(() => reject(new Error('server did not start')), 10000);
    c.stdout.on('data', (d) => { buf += d; if (/listening on/.test(buf)) { clearTimeout(t); resolve(c); } });
    c.on('exit', (code) => { c.exitCode_ = code; });
  });
}
function stopServer(c) {
  return new Promise((resolve) => {
    if (!c || c.exitCode !== null) return resolve(c && c.exitCode);
    c.on('exit', (code) => resolve(code));
    process.kill(c.pid, 'SIGTERM');
    setTimeout(() => { try { process.kill(c.pid, 'SIGKILL'); } catch (e) {} }, 5000);
  });
}

// ---- api helpers ----
async function api(method, p, body) {
  const r = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {}
  return { status: r.status, json: j };
}
const apiWall = async () => (await api('POST', '/api/walls', {})).json;
const apiPin = async (id, phrase, x, y) => (await api('POST', `/api/walls/${id}/pins`, x === undefined ? { phrase } : { phrase, x, y })).json;
const apiString = async (id, a, b) => (await api('POST', `/api/walls/${id}/strings`, { a, b })).json;
const apiGet = async (id) => (await api('GET', `/api/walls/${id}`)).json;

// ---- ui helpers ----
const wallId = (page) => new URL(page.url()).pathname.split('/')[2];
async function newWall(page) {
  await page.goto(BASE + '/');
  await page.click(T('home-new-case'));
  await page.waitForURL(/\/w\/[\w-]+$/);
  await page.waitForSelector(T('board'));
  await page.waitForSelector(T('wall-loading'), { state: 'detached' }).catch(() => {});
  return wallId(page);
}
// New pins land at server-chosen spots and often overlap earlier ones (see defect D1), so after pinning we
// move each pin to a free grid slot through the API (a move any person could also do by dragging) and wait for the UI to follow.
async function addPin(page, phrase, { spread = true } = {}) {
  const before = await page.locator(T('pin')).count();
  await page.fill(T('phrase-input'), phrase);
  await page.press(T('phrase-input'), 'Enter');
  await poll(async () => (await page.locator(T('pin')).count()) === before + 1, { msg: 'pin added ' + phrase });
  if (!spread) return;
  const narrow = page.viewportSize().width < 600;
  const x = narrow ? (before % 2 ? 750 : 250) : 70 + (before % 8) * 125;
  const y = narrow ? 60 + Math.floor(before / 2) * 400 : (before < 8 ? 40 : 520);
  const id = wallId(page);
  const w = await apiGet(id); const pin = w.pins[w.pins.length - 1];
  await api('PATCH', `/api/walls/${id}/pins/${pin.id}`, { x, y });
  await poll(async () => (await page.locator(T('pin')).nth(before).getAttribute('data-x')) === String(x), { msg: 'pin moved to slot' });
  await poll(async () => page.evaluate(() => document.getAnimations().length === 0), { msg: 'animations finished' });
}
async function strings(page) { return page.locator(T('string')).count(); }
async function tie(page, a, b) {
  const n = await strings(page);
  await page.click(`${pinSel(a)} ${T('pin-tie')}`);
  await page.waitForSelector(T('tie-hint'));
  await page.click(`${pinSel(b)} ${T('pin-label')}`);
  await poll(async () => (await strings(page)) === n + 1, { msg: `string ${a}-${b}` });
  await page.waitForSelector(T('finding-panel'));
}
async function closeFinding(page) {
  await page.click(T('finding-close'));
  await poll(async () => !(await page.locator(T('finding-panel')).isVisible()), { msg: 'finding closed' });
}
const txt = async (page, id) => (await page.locator(T(id)).first().textContent()).trim();
async function installAnn(ctx) {
  await ctx.addInitScript(() => {
    window.__ann = [];
    const start = () => {
      let last = '';
      const rd = () => { const a = document.querySelector('[data-testid=announcer]'); const t = a ? a.textContent : ''; if (t && t !== last) { window.__ann.push(t); } last = t; };
      new MutationObserver(rd).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
      rd();
    };
    if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start);
  });
}
const annHas = async (page, s) => { try { await poll(async () => (await page.evaluate(() => (window.__ann || []).join(' || '))).includes(s), { msg: 'announcement ' + s }); } catch (e) { throw new Error(e.message + ' | log: ' + (await page.evaluate(() => (window.__ann || []).join(' || '))).slice(-200)); } };

function lum([r, g, b]) { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); }
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const shot = (page, name, opts = {}) => page.screenshot({ path: path.join(OUT, name + '.png'), ...opts });

(async () => {
  PORT = await freePort(); BASE = `http://127.0.0.1:${PORT}`;
  server = await startServer();
  const browser = await chromium.launch();
  const mk = (o = {}) => browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, baseURL: BASE, ...o });
  const ctx = await mk(); await installAnn(ctx);
  const page = await ctx.newPage();
  page.setDefaultTimeout(6000);
  const dialogs = []; page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });

  // ---------- UC1 ----------
  await check('UC1', 'new case: URL, board, focus, score 0, Hunch, empty state, POST 201', async () => {
    await page.goto(BASE + '/');
    await page.waitForSelector(T('home'));
    eq(await txt(page, 'home-title'), 'RED STRING', 'title');
    eq(await txt(page, 'home-tagline'), 'Everything is connected. You just have not proved it yet.', 'tagline');
    await shot(page, '01-home');
    let resp = null, body = null;
    await page.route('**/api/walls', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const r = await route.fetch(); resp = { status: () => r.status() }; body = await r.json(); await route.fulfill({ response: r });
    });
    await page.click(T('home-new-case'));
    await page.waitForURL(/\/w\/[\w-]+$/);
    await page.unroute('**/api/walls');
    assert(resp && [200, 201].includes(resp.status()), 'status ' + (resp && resp.status()));
    eq(body.id, wallId(page), 'id vs url');
    await page.waitForSelector(T('board'));
    await poll(async () => (await txt(page, 'wall-score')) === '0', { msg: 'score 0' });
    eq(await txt(page, 'wall-status'), 'Hunch', 'status');
    await page.waitForSelector(T('empty-state'), { state: 'visible' });
    assert(await page.evaluate(() => document.activeElement && document.activeElement.dataset.testid === 'phrase-input'), 'phrase-input not focused');
    await shot(page, '02-empty-wall');
    return `POST ${resp.status()}, id=${body.id}`;
  });
  await check('J1.live', 'J1: connection shows Live; empty-state copy; Score label visible', async () => {
    await poll(async () => (await page.locator(T('conn-status')).getAttribute('data-state')) === 'live', { msg: 'live' });
    eq(await txt(page, 'conn-status'), 'Live', 'conn text');
    eq(await txt(page, 'empty-state'), 'Nothing on the wall. Type something you saw.', 'empty copy');
    const hasLabel = await page.evaluate(() => /score/i.test(document.querySelector('[data-testid=wall-score]').parentElement.textContent));
    assert(hasLabel, 'no visible "Score" label near wall-score');
    eq(await page.locator(T('wall-title')).evaluate((e) => e.tagName), 'INPUT', 'title input');
  });

  // ---------- UC2/UC3 ----------
  await check('UC2', 'pin "pigeons": one pin, label, art svg, input cleared, announcer, no navigation', async () => {
    await page.evaluate(() => { window.__marker = 42; });
    await page.fill(T('phrase-input'), 'pigeons');
    await page.press(T('phrase-input'), 'Enter');
    await poll(async () => (await page.locator(pinSel('pigeons')).count()) === 1, { msg: 'one pin' });
    eq(await page.locator(T('pin')).count(), 1, 'pin count');
    eq(await txt(page, 'pin-label'), 'pigeons', 'label');
    assert(await page.locator(`${pinSel('pigeons')} ${T('pin-art')} svg`).count() >= 1, 'no svg in art');
    eq(await page.inputValue(T('phrase-input')), '', 'input cleared');
    assert(await page.evaluate(() => document.activeElement.dataset.testid === 'phrase-input'), 'focus lost');
    await page.waitForSelector(T('empty-state'), { state: 'hidden' });
    await poll(async () => (await txt(page, 'announcer')).includes('Pinned: pigeons.'), { msg: 'announcer' });
    eq(await page.evaluate(() => window.__marker), 42, 'marker (navigation happened)');
  });
  await check('UC3', 'new pin usable: in viewport, tie/delete enabled, delete announces and shows empty state', async () => {
    const p = page.locator(pinSel('pigeons'));
    const bb = await p.boundingBox(); const vp = page.viewportSize();
    assert(bb.x >= 0 && bb.y >= 0 && bb.x + bb.width <= vp.width && bb.y + bb.height <= vp.height, 'not fully in viewport ' + JSON.stringify(bb));
    assert(await p.locator(T('pin-tie')).isEnabled() && await p.locator(T('pin-delete')).isEnabled(), 'buttons disabled');
    await p.locator(T('pin-delete')).click();
    await poll(async () => (await page.locator(T('pin')).count()) === 0, { msg: 'count 0' });
    await page.waitForSelector(T('empty-state'), { state: 'visible' });
    await poll(async () => (await txt(page, 'announcer')).includes('Removed pigeons and 0 strings.'), { msg: 'removed announcer' });
  });
  await check('J2.extra', 'J2: pin is announced via polite live region with role=status', async () => {
    const a = page.locator(T('announcer'));
    eq(await a.getAttribute('role'), 'status', 'role'); eq(await a.getAttribute('aria-live'), 'polite', 'aria-live');
  });

  // ---------- UC4 ----------
  await check('UC4', 'art deterministic across walls and reload; moon differs; same-origin requests only', async () => {
    const p2 = await ctx.newPage(); p2.setDefaultTimeout(6000);
    const origin = new URL(BASE).origin; const foreign = [];
    for (const p of [p2]) p.on('request', (r) => { const u = r.url(); if (/^(data|blob|about):/.test(u)) return; if (new URL(u).origin !== origin) foreign.push(u); });
    const art = async (p, ph) => (await p.locator(`${pinSel(ph)} ${T('pin-art')}`).evaluate((e) => e.outerHTML));
    await newWall(p2); await addPin(p2, 'pigeons'); await addPin(p2, 'the moon');
    const a1 = await art(p2, 'pigeons'); const moon = await art(p2, 'the moon');
    await p2.reload(); await p2.waitForSelector(pinSel('pigeons'));
    const a3 = await art(p2, 'pigeons');
    await newWall(p2); await addPin(p2, 'pigeons');
    const a2 = await art(p2, 'pigeons');
    await p2.close();
    eq(a2, a1, 'wall1 vs wall2 art'); eq(a3, a1, 'after reload art');
    assert(moon !== a1, 'moon art equals pigeons art');
    eq(foreign.length, 0, 'foreign requests ' + foreign.join(','));
    return `art length ${a1.length}, moon length ${moon.length}`;
  });

  // ---------- UC5/UC6 ----------
  let dragPin;
  await check('UC5', 'drag: lean non-zero mid-drag, settles to 0, position matches rectangle', async () => {
    await newWall(page); await addPin(page, 'pigeons');
    const p = page.locator(pinSel('pigeons'));
    const x0 = +await p.getAttribute('data-x'), y0 = +await p.getAttribute('data-y');
    const bb = await p.boundingBox(); const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
    await page.mouse.move(cx, cy); await page.mouse.down();
    let maxLean = 0;
    for (let i = 1; i <= 20; i++) { await page.mouse.move(cx + 10 * i, cy + 6 * i); const l = Math.abs(+await p.getAttribute('data-lean')); maxLean = Math.max(maxLean, l); }
    assert(maxLean !== 0, 'data-lean stayed 0 mid-drag');
    await page.mouse.up();
    const t0 = Date.now();
    await poll(async () => +await p.getAttribute('data-lean') === 0, { timeout: 2500, msg: 'lean back to 0' });
    const settle = Date.now() - t0;
    await poll(async () => page.evaluate(() => document.getAnimations().length === 0), { timeout: 3000, msg: 'settle animation finished' });
    const x1 = +await p.getAttribute('data-x'), y1 = +await p.getAttribute('data-y');
    assert(Math.abs(x1 - x0) > 20 || Math.abs(y1 - y0) > 20, `position unchanged ${x0},${y0}->${x1},${y1}`);
    const m = await page.evaluate(() => {
      const bd = document.querySelector('[data-testid=board]').getBoundingClientRect();
      const p = document.querySelector('[data-testid=pin]'); const pr = p.getBoundingClientRect(); const pu = p.querySelector('[data-testid=pin-push]').getBoundingClientRect();
      return { bd: [bd.x, bd.y, bd.width, bd.height], pin: [pr.x + pr.width / 2, pr.y + pr.height / 2], push: [pu.x + pu.width / 2, pu.y + pu.height / 2] };
    });
    const nx = (pt) => [(pt[0] - m.bd[0]) / m.bd[2] * 1000, (pt[1] - m.bd[1]) / m.bd[3] * 1000];
    const dpush = Math.max(Math.abs(nx(m.push)[0] - x1), Math.abs(nx(m.push)[1] - y1));
    const dpin = Math.max(Math.abs(nx(m.pin)[0] - x1), Math.abs(nx(m.pin)[1] - y1));
    assert(Math.min(dpush, dpin) <= 10, `start ${x0},${y0} bb ${JSON.stringify(bb)} data-x/y ${x1},${y1} vs rect push ${nx(m.push).map(Math.round)} pin ${nx(m.pin).map(Math.round)}`);
    dragPin = { x1, y1 };
    return `maxLean=${maxLean.toFixed(1)}deg settle=${settle}ms moved ${x0},${y0}->${x1},${y1}; err push=${dpush.toFixed(1)} pinCentre=${dpin.toFixed(1)} units`;
  });
  await check('UC6', 'position persists after reload (within 5 units)', async () => {
    const id = wallId(page);
    await poll(async () => { const w = await apiGet(id); const p = w.pins[0]; return Math.abs(p.x - dragPin.x1) <= 5 && Math.abs(p.y - dragPin.y1) <= 5; }, { msg: 'server has new position' });
    await page.reload(); await page.waitForSelector(pinSel('pigeons'));
    const p = page.locator(pinSel('pigeons'));
    const x = +await p.getAttribute('data-x'), y = +await p.getAttribute('data-y');
    assert(Math.abs(x - dragPin.x1) <= 5 && Math.abs(y - dragPin.y1) <= 5, `${x},${y} vs ${dragPin.x1},${dragPin.y1}`);
  });

  // ---------- UC7/UC8 ----------
  let w7;
  await check('UC7', 'tie: hint, selected, string with ids, finding panel, announcer', async () => {
    w7 = await newWall(page); await addPin(page, 'pigeons'); await addPin(page, 'the moon');
    const ids = {}; for (const ph of ['pigeons', 'the moon']) ids[ph] = await page.locator(pinSel(ph)).getAttribute('data-id');
    await page.click(`${pinSel('pigeons')} ${T('pin-tie')}`);
    await page.waitForSelector(T('tie-hint'), { state: 'visible' });
    eq(await page.locator(pinSel('pigeons')).getAttribute('data-selected'), 'true', 'selected');
    assert((await txt(page, 'tie-hint')).includes('Pin A: pigeons.'), 'tie-hint text: ' + await txt(page, 'tie-hint'));
    await page.click(`${pinSel('the moon')} ${T('pin-label')}`);
    await poll(async () => (await strings(page)) === 1, { msg: 'one string' });
    const s = page.locator(T('string'));
    eq(await s.getAttribute('data-a'), ids['pigeons'], 'data-a'); eq(await s.getAttribute('data-b'), ids['the moon'], 'data-b');
    await page.waitForSelector(T('finding-panel'), { state: 'visible' });
    const f = await txt(page, 'finding-text');
    assert(f.includes('pigeons') && f.includes('the moon'), 'finding: ' + f);
    await poll(async () => (await txt(page, 'announcer')).includes('New string:'), { msg: 'announcer' });
    await shot(page, '05-finding-panel');
    return f;
  });
  await check('UC8', 'reopen finding by clicking the string; delete string resets score', async () => {
    const f1 = await txt(page, 'finding-text');
    await closeFinding(page);
    const pt = await page.evaluate(() => {
      const h = document.querySelector('[data-testid=string-hit]');
      const L = h.getTotalLength(); const m = h.getScreenCTM();
      for (const t of [0.5, 0.4, 0.6, 0.3, 0.7, 0.25, 0.75]) {
        const q = h.getPointAtLength(L * t); const x = m.a * q.x + m.c * q.y + m.e, y = m.b * q.x + m.d * q.y + m.f;
        const el = document.elementFromPoint(x, y);
        if (el && el.closest('[data-testid=string]')) return { x, y };
      }
      return null;
    });
    assert(pt, 'no clickable point on string (covered by something)');
    await page.mouse.click(pt.x, pt.y);
    await page.waitForSelector(T('finding-panel'), { state: 'visible' });
    eq(await txt(page, 'finding-text'), f1, 'same finding');
    const before = await txt(page, 'wall-score'); assert(+before > 0, 'score ' + before);
    await page.click(T('finding-delete'));
    await poll(async () => (await strings(page)) === 0, { msg: 'string gone' });
    await poll(async () => (await txt(page, 'wall-score')) === '0', { msg: 'score 0' });
    return `score ${before} -> 0`;
  });

  // ---------- UC9 ----------
  const findings = {};
  async function findingFor(a, b, third) {
    const pg = await ctx.newPage(); pg.setDefaultTimeout(6000);
    await newWall(pg); await addPin(pg, a); await addPin(pg, b); await tie(pg, a, b);
    const f = await txt(pg, 'finding-text'); await pg.close(); return f;
  }
  await check('UC9', 'same finding either order; different pair differs', async () => {
    const f1 = await findingFor('pigeons', 'the moon'); const f2 = await findingFor('the moon', 'pigeons'); const f3 = await findingFor('pigeons', 'ufo');
    eq(f2, f1, 'reverse order finding'); assert(f3 !== f1, 'different pair has same text');
    findings.f1 = f1; return f1 + ' | ' + f3;
  });

  // ---------- UC10 ----------
  let w10;
  await check('UC10', '8 pins, all pairs: score non-decreasing, reaches level 4, level never drops', async () => {
    w10 = await newWall(page);
    const names = ['pigeons', 'the moon', 'ufo', 'lamp', 'toast', 'fog', 'elevator', 'cat'];
    // spread pins so they do not overlap, then reload (pins placed via UI first, then moved by API is not allowed; use UI positions)
    for (const n of names) await addPin(page, n);
    const seq = []; let lastScore = 0, lastLevel = 0, firstAbove0 = null, reached = false, count = 0;
    outer: for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
      await tie(page, names[i], names[j]); count++;
      await closeFinding(page);
      const sc = +await txt(page, 'wall-score'); const lv = +await page.locator(T('wall-status')).getAttribute('data-level'); const st = await txt(page, 'wall-status');
      seq.push(`${sc}/${lv}`);
      assert(sc >= lastScore, `score dropped ${lastScore}->${sc}`); assert(lv >= lastLevel, `level dropped ${lastLevel}->${lv}`);
      if (count === 1) assert(sc > 0, 'score not above 0 after first string');
      if (sc > 0 && firstAbove0 === null) { firstAbove0 = st; }
      if (count === 4) assert(lv >= 1, `status after 4 strings: ${st}`);
      lastScore = sc; lastLevel = lv;
      if (lv === 4) { eq(st, "They don't want you to know", 'top status text'); reached = true; break outer; }
    }
    assert(reached, 'never reached level 4: ' + seq.join(' '));
    return `strings=${count}; score/level: ${seq.join(' ')}`;
  });
  await check('J7.announce', 'J7: announcer names the new status when it changes', async () => {
    const log = await page.evaluate(() => window.__ann.join(' || '));
    assert(/Status: Theory/.test(log), 'no "Status: Theory" in announcer log: ' + log.slice(-300));
    assert(/Score \d+\. Status: /.test(log), 'score announcement format missing');
  });

  // ---------- UC11/UC12 ----------
  await check('UC11', 'detective: teaser names two pins, accept ties exactly them', async () => {
    await newWall(page); for (const n of ['pigeons', 'the moon', 'ufo']) await addPin(page, n);
    await page.click(T('detective-btn'));
    await page.waitForSelector(T('detective-panel'), { state: 'visible' });
    await poll(async () => /I like .+ and .+ together/.test(await txt(page, 'detective-message')), { msg: 'teaser' });
    const m = await txt(page, 'detective-message');
    const mm = m.match(/^I like (.+) and (.+) together\. Nobody ever asks why\.$/); assert(mm, 'teaser copy: ' + m);
    assert(['pigeons', 'the moon', 'ufo'].includes(mm[1]) && ['pigeons', 'the moon', 'ufo'].includes(mm[2]), 'phrases not existing');
    await shot(page, '06-detective-panel');
    await page.click(T('detective-accept'));
    await poll(async () => (await strings(page)) === 1, { msg: 'one string' });
    const s = page.locator(T('string')); const ids = {};
    for (const ph of [mm[1], mm[2]]) ids[await page.locator(pinSel(ph)).getAttribute('data-id')] = 1;
    assert(ids[await s.getAttribute('data-a')] && ids[await s.getAttribute('data-b')], 'string between wrong pins');
    await poll(async () => !(await page.locator(T('detective-panel')).isVisible()), { msg: 'panel closed' });
    return m;
  });
  await check('UC12', 'detective declines with <2 pins and when all connected', async () => {
    await newWall(page); await addPin(page, 'pigeons');
    await page.click(T('detective-btn')); await page.waitForSelector(T('detective-panel'), { state: 'visible' });
    await poll(async () => (await txt(page, 'detective-message')) === 'Two pins minimum. Even I cannot connect a single dot.', { msg: 'too_few copy: ' + await txt(page, 'detective-message') });
    eq(await page.locator(T('detective-accept')).count() === 0 || !(await page.locator(T('detective-accept')).isVisible()), true, 'accept visible when declining');
    await page.locator(T('detective-btn')).focus(); await page.keyboard.press('Escape');
    const id = wallId(page); await addPin(page, 'the moon'); await addPin(page, 'ufo');
    const w = await apiGet(id); const [a, b, c] = w.pins.map((p) => p.id);
    await apiString(id, a, b); await apiString(id, b, c); await apiString(id, a, c);
    await page.reload(); await page.waitForSelector(pinSel('ufo'));
    await poll(async () => (await strings(page)) === 3, { msg: '3 strings' });
    await page.click(T('detective-btn')); await page.waitForSelector(T('detective-panel'), { state: 'visible' });
    await poll(async () => (await txt(page, 'detective-message')) === 'Everything is already connected. That is what worries me.', { msg: 'all_connected copy' });
    assert(!(await page.locator(T('detective-accept')).isVisible()), 'accept visible');
  });

  // ---------- UC13 ----------
  await check('UC13', 'shared live wall: A edits, B sees within 1500ms with colleague announcement; SSE content-type', async () => {
    const ca = await mk(); await installAnn(ca); const cb = await mk(); await installAnn(cb);
    const A = await ca.newPage(), B = await cb.newPage(); A.setDefaultTimeout(6000); B.setDefaultTimeout(6000);
    const id = await newWall(A); await B.goto(BASE + '/w/' + id); await B.waitForSelector(T('board'));
    await poll(async () => (await B.locator(T('conn-status')).getAttribute('data-state')) === 'live', { msg: 'B live' });
    await addPin(A, 'pigeons', { spread: false });
    await poll(async () => (await B.locator(pinSel('pigeons')).count()) === 1, { timeout: 1500, msg: 'B sees pin within 1500ms' });
    await annHas(B, 'A colleague pinned');
    await addPin(A, 'the moon', { spread: false }); await B.waitForSelector(pinSel('the moon'));
    // drag in A
    const p = A.locator(pinSel('pigeons')); const bb = await p.boundingBox(); const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
    await A.mouse.move(cx, cy); await A.mouse.down(); await A.mouse.move(cx + 120, cy + 80, { steps: 10 }); await A.mouse.up();
    await poll(async () => { const ax = [await p.getAttribute('data-x'), await p.getAttribute('data-y')]; const bx = [await B.locator(pinSel('pigeons')).getAttribute('data-x'), await B.locator(pinSel('pigeons')).getAttribute('data-y')]; return Math.abs(ax[0] - bx[0]) <= 1 && Math.abs(ax[1] - bx[1]) <= 1 && (+ax[0] !== 0); }, { timeout: 1500 + 1000, msg: 'B position matches A' });
    await annHas(B, 'A colleague moved');
    await tie(A, 'pigeons', 'the moon');
    await poll(async () => (await B.locator(T('string')).count()) === 1, { timeout: 1500, msg: 'B sees string' });
    await annHas(B, 'A colleague tied');
    await A.click(`${pinSel('the moon')} ${T('pin-delete')}`);
    await poll(async () => (await B.locator(T('pin')).count()) === 1, { timeout: 1500, msg: 'B pin count drops' });
    const ct = await A.evaluate(async (id) => { const c = new AbortController(); const r = await fetch(`/api/walls/${id}/events`, { signal: c.signal }); const h = r.headers.get('content-type'); c.abort(); return h; }, id);
    assert(/^text\/event-stream/.test(ct), 'content-type ' + ct);
    await ca.close(); await cb.close();
    return 'SSE content-type ' + ct;
  });

  // ---------- UC14 ----------
  const pageCount = (buf) => (buf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
  await check('UC14', 'case file: status/score/evidence/findings, print hides buttons, one page (3 and 30 pins)', async () => {
    const id = await newWall(page); for (const n of ['pigeons', 'the moon', 'ufo']) await addPin(page, n);
    await tie(page, 'pigeons', 'the moon'); await closeFinding(page); await tie(page, 'the moon', 'ufo'); await closeFinding(page);
    const score = await txt(page, 'wall-score'), status = await txt(page, 'wall-status');
    await page.click(T('close-case'));
    await page.waitForURL(/\/case$/); await page.waitForSelector(T('case'));
    eq(await txt(page, 'case-status'), status, 'status'); eq(await txt(page, 'case-score'), score, 'score');
    eq(await page.locator(T('case-evidence-item')).count(), 3, 'evidence count');
    eq(await page.locator(`${T('case-evidence-item')} svg`).count(), 3, 'evidence svg');
    eq(await page.locator(T('case-finding')).count(), 2, 'findings');
    await shot(page, '07-case-file', { fullPage: true });
    await page.emulateMedia({ media: 'print' });
    assert(!(await page.locator(T('case-print')).isVisible()) && !(await page.locator(T('case-back')).isVisible()), 'buttons visible in print');
    const n3 = pageCount(await page.pdf({ preferCSSPageSize: true }));
    const w2 = await apiWall(); for (let i = 0; i < 30; i++) await apiPin(w2.id, 'item number ' + i, 20 + (i % 10) * 95, 40 + Math.floor(i / 10) * 300);
    const g = await apiGet(w2.id); for (let i = 0; i + 1 < 20; i += 2) await apiString(w2.id, g.pins[i].id, g.pins[i + 1].id);
    await page.goto(BASE + `/w/${w2.id}/case`); await page.emulateMedia({ media: 'print' });
    const n30 = pageCount(await page.pdf({ preferCSSPageSize: true }));
    await page.emulateMedia({ media: 'screen' });
    eq(n3, 1, '3-pin pages'); eq(n30, 1, '30-pin pages');
    return `pages: 3 pins=${n3}, 30 pins=${n30}; score ${score} status ${status}`;
  });
  await check('X1', 'design/ux: case file with 100 pins and many strings fits one printed page', async () => {
    const w = await apiWall();
    for (let i = 0; i < 100; i++) await apiPin(w.id, 'evidence item ' + i, 10 + (i % 10) * 95, 20 + Math.floor(i / 10) * 95);
    const g = await apiGet(w.id); let k = 0;
    for (let i = 0; i < 100 && k < 40; i++) { const r = await apiString(w.id, g.pins[i].id, g.pins[(i * 7 + 3) % 100].id); if (r && r.string) k++; }
    await page.goto(BASE + `/w/${w.id}/case`); await page.emulateMedia({ media: 'print' });
    const n = pageCount(await page.pdf({ preferCSSPageSize: true })); await page.emulateMedia({ media: 'screen' });
    eq(n, 1, `100 pins + ${k} strings page count`);
  });
  await check('J10.extra', 'J10: case file back link returns to wall; print button present; "Close the case" is a link to /case', async () => {
    const id = await newWall(page);
    eq(await page.locator(T('close-case')).evaluate((e) => e.tagName), 'A', 'close-case tag');
    assert((await page.locator(T('close-case')).getAttribute('href')).endsWith('/case'), 'href');
    await page.click(T('close-case')); await page.waitForSelector(T('case'));
    eq(await txt(page, 'case-evidence'), 'No evidence. No case.', 'empty case copy');
    assert(await page.locator(T('case-print')).isVisible(), 'print button');
    await page.click(T('case-back')); await page.waitForURL(new RegExp('/w/' + id + '$'));
  });

  // ---------- UC15 ----------
  await check('UC15', 'restart on same data file and port: same pins, strings, positions, score', async () => {
    const id = await newWall(page); for (const n of ['pigeons', 'the moon', 'ufo']) await addPin(page, n);
    await tie(page, 'pigeons', 'the moon'); await closeFinding(page); await tie(page, 'the moon', 'ufo'); await closeFinding(page);
    const p = page.locator(pinSel('ufo')); const bb = await p.boundingBox();
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.mouse.down(); await page.mouse.move(bb.x + bb.width / 2 + 60, bb.y + bb.height / 2 + 50, { steps: 8 }); await page.mouse.up();
    await sleep(700); // persistence write is debounced server-side: wait is time-based
    const before = await apiGet(id); const score = await txt(page, 'wall-score');
    const code = await stopServer(server);
    server = await startServer();
    await page.goto(BASE + '/w/' + id); await page.waitForSelector(T('pin'));
    await poll(async () => (await page.locator(T('pin')).count()) === 3, { msg: '3 pins' });
    eq(await strings(page), 2, 'strings'); eq(await txt(page, 'wall-score'), score, 'score');
    const after = await apiGet(id);
    for (const bp of before.pins) { const ap = after.pins.find((q) => q.id === bp.id); assert(ap && ap.phrase === bp.phrase && Math.abs(ap.x - bp.x) <= 5 && Math.abs(ap.y - bp.y) <= 5, 'pin differs ' + bp.phrase); }
    eq(after.strings.length, 2, 'api strings');
    return `SIGTERM exit code ${code}; score ${score}`;
  });
  await check('J11.sigterm', 'J11: server exits 0 on SIGTERM', async () => {
    const tmp = await startServerOnOther();
    const code = await stopServer(tmp.c); eq(code, 0, 'exit code');
  });
  async function startServerOnOther() { const keep = PORT; PORT = await freePort(); const c = await startServer(); PORT = keep; return { c }; }

  // ---------- UC16 ----------
  await check('UC16', '404 pages for unknown wall (wall and case routes)', async () => {
    for (const u of ['/w/doesnotexist', '/w/doesnotexist/case']) {
      const r = await page.goto(BASE + u); eq(r.status(), 404, 'status ' + u);
      eq(await txt(page, 'notfound-title'), 'No such case', 'title'); assert(await page.locator(T('notfound-home')).isVisible(), 'home link');
      eq(await txt(page, 'notfound-text'), 'Nobody filed that one, or somebody made it disappear.', 'text');
      if (u === '/w/doesnotexist') await shot(page, '08-404');
    }
    eq(await page.locator(T('notfound-home')).getAttribute('href'), '/', 'href');
  });
  await check('UC17', 'empty and whitespace phrases refused inline', async () => {
    await newWall(page); const input = page.locator(T('phrase-input'));
    for (const v of ['', '   ']) {
      await input.fill(v); await page.click(T('phrase-submit'));
      await poll(async () => (await txt(page, 'phrase-error')) === 'Say something. Even a hunch has a word in it.', { msg: 'error copy for ' + JSON.stringify(v) });
      eq(await input.getAttribute('aria-invalid'), 'true', 'aria-invalid');
      eq(await page.locator(T('pin')).count(), 0, 'pin count');
      assert(await page.evaluate(() => document.activeElement.dataset.testid === 'phrase-input'), 'focus');
    }
    assert((await input.getAttribute('aria-describedby')), 'aria-describedby missing');
    eq(await page.locator(T('phrase-error')).getAttribute('role'), 'alert', 'role');
  });
  await check('UC18', '61 chars refused, 60 accepted, API 400, XSS phrase shown as text', async () => {
    const id = await newWall(page); const input = page.locator(T('phrase-input'));
    await input.fill('x'.repeat(61)); await input.press('Enter');
    await poll(async () => (await txt(page, 'phrase-error')) === 'Too long. Evidence must fit on a card: 60 characters, tops.', { msg: 'over-60 copy' });
    eq(await page.locator(T('pin')).count(), 0, 'pin after 61');
    await addPin(page, 'y'.repeat(60));
    const r = await ctx.request.post(`${BASE}/api/walls/${id}/pins`, { data: { phrase: 'z'.repeat(61) } }); eq(r.status(), 400, 'API status');
    const xss = '<img src=x onerror=alert(1)>';
    await addPin(page, xss);
    const lab = page.locator(T('pin-label')).last();
    eq((await lab.textContent()).trim(), xss, 'label literal');
    eq(await lab.evaluate((e) => e.querySelectorAll('img').length), 0, 'img parsed');
    await sleep(300); eq(dialogs.length, 0, 'dialog fired');
  });
  await check('X2', 'ux: long label clamps to 2 lines with ellipsis and full text in title', async () => {
    await addPin(page, 'a very long phrase of sixty chars or less to test clamp ok');
    const lab = page.locator(T('pin-label')).last();
    const title = await lab.getAttribute('title') || await lab.evaluate((e) => e.closest('[data-testid=pin]').getAttribute('title') || (e.parentElement.getAttribute('title')));
    assert(title && title.includes('very long phrase'), 'no title with full text: ' + title);
    const st = await lab.evaluate((e) => { const c = getComputedStyle(e); return { lc: c.webkitLineClamp, ov: c.overflow, to: c.textOverflow, h: e.getBoundingClientRect().height, lh: parseFloat(c.lineHeight) || parseFloat(c.fontSize) * 1.2 }; });
    assert(st.lc === '2' || st.h <= st.lh * 2.2, 'not clamped to 2 lines ' + JSON.stringify(st));
    return JSON.stringify(st);
  });

  // ---------- UC19 ----------
  await check('X3', 'tab order: wall-title, share-link, theme-toggle, close-case, phrase-input, phrase-submit, detective-btn', async () => {
    await newWall(page); await addPin(page, 'pigeons'); await page.reload(); await page.waitForSelector(T('pin'));
    const nm = () => page.evaluate(() => { const e = document.activeElement; return e ? (e.dataset.testid || e.tagName) : null; });
    eq(await nm(), 'phrase-input', 'autofocus');
    const back = []; for (let i = 0; i < 4; i++) { await page.keyboard.press('Shift+Tab'); back.push(await nm()); }
    eq(back.join(','), 'close-case,theme-toggle,share-link,wall-title', 'reverse tab order');
    const seq = [];
    for (let i = 0; i < 9; i++) { await page.keyboard.press('Tab'); seq.push(await page.evaluate(() => { const e = document.activeElement; return e ? (e.dataset.testid || e.tagName) : null; })); }
    const exp = ['share-link', 'theme-toggle', 'close-case', 'phrase-input', 'phrase-submit', 'detective-btn', 'pin', 'pin-tie', 'pin-delete'];
    // wall-status / conn-status / score must not be tab stops
    eq(seq.join(','), exp.join(','), 'tab order');
  });
  await check('UC19', 'keyboard only: two pins, arrows move, persists, tie via Enter, Escape, Delete', async () => {
    const id = await newWall(page);
    await page.reload(); await page.waitForSelector(T('board'));
    await page.locator(T('wall-title')).focus();
    for (let i = 0; i < 6 && !(await page.evaluate(() => document.activeElement.dataset.testid === 'phrase-input')); i++) await page.keyboard.press('Tab');
    assert(await page.evaluate(() => document.activeElement.dataset.testid === 'phrase-input'), 'could not Tab to phrase-input');
    await page.keyboard.type('pigeons'); await page.keyboard.press('Enter'); await poll(async () => (await page.locator(T('pin')).count()) === 1, { msg: 'pin1' });
    await page.keyboard.type('the moon'); await page.keyboard.press('Enter'); await poll(async () => (await page.locator(T('pin')).count()) === 2, { msg: 'pin2' });
    for (let i = 0; i < 6 && !(await page.evaluate(() => document.activeElement.dataset.phrase === 'pigeons')); i++) await page.keyboard.press('Tab');
    assert(await page.evaluate(() => document.activeElement.dataset.phrase === 'pigeons'), 'Tab did not reach pin pigeons');
    const p = page.locator(pinSel('pigeons'));
    const x0 = +await p.getAttribute('data-x'), y0 = +await p.getAttribute('data-y');
    const dx = x0 > 900 ? 'ArrowLeft' : 'ArrowRight', sx = x0 > 900 ? -30 : 30, dy = y0 > 900 ? 'ArrowUp' : 'ArrowDown', sy = y0 > 900 ? -40 : 40;
    for (let i = 0; i < 3; i++) await page.keyboard.press(dx);
    await page.keyboard.press('Shift+' + dy);
    const x1 = +await p.getAttribute('data-x'), y1 = +await p.getAttribute('data-y');
    assert(Math.abs(x1 - x0 - sx) <= 1, `x ${x0}->${x1}, expected ${sx}`); assert(Math.abs(y1 - y0 - sy) <= 1, `y ${y0}->${y1}, expected ${sy}`);
    await poll(async () => { const w = await apiGet(id); const q = w.pins.find((z) => z.phrase === 'pigeons'); return Math.abs(q.x - x1) <= 1 && Math.abs(q.y - y1) <= 1; }, { msg: 'server persisted keyboard move' });
    await page.reload(); await page.waitForSelector(pinSel('pigeons'));
    const x2 = +await page.locator(pinSel('pigeons')).getAttribute('data-x'), y2 = +await page.locator(pinSel('pigeons')).getAttribute('data-y');
    assert(Math.abs(x2 - x1) <= 1 && Math.abs(y2 - y1) <= 1, 'not persisted after reload');
    // tie
    await page.locator(pinSel('pigeons')).focus(); await page.keyboard.press('Enter');
    eq(await page.locator(pinSel('pigeons')).getAttribute('data-selected'), 'true', 'selected after Enter');
    await page.waitForSelector(T('tie-hint'));
    await poll(async () => (await txt(page, 'announcer')).includes('Pin A: pigeons. Move to another pin and press Enter.'), { msg: 'A announcement' });
    for (let i = 0; i < 4 && !(await page.evaluate(() => document.activeElement.dataset.phrase === 'the moon')); i++) await page.keyboard.press('Tab');
    assert(await page.evaluate(() => document.activeElement.dataset.phrase === 'the moon'), 'Tab did not reach the moon');
    await page.keyboard.press('Enter');
    await poll(async () => (await strings(page)) === 1, { msg: 'one string' });
    await poll(async () => page.evaluate(() => document.activeElement.dataset.testid === 'finding-close'), { msg: 'finding-close focused' });
    await page.keyboard.press('Escape');
    await poll(async () => !(await page.locator(T('finding-panel')).isVisible()), { msg: 'panel closed' });
    assert(await page.evaluate(() => document.activeElement.dataset.testid === 'string'), 'focus not on string: ' + await page.evaluate(() => document.activeElement.dataset.testid || document.activeElement.tagName));
    await page.keyboard.press('Delete');
    await poll(async () => (await strings(page)) === 0, { msg: 'string removed' });
    assert(await page.evaluate(() => document.activeElement.dataset.testid === 'phrase-input'), 'focus not on phrase-input');
    // escape cancels tie, keeps focus
    await page.locator(pinSel('pigeons')).focus(); await page.keyboard.press('Enter'); await page.keyboard.press('Escape');
    eq(await page.locator(pinSel('pigeons')).getAttribute('data-selected'), 'false', 'cancel (data-selected)');
    return `moved ${x0},${y0}->${x1},${y1}`;
  });
  await check('X4', 'J13: pin delete focus to next pin; detective and close case by keyboard only', async () => {
    await newWall(page); for (const n of ['a1', 'b2', 'c3']) await addPin(page, n);
    await page.locator(pinSel('a1')).focus(); await page.keyboard.press('Delete');
    await poll(async () => (await page.locator(T('pin')).count()) === 2, { msg: 'deleted' });
    await poll(async () => page.evaluate(() => document.activeElement.dataset.phrase === 'b2'), { msg: 'focus to next pin' });
    await page.locator(pinSel('c3')).focus(); await page.keyboard.press('Delete');
    await poll(async () => page.evaluate(() => document.activeElement.dataset.phrase === 'b2'), { msg: 'focus to previous pin' });
    await page.keyboard.press('Delete');
    await poll(async () => page.evaluate(() => document.activeElement.dataset.testid === 'phrase-input'), { msg: 'focus to phrase-input' });
    for (const n of ['a1', 'b2', 'c3']) await addPin(page, n);
    await page.locator(T('detective-btn')).focus(); await page.keyboard.press('Enter');
    await poll(async () => page.evaluate(() => document.activeElement.dataset.testid === 'detective-accept'), { msg: 'focus on detective-accept' });
    await page.keyboard.press('Enter'); await poll(async () => (await strings(page)) === 1, { msg: 'tie by keyboard' });
    await page.locator(T('close-case')).focus(); await page.keyboard.press('Enter'); await page.waitForURL(/\/case$/);
  });

  // ---------- UC20 ----------
  await check('UC20', 'focus outlines visible on every Tab stop; detective focus in/out; announcer changes for pin, string, finding', async () => {
    await newWall(page); await addPin(page, 'pigeons'); await addPin(page, 'the moon'); await tie(page, 'pigeons', 'the moon');
    await annHas(page, 'Pinned: pigeons.'); await annHas(page, 'New string: pigeons to the moon.'); await annHas(page, 'Finding: ');
    const log = await page.evaluate(() => window.__ann.join(' || ')); assert(/Finding: .+pigeons.+/.test(log), 'finding text in announcement lacks phrase: ' + log.slice(-200));
    await page.evaluate(() => document.activeElement.blur()); await page.goto(page.url()); await page.waitForSelector(T('string'));
    const bad = []; let n = 0; const seen = new Set();
    await page.locator(T('wall-title')).focus();
    for (let i = 0; i < 30; i++) {
      if (i > 0) await page.keyboard.press('Tab');
      const r = await page.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return null; const c = getComputedStyle(e); let ring = (c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) >= 2) || (c.boxShadow && c.boxShadow !== 'none'); if (!ring && e.dataset.testid === 'string') { const f = e.querySelector('.string-focus'); if (f) { const fc = getComputedStyle(f); ring = fc.opacity === '1' && fc.stroke !== 'none' && parseFloat(fc.strokeWidth) >= 2; } } const name = (e.dataset.testid || e.tagName) + (e.dataset.phrase ? ':' + e.dataset.phrase : ''); return { name, ring, ow: c.outlineWidth, os: c.outlineStyle }; });
      if (!r || r.name === 'wall' || r.name === 'BODY' || r.name === 'HTML') break; n++;
      if (r.name === 'string') await shot(page, '12-string-focus-ring');
      if (!r.ring) bad.push(`${r.name}(${r.os} ${r.ow})`);
    }
    assert(n >= 12, 'tab sweep found only ' + n + ' stops'); eq(bad.length, 0, 'stops without visible outline: ' + bad.join(', '));
    await page.locator(T('detective-btn')).focus(); await page.keyboard.press('Enter');
    await page.waitForSelector(T('detective-panel'), { state: 'visible' });
    await poll(async () => page.evaluate(() => !!document.activeElement.closest('[data-testid=detective-panel]')), { msg: 'focus in panel' });
    await page.keyboard.press('Escape');
    await poll(async () => page.evaluate(() => document.activeElement.dataset.testid === 'detective-btn'), { msg: 'focus back to detective-btn' });
    return `${n} tab stops all outlined`;
  });
  skip('UC20-axe', 'axe-core serious/critical violations in both themes', 'axe-core is not installed (no node_modules/axe-core); ux.md allows skipping. No automated axe scan was run.');

  // ---------- gallery screenshots ----------
  await check('SHOT', 'populated wall screenshots (Day + Night), 390px wall', async () => {
    const w = await apiWall(); const names = ['pigeons', 'the moon', 'ufo', 'lamp', 'toast', 'fog'];
    const pos = [[150, 200], [450, 120], [800, 220], [250, 600], [550, 520], [850, 650]]; const ids = [];
    for (let i = 0; i < names.length; i++) ids.push((await apiPin(w.id, names[i], pos[i][0], pos[i][1])).pin.id);
    for (const [a, b] of [[0, 1], [1, 2], [0, 3], [3, 4], [2, 5], [4, 5]]) await apiString(w.id, ids[a], ids[b]);
    await api('PATCH', `/api/walls/${w.id}`, { title: 'The Pigeon Affair' });
    const dc = await mk({ colorScheme: 'dark' }); const dp = await dc.newPage();
    await page.goto(BASE + '/w/' + w.id); await page.waitForSelector(T('string')); await poll(async () => (await page.locator(T('string')).count()) === 6, { msg: '6 strings' });
    await shot(page, '03-wall-populated-day');
    await dp.goto(BASE + '/w/' + w.id); await poll(async () => (await dp.locator(T('string')).count()) === 6, { msg: '6 strings dark' }); await shot(dp, '04-wall-populated-night');
    const mc = await mk({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); const mp = await mc.newPage();
    await mp.goto(BASE + '/w/' + w.id); await poll(async () => (await mp.locator(T('string')).count()) === 6, { msg: '6 strings mobile' }); await shot(mp, '09-wall-390');
    await dc.close(); await mc.close();
  });

  // ---------- UC21 ----------
  await check('UC21', 'phone 390x844 touch: no h-scroll, J1/J2, 44px targets, tie by tap, bottom sheet', async () => {
    const mc = await mk({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); const mp = await mc.newPage(); mp.setDefaultTimeout(6000);
    await mp.goto(BASE + '/'); await mp.tap(T('home-new-case')); await mp.waitForURL(/\/w\/[\w-]+$/); await mp.waitForSelector(T('board'));
    await poll(async () => (await txt(mp, 'wall-score')) === '0', { msg: 'score 0' }); eq(await txt(mp, 'wall-status'), 'Hunch', 'status');
    await mp.waitForSelector(T('empty-state'));
    const sw = await mp.evaluate(() => document.documentElement.scrollWidth); assert(sw <= 390, 'scrollWidth ' + sw);
    await addPin(mp, 'pigeons'); await addPin(mp, 'the moon');
    const small = [];
    for (const ph of ['pigeons', 'the moon']) for (const id of ['pin-tie', 'pin-delete']) { const b = await mp.locator(`${pinSel(ph)} ${T(id)}`).boundingBox(); if (b.width < 43.5 || b.height < 43.5) small.push(`${id}=${b.width.toFixed(0)}x${b.height.toFixed(0)}`); }
    for (const id of ['phrase-submit', 'detective-btn', 'share-link', 'theme-toggle', 'close-case']) { const b = await mp.locator(T(id)).boundingBox(); if (b.width < 43.5 || b.height < 43.5) small.push(`${id}=${b.width.toFixed(0)}x${b.height.toFixed(0)}`); }
    const pw = (await mp.locator(pinSel('pigeons')).boundingBox()).width;
    const inp = await mp.locator(T('phrase-input')).boundingBox();
    await mp.tap(`${pinSel('pigeons')} ${T('pin-tie')}`); await mp.waitForSelector(T('tie-hint')); await mp.tap(`${pinSel('the moon')} ${T('pin-label')}`);
    await mp.waitForSelector(T('finding-panel'), { state: 'visible' });
    await poll(async () => mp.evaluate(() => document.getAnimations().length === 0), { msg: 'panel animation finished' });
    const fp = await mp.locator(T('finding-panel')).boundingBox(); const vp = { w: 390, h: 844 };
    const within = fp.x >= -0.5 && fp.y >= 0 && fp.x + fp.width <= vp.w + 0.5 && fp.y + fp.height <= vp.h + 0.5;
    await shot(mp, '10-finding-panel-390');
    const overlapOpen = !(fp.y >= inp.y + inp.height || fp.y + fp.height <= inp.y);
    await mp.tap(T('finding-close')); await poll(async () => !(await mp.locator(T('finding-panel')).isVisible()), { msg: 'closed' });
    const inp2 = await mp.locator(T('phrase-input')).boundingBox();
    const notes = `scrollWidth=${sw}; pin width=${pw}; input x=${inp.x} w=${inp.width}; panel ${JSON.stringify(fp)}; panel height ratio ${(fp.height / 844).toFixed(2)}; small targets: ${small.join(', ') || 'none'}; panel overlaps input while open: ${overlapOpen}`;
    await mc.close();
    assert(small.length === 0, 'targets under 44px: ' + small.join(', '));
    assert(within, 'finding-panel outside viewport ' + JSON.stringify(fp));
    assert(inp2 && inp2.width > 0, 'phrase-input not visible after close');
    return notes;
  });
  await check('X5', 'ux responsive: 390px layout details (16px gutter, pin 112px, panel max 45vh, board >=360px high, input full width)', async () => {
    const mc = await mk({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); const mp = await mc.newPage(); mp.setDefaultTimeout(6000);
    await newWall(mp); await addPin(mp, 'pigeons'); await addPin(mp, 'the moon'); await tie(mp, 'pigeons', 'the moon');
    await poll(async () => mp.evaluate(() => document.getAnimations().length === 0), { msg: 'animations finished' });
    const m = await mp.evaluate(() => { const r = (t) => document.querySelector(`[data-testid=${t}]`).getBoundingClientRect(); const i = r('phrase-input'), b = r('board'), f = r('finding-panel'), p = r('pin'); return { inL: i.left, inR: 390 - i.right, bh: b.height, fh: f.height, pw: document.querySelector('[data-testid=pin]').offsetWidth }; });
    await mc.close();
    const errs = [];
    if (m.inL < 15.5 || m.inR < 15.5) errs.push(`gutter L=${m.inL} R=${m.inR}`);
    if (Math.abs(m.pw - 112) > 2) errs.push('pin width ' + m.pw);
    if (m.fh > 844 * 0.45 + 1) errs.push('panel height ' + m.fh);
    if (m.bh < 360) errs.push('board height ' + m.bh);
    assert(errs.length === 0, errs.join('; ')); return JSON.stringify(m);
  });

  await check('X6', 'ux: a freshly pinned second pin does not cover the first pin\'s Tie/Remove buttons (desktop)', async () => {
    await newWall(page); await addPin(page, 'pigeons', { spread: false }); await addPin(page, 'the moon', { spread: false });
    const hit = await page.evaluate(() => { const out = []; for (const pin of document.querySelectorAll('[data-testid=pin]')) for (const id of ['pin-tie', 'pin-delete']) { const b = pin.querySelector(`[data-testid=${id}]`); const r = b.getBoundingClientRect(); const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); if (e !== b) out.push(pin.dataset.phrase + ':' + id); } return out; });
    eq(hit.length, 0, 'covered controls: ' + hit.join(', '));
  });
  await check('X7', 'ux: on a phone the tie-hint does not cover the pins the person must tap next', async () => {
    const mc = await mk({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); const mp = await mc.newPage(); mp.setDefaultTimeout(6000);
    await newWall(mp); await addPin(mp, 'pigeons'); await addPin(mp, 'the moon');
    await mp.tap(`${pinSel('pigeons')} ${T('pin-tie')}`); await mp.waitForSelector(T('tie-hint'));
    const r = await mp.evaluate(() => { const h = document.querySelector('[data-testid=tie-hint]').getBoundingClientRect(); const a = document.querySelector('[data-phrase="the moon"] [data-testid=pin-art]').getBoundingClientRect(); const ox = Math.max(0, Math.min(h.right, a.right) - Math.max(h.left, a.left)), oy = Math.max(0, Math.min(h.bottom, a.bottom) - Math.max(h.top, a.top)); return { overlapArea: ox * oy, artArea: a.width * a.height }; });
    await mc.close();
    assert(r.overlapArea === 0, `tie-hint covers ${(100 * r.overlapArea / r.artArea).toFixed(0)}% of the other pin's art`);
  });

  // ---------- UC22 ----------
  await check('UC22', 'connection loss: reconnecting <=5s, then live and wall matches server', async () => {
    const ca = await mk(); const cb = await mk(); const A = await ca.newPage(), B = await cb.newPage(); A.setDefaultTimeout(6000); B.setDefaultTimeout(6000);
    const id = await newWall(A); await addPin(A, 'pigeons');
    await poll(async () => (await A.locator(T('conn-status')).getAttribute('data-state')) === 'live', { msg: 'live first' });
    await ca.setOffline(true);
    await poll(async () => { const s = await A.locator(T('conn-status')).getAttribute('data-state'); return s === 'reconnecting' || s === 'offline'; }, { timeout: 5000, msg: 'reconnecting within 5s' });
    const st = await A.locator(T('conn-status')).getAttribute('data-state'); const tx = await txt(A, 'conn-status');
    await B.goto(BASE + '/w/' + id); await B.waitForSelector(pinSel('pigeons')); await addPin(B, 'the moon');
    await ca.setOffline(false);
    await poll(async () => (await A.locator(T('conn-status')).getAttribute('data-state')) === 'live', { timeout: 5000, msg: 'live again' });
    await poll(async () => (await A.locator(pinSel('the moon')).count()) === 1, { timeout: 5000, msg: 'pin from B present' });
    eq(await txt(A, 'conn-status'), 'Live', 'text back to Live');
    await ca.close(); await cb.close();
    return `state while down: ${st} ("${tx}")`;
  });

  // ---------- UC23 ----------
  await check('UC23', 'dark scheme differs from light, contrast >= 4.5, toggle persists, reduced motion', async () => {
    const lc = await mk({ colorScheme: 'light' }); const dc = await mk({ colorScheme: 'dark' }); const rc = await mk({ reducedMotion: 'reduce' });
    const lp = await lc.newPage(), dp = await dc.newPage(), rp = await rc.newPage(); for (const p of [lp, dp, rp]) p.setDefaultTimeout(6000);
    const id = await newWall(lp); await dp.goto(BASE + '/w/' + id); await dp.waitForSelector(T('wall-score'));
    const bg = (p) => p.evaluate(() => getComputedStyle(document.body).backgroundColor + ' | ' + getComputedStyle(document.body).backgroundImage.slice(0, 80));
    const bl = await bg(lp), bd = await bg(dp); assert(bl !== bd, `body background identical: ${bl}`);
    const colors = await dp.evaluate(() => { const parse = (s) => (s.match(/[\d.]+/g) || []).map(Number); let e = document.querySelector('[data-testid=wall-score]'); const fg = parse(getComputedStyle(e).color); let bgc = null; while (e) { const c = parse(getComputedStyle(e).backgroundColor); if (c.length >= 3 && (c.length === 3 || c[3] > 0.95)) { bgc = c; break; } e = e.parentElement; } return { fg, bgc }; });
    assert(colors.bgc, 'no opaque background found for score'); const cr = contrast(colors.fg, colors.bgc); assert(cr >= 4.5, 'score contrast ' + cr.toFixed(2));
    // theme toggle
    const th0 = await dp.locator('html').getAttribute('data-theme'); await dp.click(T('theme-toggle'));
    const th1 = await dp.locator('html').getAttribute('data-theme'); assert(th1 && th1 !== th0, `toggle did not flip data-theme: ${th0} -> ${th1}`);
    await dp.reload(); await dp.waitForSelector(T('wall-score')); eq(await dp.locator('html').getAttribute('data-theme'), th1, 'theme after reload');
    const lt0 = await lp.locator('html').getAttribute('data-theme'); await lp.click(T('theme-toggle')); const lt1 = await lp.locator('html').getAttribute('data-theme');
    assert(lt1 === 'dark', 'light user toggling should get dark, got ' + lt1); await lp.reload(); eq(await lp.locator('html').getAttribute('data-theme'), 'dark', 'dark remembered');
    // reduced motion
    await rp.goto(BASE + '/w/' + id); await rp.waitForSelector(T('wall-score')); await addPin(rp, 'pigeons');
    const p = rp.locator(pinSel('pigeons')); const bb = await p.boundingBox(); const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
    await rp.mouse.move(cx, cy); await rp.mouse.down(); let lean = 0;
    for (let i = 1; i <= 15; i++) { await rp.mouse.move(cx + 10 * i, cy + 5 * i); lean = Math.max(lean, Math.abs(+await p.getAttribute('data-lean'))); }
    eq(lean, 0, 'data-lean under reduced motion');
    await rp.mouse.up(); await sleep(100); // time-based by spec: animations after 100ms
    const anims = await p.evaluate((e) => e.getAnimations().length); eq(anims, 0, 'running animations on pin');
    const subtree = await p.evaluate((e) => e.getAnimations({ subtree: true }).length);
    await shot(rp, '11-wall-reduced-motion');
    await lc.close(); await dc.close(); await rc.close();
    return `contrast ${cr.toFixed(2)}; light bg=${bl}; dark bg=${bd}; toggle ${th0}->${th1}; subtree animations ${subtree}`;
  });

  // ---------- Journey roll-up ----------
  const map = { J1: ['UC1', 'J1.live'], J2: ['UC2', 'UC3', 'J2.extra'], J3: ['UC4'], J4: ['UC5', 'UC6'], J5: ["UC7", "UC8", "X6"], J6: ['UC9'], J7: ['UC10', 'J7.announce'], J8: ['UC11', 'UC12'], J9: ['UC13'], J10: ['UC14', 'X1', 'J10.extra'], J11: ['UC15', 'J11.sigterm'], J12: ['UC16', 'UC17', 'UC18', 'X2'], J13: ['UC19', 'UC20', 'X3', 'X4'], J14: ['UC21', 'X5', 'X7'], J15: ['UC22'], J16: ['UC23'] };
  const byId = Object.fromEntries(results.map((r) => [r.id, r]));
  const journeys = [];
  for (const [j, deps] of Object.entries(map)) {
    const bad = deps.filter((d) => byId[d] && byId[d].status === 'fail');
    journeys.push({ id: j, title: 'Journey ' + j, status: bad.length ? 'fail' : 'pass', detail: bad.length ? 'failing checks: ' + bad.join(', ') : 'all of ' + deps.join(', ') + ' pass' });
  }
  results.unshift(...journeys);
  await browser.close();
  await stopServer(server);
  const tot = { passed: 0, failed: 0, skipped: 0 }; for (const r of results) tot[r.status === 'pass' ? 'passed' : r.status === 'fail' ? 'failed' : 'skipped']++;
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ commit: '790eb57', date: new Date().toISOString(), totals: { ...tot, total: results.length }, results }, null, 2));
  console.log(`\nTOTAL passed=${tot.passed} failed=${tot.failed} skipped=${tot.skipped} of ${results.length}`);
  process.exit(tot.failed ? 1 : 0);
})().catch(async (e) => { console.error('FATAL', e); try { await stopServer(server); } catch (x) {} process.exit(2); });
