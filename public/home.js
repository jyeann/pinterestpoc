'use strict';
// Home page: open a new case. Also applies the remembered theme (shared with the wall).
(function () {
  var root = document.documentElement;
  try {
    var saved = localStorage.getItem('red-string-theme');
    if (saved === 'dark' || saved === 'light') root.setAttribute('data-theme', saved);
  } catch (e) { /* storage blocked: follow the system */ }

  var btn = document.querySelector('[data-testid="home-new-case"]');
  var err = document.querySelector('[data-testid="home-error"]');
  if (!btn || !err) return;
  var label = btn.textContent;

  function fail(msg) {
    err.textContent = msg;
    err.hidden = false;
    btn.disabled = false;
    btn.textContent = label;
  }

  btn.addEventListener('click', function () {
    btn.disabled = true;
    btn.textContent = 'Opening...';
    err.hidden = true;
    err.textContent = '';
    fetch('/api/walls', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    }).then(function (res) {
      return res.json().then(function (body) { return { ok: res.ok, body: body }; });
    }).then(function (r) {
      if (r.ok && r.body && typeof r.body.id === 'string') {
        window.location.assign('/w/' + encodeURIComponent(r.body.id));
        return;
      }
      fail((r.body && r.body.error && r.body.error.message) || 'The wall would not talk. Reload and try again.');
    }).catch(function () {
      fail('Could not reach the wall. Check your connection; nothing was saved.');
    });
  });
}());
