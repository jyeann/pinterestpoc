'use strict';
// RED STRING wall: renders what the server sends (design 4, 4.1). It never computes art, findings,
// score, status or detective picks. User text only goes in through textContent / setAttribute.
(function () {
  var root = document.documentElement;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var COPY = {
    empty: 'Say something. Even a hunch has a word in it.',
    tooLong: 'Too long. Evidence must fit on a card: 60 characters, tops.',
    network: 'Could not reach the wall. Check your connection; nothing was saved.',
    thinking: 'The Detective is thinking...',
    live: 'Live',
    reconnecting: 'Reconnecting...',
    offline: 'Offline. Changes will not be sent.'
  };

  function $(id) { return document.querySelector('[data-testid="' + id + '"]'); }
  var el = {
    title: $('wall-title'), status: $('wall-status'), score: $('wall-score'), conn: $('conn-status'),
    theme: $('theme-toggle'), share: $('share-link'), close: $('close-case'),
    form: $('phrase-form'), input: $('phrase-input'), submit: $('phrase-submit'), phraseError: $('phrase-error'),
    detBtn: $('detective-btn'), board: $('board'), strings: $('string-layer'), pinLayer: document.getElementById('pin-layer'),
    loading: $('wall-loading'), empty: $('empty-state'), wallError: $('wall-error'), retry: $('wall-retry'),
    actionError: $('action-error'), tieHint: $('tie-hint'),
    finding: $('finding-panel'), findingText: $('finding-text'), findingPair: $('finding-pair'),
    findingDelete: $('finding-delete'), findingClose: $('finding-close'),
    det: $('detective-panel'), detMsg: $('detective-message'), detAccept: $('detective-accept'), detDismiss: $('detective-dismiss'),
    announcer: $('announcer')
  };

  var parts = window.location.pathname.split('/');
  var wallId = parts[2] || '';
  el.close.setAttribute('href', '/w/' + encodeURIComponent(wallId) + '/case');

  var clientId = (function () {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
    var bytes = new Uint8Array(12);
    window.crypto.getRandomValues(bytes);
    var out = '';
    for (var i = 0; i < bytes.length; i += 1) out += chars.charAt(bytes[i] % chars.length);
    return out;
  }());

  var state = { version: -1, level: null, title: '', pins: [], strings: [], loaded: false };
  var pinEls = Object.create(null);
  var stringEls = Object.create(null);
  var stubEls = Object.create(null);
  // Strings run behind the cards; this overlay only draws the first stretch at each pushpin so the string
  // visibly hangs from the pin head.
  var front = document.createElementNS(SVG_NS, 'svg');
  front.setAttribute('class', 'string-front');
  front.setAttribute('aria-hidden', 'true');
  front.setAttribute('focusable', 'false');
  $('board').appendChild(front);
  var selectedId = null;
  var openString = null;
  var opener = null;
  var detSuggestion = null;
  var toastTimer = null;

  function pinById(id) { for (var i = 0; i < state.pins.length; i += 1) if (state.pins[i].id === id) return state.pins[i]; return null; }
  function stringById(id) { for (var i = 0; i < state.strings.length; i += 1) if (state.strings[i].id === id) return state.strings[i]; return null; }
  function degree(id) { var n = 0; state.strings.forEach(function (s) { if (s.a === id || s.b === id) n += 1; }); return n; }
  function plural(n, one, many) { return n === 1 ? one : many; }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  /* ---------- announcer: polite, one message per 500ms, remote edits collapsed ---------- */
  var announceQ = [];
  var announceLast = 0;
  var announceTimer = null;
  function flushAnnounce() {
    announceTimer = null;
    if (!announceQ.length) return;
    var local = announceQ.filter(function (m) { return !m.remote; }).map(function (m) { return m.text; });
    var remote = announceQ.filter(function (m) { return m.remote; }).map(function (m) { return m.text; });
    announceQ = [];
    if (remote.length >= 3) remote = [remote.length + ' changes from colleagues.'];
    el.announcer.textContent = local.concat(remote).join(' ');
    announceLast = Date.now();
  }
  function announce(text, remote) {
    announceQ.push({ text: text, remote: !!remote });
    if (announceTimer) return;
    var wait = Math.max(0, 500 - (Date.now() - announceLast));
    if (wait === 0) flushAnnounce();
    else announceTimer = setTimeout(flushAnnounce, wait);
  }

  /* ---------- errors ---------- */
  function showToast(text) {
    el.actionError.textContent = text;
    el.actionError.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.actionError.hidden = true; }, 6000);
  }
  function messageFor(r) {
    if (r.net) return COPY.network;
    if (r.status === 413) return COPY.tooLong;
    return (r.data && r.data.error && r.data.error.message) || 'The wall would not talk. Reload and try again.';
  }
  function errorCode(r) { return r.data && r.data.error && r.data.error.code; }

  /* ---------- API ---------- */
  function api(method, path, body) {
    var opts = { method: method, headers: { 'x-client-id': clientId } };
    if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(path, opts).then(function (res) {
      return res.text().then(function (txt) {
        var data = null;
        try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
        return { ok: res.ok, status: res.status, data: data };
      });
    }, function () { return { ok: false, net: true, status: 0, data: null }; });
  }
  var base = '/api/walls/' + encodeURIComponent(wallId);

  /* ---------- header and meta ---------- */
  function setTitle(t) {
    state.title = t;
    if (document.activeElement !== el.title) el.title.value = t;
    document.title = t + ' - RED STRING';
  }
  function applyMeta(m) {
    if (typeof m.version === 'number') {
      if (m.version < state.version) return;
      state.version = m.version;
    }
    if (typeof m.score === 'number') el.score.textContent = String(m.score);
    if (typeof m.status === 'string') el.status.textContent = m.status;
    if (typeof m.level === 'number') {
      el.status.setAttribute('data-level', String(m.level));
      if (state.level !== null && state.level !== m.level) {
        if (!reduceMotion.matches) {
          el.status.classList.remove('stamping');
          void el.status.offsetWidth;
          el.status.classList.add('stamping');
        }
        announce('Score ' + m.score + '. Status: ' + m.status + '.');
      }
      state.level = m.level;
    }
  }
  el.status.addEventListener('animationend', function () { el.status.classList.remove('stamping'); });

  function setConn(s) {
    el.conn.setAttribute('data-state', s);
    el.conn.textContent = COPY[s];
  }

  /* ---------- art ---------- */
  function artNode(markup) {
    try {
      var doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
      var svg = doc.documentElement;
      if (!svg || svg.nodeName.toLowerCase() !== 'svg') return null;
      return document.importNode(svg, true);
    } catch (e) { return null; }
  }

  /* ---------- pins ---------- */
  function tiltOf(id) {
    var h = 0;
    for (var i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) % 6007;
    return { deg: ((h % 601) / 100) - 3, steel: h % 2 === 1 };
  }
  function button(testid, text) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = testid;
    b.setAttribute('data-testid', testid);
    b.textContent = text;
    return b;
  }
  function describePin(pin) {
    var p = pinEls[pin.id];
    if (!p) return;
    var k = degree(pin.id);
    p.setAttribute('aria-label', 'Pin: ' + pin.phrase + '. Position x ' + pin.x + ', y ' + pin.y + '. ' + k + ' ' + plural(k, 'string', 'strings') + '.');
  }
  function placePin(pin) {
    var p = pinEls[pin.id];
    p.setAttribute('data-x', String(pin.x));
    p.setAttribute('data-y', String(pin.y));
    p.style.setProperty('--px', (pin.x / 10) + '%');
    p.style.setProperty('--py', (pin.y / 10) + '%');
    describePin(pin);
  }
  function buildPin(pin) {
    var p = document.createElement('div');
    p.className = 'pin';
    p.setAttribute('data-testid', 'pin');
    p.setAttribute('role', 'group');
    p.tabIndex = 0;
    p.setAttribute('data-id', pin.id);
    p.setAttribute('data-phrase', pin.phrase);
    p.setAttribute('data-lean', '0');
    var t = tiltOf(pin.id);
    p.style.setProperty('--tilt', t.deg.toFixed(2) + 'deg');
    if (t.steel) p.classList.add('steel');
    var push = document.createElement('span');
    push.className = 'pin-push';
    push.setAttribute('data-testid', 'pin-push');
    push.setAttribute('aria-hidden', 'true');
    var art = document.createElement('div');
    art.className = 'pin-art';
    art.setAttribute('data-testid', 'pin-art');
    art.setAttribute('aria-hidden', 'true');
    var node = artNode(pin.art);
    if (node) art.appendChild(node);
    var label = document.createElement('div');
    label.className = 'pin-label';
    label.setAttribute('data-testid', 'pin-label');
    label.textContent = pin.phrase;
    label.title = pin.phrase;
    var actions = document.createElement('div');
    actions.className = 'pin-actions';
    var tie = button('pin-tie', 'Tie string');
    var del = button('pin-delete', 'Remove pin');
    actions.appendChild(tie);
    actions.appendChild(del);
    p.appendChild(push);
    p.appendChild(art);
    p.appendChild(label);
    p.appendChild(actions);
    p.addEventListener('animationend', function (e) { if (e.target === p) layoutStrings(); });
    p.addEventListener('pointerdown', function (e) { onPointerDown(e, pin.id); });
    p.addEventListener('pointermove', function (e) { onPointerMove(e, pin.id); });
    p.addEventListener('pointerup', function (e) { onPointerUp(e, pin.id, false); });
    p.addEventListener('pointercancel', function (e) { onPointerUp(e, pin.id, true); });
    p.addEventListener('keydown', function (e) { onPinKey(e, pin.id); });
    tie.addEventListener('click', function () { onTieButton(pin.id); });
    del.addEventListener('click', function () { removePin(pin.id); });
    return p;
  }
  function addPin(pin) {
    var existing = pinById(pin.id);
    if (existing) return existing;
    state.pins.push(pin);
    pinEls[pin.id] = buildPin(pin);
    el.pinLayer.appendChild(pinEls[pin.id]);
    placePin(pin);
    renderEmpty();
    layoutStrings();
    return pin;
  }
  function removePinLocal(id, removedStrings) {
    var pin = pinById(id);
    if (!pin) return null;
    (removedStrings || []).forEach(removeStringLocal);
    state.strings.filter(function (s) { return s.a === id || s.b === id; }).forEach(function (s) { removeStringLocal(s.id); });
    state.pins = state.pins.filter(function (x) { return x.id !== id; });
    var p = pinEls[id];
    if (p && p.parentNode) p.parentNode.removeChild(p);
    delete pinEls[id];
    if (selectedId === id) cancelTie();
    renderEmpty();
    return pin;
  }
  function renderEmpty() {
    el.empty.hidden = !state.loaded || state.pins.length > 0;
  }

  /* ---------- strings ---------- */
  function svgEl(name, cls) {
    var n = document.createElementNS(SVG_NS, name);
    if (cls) n.setAttribute('class', cls);
    return n;
  }
  function buildString(s, fresh) {
    var a = pinById(s.a);
    var b = pinById(s.b);
    var g = svgEl('g', 'string');
    g.setAttribute('data-testid', 'string');
    g.setAttribute('role', 'button');
    g.setAttribute('tabindex', '0');
    g.setAttribute('data-id', s.id);
    g.setAttribute('data-a', s.a);
    g.setAttribute('data-b', s.b);
    g.setAttribute('aria-label', 'String between ' + (a ? a.phrase : '') + ' and ' + (b ? b.phrase : '') + '. Show finding.');
    var focusRing = svgEl('path', 'string-focus');
    var under = svgEl('path', 'string-under');
    var line = svgEl('path', 'string-line' + (fresh && !reduceMotion.matches ? ' draw' : ''));
    line.setAttribute('pathLength', '1');
    var hit = svgEl('path', 'string-hit');
    hit.setAttribute('data-testid', 'string-hit');
    g.appendChild(focusRing);
    g.appendChild(under);
    g.appendChild(line);
    g.appendChild(hit);
    line.addEventListener('animationend', function () { line.classList.remove('draw'); });
    g.addEventListener('click', function () { openFinding(s.id, g); });
    g.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFinding(s.id, g); } else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); cutString(s.id); }
    });
    return g;
  }
  function addString(s, fresh) {
    var existing = stringById(s.id);
    if (existing) return existing;
    state.strings.push(s);
    stringEls[s.id] = buildString(s, fresh);
    el.strings.appendChild(stringEls[s.id]);
    var stub = svgEl('g');
    stub.appendChild(svgEl('path', 'string-stub'));
    stub.appendChild(svgEl('path', 'string-stub'));
    front.appendChild(stub);
    stubEls[s.id] = stub;
    layoutStrings();
    var pa = pinById(s.a);
    var pb = pinById(s.b);
    if (pa) describePin(pa);
    if (pb) describePin(pb);
    return s;
  }
  function removeStringLocal(id) {
    var s = stringById(id);
    if (!s) return null;
    state.strings = state.strings.filter(function (x) { return x.id !== id; });
    var g = stringEls[id];
    if (g && g.parentNode) g.parentNode.removeChild(g);
    delete stringEls[id];
    if (stubEls[id] && stubEls[id].parentNode) stubEls[id].parentNode.removeChild(stubEls[id]);
    delete stubEls[id];
    var pa = pinById(s.a);
    var pb = pinById(s.b);
    if (pa) describePin(pa);
    if (pb) describePin(pb);
    if (openString === id) closeFinding(false);
    return s;
  }
  function anchorOf(id, layerRect) {
    var p = pinEls[id];
    if (!p) return null;
    var r = p.querySelector('.pin-push').getBoundingClientRect();
    return { x: r.left + r.width / 2 - layerRect.left, y: r.top + r.height / 2 - layerRect.top };
  }
  function pathFor(a, b) {
    var mx = (a.x + b.x) / 2;
    var my = (a.y + b.y) / 2;
    var len = Math.hypot(b.x - a.x, b.y - a.y);
    var sag = Math.max(24, len * 0.12);
    return 'M' + a.x.toFixed(1) + ' ' + a.y.toFixed(1) + ' Q' + mx.toFixed(1) + ' ' + (my + sag).toFixed(1) + ' ' + b.x.toFixed(1) + ' ' + b.y.toFixed(1);
  }
  // The hit path also carries a dot at the centre of the curve's bounding box, so a click aimed at the
  // middle of the string (pointer tools aim at the box centre) lands on the string even when it sags unevenly.
  function hitPathFor(a, b, d) {
    var my = (a.y + b.y) / 2;
    var cy = my + Math.max(24, Math.hypot(b.x - a.x, b.y - a.y) * 0.12);
    var lo = Math.min(a.y, b.y);
    var hi = Math.max(a.y, b.y);
    var denom = a.y - 2 * cy + b.y;
    var t = denom === 0 ? -1 : (a.y - cy) / denom;
    if (t > 0 && t < 1) {
      var yt = (1 - t) * (1 - t) * a.y + 2 * t * (1 - t) * cy + t * t * b.y;
      lo = Math.min(lo, yt);
      hi = Math.max(hi, yt);
    }
    var bx = (a.x + b.x) / 2;
    var by = (lo + hi) / 2;
    return d + ' M' + bx.toFixed(1) + ' ' + by.toFixed(1) + ' l0.1 0';
  }
  function layoutStrings(onlyPin) {
    var layerRect = el.strings.getBoundingClientRect();
    state.strings.forEach(function (s) {
      if (onlyPin && s.a !== onlyPin && s.b !== onlyPin) return;
      var g = stringEls[s.id];
      var a = anchorOf(s.a, layerRect);
      var b = anchorOf(s.b, layerRect);
      if (!g || !a || !b) return;
      var d = pathFor(a, b);
      var paths = g.querySelectorAll('path');
      for (var i = 0; i < paths.length; i += 1) {
        paths[i].setAttribute('d', paths[i].classList.contains('string-hit') ? hitPathFor(a, b, d) : d);
      }
      var stubs = stubEls[s.id] && stubEls[s.id].querySelectorAll('path');
      if (stubs && stubs.length === 2) {
        stubs[0].setAttribute('d', d);
        stubs[1].setAttribute('d', pathFor(b, a));
      }
    });
  }
  function layoutFor(ms) {
    var end = Date.now() + ms;
    (function tick() {
      layoutStrings();
      if (Date.now() < end) requestAnimationFrame(tick);
    }());
  }
  if (window.ResizeObserver) new ResizeObserver(function () { layoutStrings(); }).observe(el.board);
  window.addEventListener('resize', function () { layoutStrings(); });

  /* ---------- snapshot ---------- */
  function applySnapshot(w) {
    var firstLoad = !state.loaded;
    state.loaded = true;
    el.loading.hidden = true;
    el.wallError.hidden = true;
    var ids = Object.create(null);
    (w.pins || []).forEach(function (p) { ids[p.id] = true; });
    state.pins.slice().forEach(function (p) { if (!ids[p.id]) removePinLocal(p.id); });
    var sids = Object.create(null);
    (w.strings || []).forEach(function (s) { sids[s.id] = true; });
    state.strings.slice().forEach(function (s) { if (!sids[s.id]) removeStringLocal(s.id); });
    (w.pins || []).forEach(function (p) {
      var have = pinById(p.id);
      if (!have) { addPin(p); return; }
      var busy = dragging && dragging.id === p.id;
      if (!busy && !have.timer && (have.x !== p.x || have.y !== p.y)) { have.x = p.x; have.y = p.y; placePin(have); }
    });
    (w.strings || []).forEach(function (s) { addString(s, false); });
    setTitle(w.title);
    state.version = -1;
    applyMeta(w);
    renderEmpty();
    layoutStrings();
    if (firstLoad) layoutFor(400);
  }

  /* ---------- pointer drag ---------- */
  var dragging = null;
  function onPointerDown(e, id) {
    if (e.target.closest && e.target.closest('button')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    var pin = pinById(id);
    if (!pin || dragging) return;
    dragging = { id: id, pointer: e.pointerId, sx: e.clientX, sy: e.clientY, lx: e.clientX, moved: false, lean: 0 };
    try { pinEls[id].setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
  }
  function onPointerMove(e, id) {
    var d = dragging;
    if (!d || d.id !== id || d.pointer !== e.pointerId) return;
    var dx = e.clientX - d.sx;
    var dy = e.clientY - d.sy;
    var p = pinEls[id];
    if (!d.moved) {
      if (Math.hypot(dx, dy) < 4) return;
      d.moved = true;
      p.classList.add('dragging');
      cancelPendingMove(pinById(id));
      // Start from where the card is drawn (CSS keeps it inside the board), not from the stored value.
      var cs = window.getComputedStyle(p);
      d.cx = parseFloat(cs.left);
      d.cy = parseFloat(cs.top);
    }
    var rect = el.pinLayer.getBoundingClientRect();
    var hw = p.offsetWidth / 2;
    var hh = p.offsetHeight / 2;
    var cx = clamp(d.cx + dx, Math.min(hw, rect.width / 2), Math.max(rect.width - hw, rect.width / 2));
    var cy = clamp(d.cy + dy, Math.min(hh, rect.height / 2), Math.max(rect.height - hh, rect.height / 2));
    var pin = pinById(id);
    pin.x = clamp(Math.round((cx / rect.width) * 1000), 0, 1000);
    pin.y = clamp(Math.round((cy / rect.height) * 1000), 0, 1000);
    placePin(pin);
    if (!reduceMotion.matches) {
      var step = e.clientX - d.lx;
      if (step !== 0) {
        var next = clamp(d.lean * 0.5 + step * 0.9, -14, 14);
        if (Math.abs(next) < 1) next = step > 0 ? 1 : -1;
        d.lean = next;
      } else if (d.lean === 0) {
        d.lean = dx >= 0 ? 1 : -1;
      }
      var lean = Math.round(d.lean * 10) / 10;
      p.setAttribute('data-lean', String(lean));
      p.style.setProperty('--lean', lean + 'deg');
    }
    d.lx = e.clientX;
    layoutStrings(id);
  }
  function onPointerUp(e, id, cancelled) {
    var d = dragging;
    if (!d || d.id !== id || d.pointer !== e.pointerId) return;
    dragging = null;
    var p = pinEls[id];
    try { p.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
    p.classList.remove('dragging');
    p.setAttribute('data-lean', '0');
    p.style.setProperty('--lean', '0deg');
    if (d.moved) {
      var pin = pinById(id);
      sendMove(pin);
      layoutFor(700);
    } else if (!cancelled && selectedId) {
      completeTie(id);
    }
  }

  /* ---------- moving: PATCH after drag, debounced after keys ---------- */
  function cancelPendingMove(pin) {
    if (pin && pin.timer) { clearTimeout(pin.timer); pin.timer = null; }
  }
  function sendMove(pin, announceIt) {
    cancelPendingMove(pin);
    api('PATCH', base + '/pins/' + encodeURIComponent(pin.id), { x: pin.x, y: pin.y }).then(function (r) {
      if (!r.ok) { showToast(messageFor(r)); return; }
      applyMeta(r.data);
      if (pinById(pin.id) && announceIt) announce(pin.phrase + ' moved to x ' + pin.x + ', y ' + pin.y + '.');
    });
  }
  function onPinKey(e, id) {
    if (e.target !== pinEls[id]) return;
    var pin = pinById(id);
    if (!pin) return;
    var step = e.shiftKey ? 40 : 10;
    var dx = 0;
    var dy = 0;
    if (e.key === 'ArrowLeft') dx = -step;
    else if (e.key === 'ArrowRight') dx = step;
    else if (e.key === 'ArrowUp') dy = -step;
    else if (e.key === 'ArrowDown') dy = step;
    if (dx || dy) {
      e.preventDefault();
      pin.x = clamp(pin.x + dx, 0, 1000);
      pin.y = clamp(pin.y + dy, 0, 1000);
      placePin(pin);
      layoutStrings(id);
      cancelPendingMove(pin);
      pin.timer = setTimeout(function () { pin.timer = null; sendMove(pin, true); }, 250);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!selectedId) startTie(id);
      else if (selectedId === id) cancelTie();
      else completeTie(id);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      removePin(id);
    }
  }

  /* ---------- tie mode ---------- */
  function startTie(id) {
    var pin = pinById(id);
    if (!pin) return;
    clearSelected();
    selectedId = id;
    pinEls[id].setAttribute('data-selected', 'true');
    el.tieHint.textContent = 'Pin A: ' + pin.phrase + '. Choose the second pin, or press Escape.';
    el.tieHint.hidden = false;
    announce('Pin A: ' + pin.phrase + '. Move to another pin and press Enter.');
  }
  function clearSelected() {
    if (selectedId && pinEls[selectedId]) pinEls[selectedId].setAttribute('data-selected', 'false');
    selectedId = null;
  }
  function cancelTie() {
    clearSelected();
    el.tieHint.hidden = true;
    el.tieHint.textContent = '';
  }
  function onTieButton(id) {
    if (!selectedId) startTie(id);
    else completeTie(id);
  }
  function completeTie(bId) {
    var aId = selectedId;
    if (!aId) return;
    postString(aId, bId).then(function (r) {
      if (r.ok) { cancelTie(); return; }
      if (errorCode(r) !== 'self_link') cancelTie();
    });
  }
  function postString(aId, bId) {
    return api('POST', base + '/strings', { a: aId, b: bId }).then(function (r) {
      if (!r.ok) { showToast(messageFor(r)); return r; }
      var s = r.data.string;
      addString(s, true);
      var pa = pinById(s.a);
      var pb = pinById(s.b);
      var text = 'New string: ' + (pa ? pa.phrase : '') + ' to ' + (pb ? pb.phrase : '') + '. Finding: ' + s.finding + '.';
      announce(text);
      applyMeta(r.data);
      openFinding(s.id, stringEls[s.id]);
      return r;
    });
  }

  /* ---------- finding panel ---------- */
  function openFinding(id, from) {
    var s = stringById(id);
    if (!s) return;
    closeDetective(false);
    var pa = pinById(s.a);
    var pb = pinById(s.b);
    openString = id;
    opener = from || stringEls[id] || null;
    el.findingText.textContent = s.finding;
    el.findingPair.textContent = 'A: ' + (pa ? pa.phrase : '') + ' / B: ' + (pb ? pb.phrase : '');
    el.finding.hidden = false;
    el.findingClose.focus();
  }
  function closeFinding(restoreFocus) {
    var back = opener;
    openString = null;
    opener = null;
    el.finding.hidden = true;
    if (restoreFocus && back && back.isConnected) back.focus();
  }
  function cutString(id) {
    api('DELETE', base + '/strings/' + encodeURIComponent(id)).then(function (r) {
      if (!r.ok) { showToast(messageFor(r)); return; }
      applyMeta(r.data);
      removeStringLocal(id);
      announce('String cut.');
      el.input.focus();
    });
  }
  el.findingClose.addEventListener('click', function () { closeFinding(true); });
  el.findingDelete.addEventListener('click', function () { if (openString) cutString(openString); });

  /* ---------- pin removal ---------- */
  function removePin(id) {
    var pin = pinById(id);
    if (!pin) return;
    var idx = state.pins.indexOf(pin);
    var neighbour = state.pins[idx + 1] || state.pins[idx - 1] || null;
    var neighbourId = neighbour ? neighbour.id : null;
    api('DELETE', base + '/pins/' + encodeURIComponent(id)).then(function (r) {
      if (!r.ok) { showToast(messageFor(r)); return; }
      cancelPendingMove(pin);
      var removed = r.data.removedStrings || [];
      removePinLocal(id, removed);
      announce('Removed ' + pin.phrase + ' and ' + removed.length + ' ' + plural(removed.length, 'string', 'strings') + '.');
      applyMeta(r.data);
      var target = neighbourId && pinEls[neighbourId] ? pinEls[neighbourId] : el.input;
      target.focus();
    });
  }

  /* ---------- phrase form ---------- */
  var sendChain = Promise.resolve();
  function phraseFail(text) {
    el.phraseError.textContent = text;
    el.phraseError.hidden = false;
    el.input.setAttribute('aria-invalid', 'true');
    el.input.focus();
  }
  function phraseOk() {
    el.phraseError.hidden = true;
    el.phraseError.textContent = '';
    el.input.removeAttribute('aria-invalid');
  }
  el.input.addEventListener('input', phraseOk);
  el.form.addEventListener('submit', function (e) {
    e.preventDefault();
    var text = el.input.value;
    if (text.trim() === '') { phraseFail(COPY.empty); return; }
    // Submissions are sent one after another so pins keep the order they were typed in.
    sendChain = sendChain.then(function () {
      return api('POST', base + '/pins', { phrase: text }).then(function (r) {
        if (!r.ok) { phraseFail(messageFor(r)); return; }
        phraseOk();
        if (el.input.value === text) el.input.value = '';
        var pin = addPin(r.data.pin);
        announce('Pinned: ' + pin.phrase + '.');
        applyMeta(r.data);
        el.input.focus();
      });
    });
  });

  /* ---------- title ---------- */
  var titleSent = null;
  function saveTitle() {
    var next = el.title.value;
    if (next === state.title || next === titleSent) return;
    titleSent = next;
    api('PATCH', base, { title: next }).then(function (r) {
      titleSent = null;
      if (!r.ok) { showToast(messageFor(r)); el.title.value = state.title; return; }
      applyMeta(r.data);
      setTitle(r.data.title);
      el.title.value = r.data.title;
    });
  }
  el.title.addEventListener('blur', saveTitle);
  el.title.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); saveTitle(); } });

  /* ---------- detective ---------- */
  // When the Detective declines there is nothing to accept, so the button is taken out of the page.
  var detActions = el.detAccept.parentNode;
  function setAccept(on) {
    if (on && !el.detAccept.parentNode) detActions.insertBefore(el.detAccept, el.detDismiss);
    if (!on && el.detAccept.parentNode) detActions.removeChild(el.detAccept);
  }
  function openDetective() {
    closeFinding(false);
    detSuggestion = null;
    el.detMsg.textContent = COPY.thinking;
    setAccept(false);
    el.det.hidden = false;
    el.det.focus();
    api('GET', base + '/detective').then(function (r) {
      if (el.det.hidden) return;
      if (r.ok && r.data && r.data.suggestion) {
        detSuggestion = r.data.suggestion;
        el.detMsg.textContent = r.data.suggestion.message;
        setAccept(true);
        el.detAccept.focus();
      } else {
        el.detMsg.textContent = r.ok && r.data ? r.data.message : messageFor(r);
        el.det.focus();
      }
    });
  }
  function closeDetective(restoreFocus) {
    var wasOpen = !el.det.hidden;
    detSuggestion = null;
    el.det.hidden = true;
    if (wasOpen && restoreFocus) el.detBtn.focus();
  }
  el.detBtn.addEventListener('click', openDetective);
  el.detDismiss.addEventListener('click', function () { closeDetective(true); });
  el.detAccept.addEventListener('click', function () {
    var sug = detSuggestion;
    if (!sug) return;
    postString(sug.a, sug.b).then(function (r) { if (r.ok) closeDetective(false); });
  });

  /* ---------- Escape ---------- */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (selectedId) { cancelTie(); return; }
    if (!el.finding.hidden) { closeFinding(true); return; }
    if (!el.det.hidden) closeDetective(true);
  });

  /* ---------- theme ---------- */
  function systemDark() { return window.matchMedia('(prefers-color-scheme: dark)').matches; }
  function applyTheme(t) {
    root.setAttribute('data-theme', t);
    el.theme.setAttribute('aria-pressed', t === 'dark' ? 'true' : 'false');
  }
  (function () {
    var saved = null;
    try { saved = localStorage.getItem('red-string-theme'); } catch (e) { saved = null; }
    applyTheme(saved === 'dark' || saved === 'light' ? saved : (systemDark() ? 'dark' : 'light'));
  }());
  el.theme.addEventListener('click', function () {
    var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem('red-string-theme', next); } catch (e) { /* private mode */ }
  });

  /* ---------- share ---------- */
  var shareTimer = null;
  function copied() {
    el.share.textContent = 'Link copied';
    announce('Link copied');
    clearTimeout(shareTimer);
    shareTimer = setTimeout(function () { el.share.textContent = 'Copy link'; }, 2000);
  }
  function fallbackCopy() {
    var ta = document.createElement('textarea');
    ta.value = window.location.href;
    ta.setAttribute('readonly', '');
    ta.className = 'sr-only';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    el.share.focus();
    if (ok) copied();
    else showToast('Could not copy. The link is in the address bar.');
  }
  el.share.addEventListener('click', function () {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(window.location.href).then(copied, fallbackCopy);
    } else fallbackCopy();
  });

  /* ---------- live events ---------- */
  var es = null;
  var retryTimer = null;
  var offlineTimer = null;
  function colleague(by) { return by !== clientId; }
  function onEvent(name, data) {
    var remote = colleague(data.by);
    if (name === 'snapshot') {
      applySnapshot(data);
      return;
    }
    if (name === 'pin-added') {
      var fresh = !pinById(data.pin.id);
      addPin(data.pin);
      if (remote && fresh) announce('A colleague pinned ' + data.pin.phrase + '.', true);
    } else if (name === 'pin-moved') {
      var pin = pinById(data.id);
      if (pin) {
        var busy = (dragging && dragging.id === pin.id) || pin.timer || document.activeElement === pinEls[pin.id];
        if (!busy && (pin.x !== data.x || pin.y !== data.y)) {
          pin.x = data.x; pin.y = data.y;
          var pe = pinEls[pin.id];
          if (!reduceMotion.matches) { pe.classList.add('glide'); setTimeout(function () { pe.classList.remove('glide'); }, 320); }
          placePin(pin);
          layoutFor(360);
        }
        if (remote) announce('A colleague moved ' + pin.phrase + '.', true);
      }
    } else if (name === 'pin-removed') {
      removePinLocal(data.id, data.removedStrings);
      if (remote) announce('A colleague removed ' + data.phrase + '.', true);
    } else if (name === 'string-added') {
      var isNew = !stringById(data.string.id);
      addString(data.string, isNew && remote);
      if (remote && isNew) {
        var a = pinById(data.string.a);
        var b = pinById(data.string.b);
        announce('A colleague tied ' + (a ? a.phrase : '') + ' to ' + (b ? b.phrase : '') + '.', true);
      }
    } else if (name === 'string-removed') {
      removeStringLocal(data.id);
      if (remote) announce('A colleague cut a string.', true);
    } else if (name === 'title') {
      setTitle(data.title);
      if (remote) announce('A colleague renamed the case: ' + data.title + '.', true);
    }
    applyMeta(data);
  }
  function connect() {
    clearTimeout(retryTimer);
    retryTimer = null;
    if (es) { es.onerror = null; es.close(); }
    es = new EventSource(base + '/events');
    ['snapshot', 'pin-added', 'pin-moved', 'pin-removed', 'string-added', 'string-removed', 'title'].forEach(function (name) {
      es.addEventListener(name, function (ev) {
        var data;
        try { data = JSON.parse(ev.data); } catch (e) { return; }
        if (name === 'snapshot') {
          setConn('live');
          clearTimeout(offlineTimer);
          offlineTimer = null;
        }
        onEvent(name, data);
      });
    });
    es.onerror = function () { lostConnection(); };
  }
  function lostConnection() {
    setConn('reconnecting');
    if (!offlineTimer) offlineTimer = setTimeout(function () { offlineTimer = null; if (el.conn.getAttribute('data-state') !== 'live') setConn('offline'); }, 10000);
    if (es && es.readyState === 2 && !retryTimer) retryTimer = setTimeout(connect, 1000);
  }
  window.addEventListener('offline', function () {
    setConn('reconnecting');
    if (es) { es.onerror = null; es.close(); }
    if (!retryTimer) retryTimer = setTimeout(connect, 1000);
    lostConnection();
  });
  window.addEventListener('online', connect);

  /* ---------- start ---------- */
  el.retry.addEventListener('click', function () { window.location.reload(); });
  el.input.focus();
  api('GET', base).then(function (r) {
    if (r.ok && r.data) { applySnapshot(r.data); return; }
    if (!state.loaded) { el.loading.hidden = true; el.wallError.hidden = false; }
  });
  connect();
}());
