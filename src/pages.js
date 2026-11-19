'use strict';
// Server-rendered HTML: case file, not-found page, wall shell and home page.
// All user text goes through escapeHtml. Art SVG (no user text) is embedded raw.
// No inline script or style anywhere (CSP): scripts and styles live in /static/.

const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const MANY_PINS = 24;
const DENSE_PINS = 60;

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1">';

function head(title, css, scheme) {
  return '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
    + `${VIEWPORT}\n<meta name="color-scheme" content="${scheme}">\n`
    + `<title>${escapeHtml(title)}</title>\n<link rel="stylesheet" href="/static/${css}">\n</head>\n`;
}

function caseFileHtml(wallJson) {
  const wall = wallJson || {};
  const pins = wall.pins || [];
  const strings = wall.strings || [];
  const title = wall.title || 'Untitled case';
  const status = wall.status || 'Hunch';
  const level = wall.level || 0;
  const score = wall.score || 0;
  let folder = 'folder';
  if (pins.length > MANY_PINS) folder += ' many';
  if (pins.length > DENSE_PINS) folder += ' dense';

  const evidence = pins.length === 0
    ? '<li class="empty">No evidence. No case.</li>'
    : pins.map((p) => `<li data-testid="case-evidence-item" data-phrase="${escapeHtml(p.phrase)}">`
      + `<span class="art" aria-hidden="true">${p.art || ''}</span>`
      + `<span class="phrase">${escapeHtml(p.phrase)}</span></li>`).join('\n');
  const findings = strings.map((s) => `<li data-testid="case-finding">${escapeHtml(s.finding)}</li>`).join('\n');
  const noStrings = strings.length === 0 ? '<p class="none">No strings. No theory.</p>' : '';
  const backHref = typeof wall.id === 'string' && ID_RE.test(wall.id) ? `/w/${escapeHtml(wall.id)}` : '/';

  return `${head(`Case file: ${title} - RED STRING`, 'case.css', 'light')}`
    + '<body class="case-page" data-testid="case">\n'
    + `<main class="${folder}">\n`
    + '<header class="case-head">\n'
    + '<p class="kicker">Red String Bureau &middot; Case file</p>\n'
    + `<h1 data-testid="case-title">${escapeHtml(title)}</h1>\n`
    + '<div class="case-meta">\n'
    + '<p class="meta-item"><span class="label">Status</span> '
    + `<span class="stamp" data-testid="case-status" data-level="${escapeHtml(level)}">${escapeHtml(status)}</span></p>\n`
    + `<p class="meta-item"><span class="label">Score</span> <span class="score" data-testid="case-score">${escapeHtml(score)}</span></p>\n`
    + '</div>\n</header>\n'
    + '<section class="evidence-block">\n<h2>Evidence</h2>\n'
    + `<ul class="evidence" data-testid="case-evidence">\n${evidence}\n</ul>\n</section>\n`
    + '<section class="findings-block">\n<h2>Findings</h2>\n'
    + `<ol class="findings" data-testid="case-findings">\n${findings}\n</ol>\n${noStrings}\n</section>\n`
    + '<nav class="actions">\n'
    + '<button type="button" data-testid="case-print">Print the file</button>\n'
    + `<a href="${backHref}" data-testid="case-back">Back to the wall</a>\n`
    + '</nav>\n</main>\n'
    + '<script src="/static/case.js" defer></script>\n</body>\n</html>\n';
}

function notFoundHtml() {
  return `${head('No such case - RED STRING', 'wall.css', 'light dark')}`
    + '<body class="notfound-page" data-testid="notfound">\n<main class="notfound">\n'
    + '<p class="kicker">File not found</p>\n'
    + '<h1 data-testid="notfound-title">No such case</h1>\n'
    + '<p data-testid="notfound-text">Nobody filed that one, or somebody made it disappear.</p>\n'
    + '<a class="primary" href="/" data-testid="notfound-home">Open a new case</a>\n'
    + '</main>\n<script src="/static/home.js" defer></script>\n</body>\n</html>\n';
}

function wallShellHtml(id) {
  const closeHref = typeof id === 'string' && ID_RE.test(id) ? `/w/${id}/case` : '/';
  return `${head('RED STRING', 'wall.css', 'light dark')}`
    + '<body class="wall-page" data-testid="wall">\n'
    + '<header class="topbar">\n'
    + '<div class="row row-main">\n'
    + '<input class="wall-title" data-testid="wall-title" type="text" maxlength="60" autocomplete="off" aria-label="Case name" spellcheck="false">\n'
    + '<div class="stamp-slot"><span class="stamp" data-testid="wall-status" data-level="0">-</span></div>\n'
    + '<p class="score-box"><span class="label">Score</span> <span class="score" data-testid="wall-score">-</span></p>\n'
    + '</div>\n'
    + '<div class="row row-controls">\n'
    + '<span class="conn" data-testid="conn-status" data-state="reconnecting">Connecting...</span>\n'
    + '<button type="button" class="btn" data-testid="share-link">Copy link</button>\n'
    + '<button type="button" class="btn" data-testid="theme-toggle" aria-pressed="false">Night shift</button>\n'
    + `<a class="btn" data-testid="close-case" href="${closeHref}">Close the case</a>\n`
    + '</div>\n</header>\n'
    + '<section class="toolbar">\n'
    + '<form class="phrase-form" data-testid="phrase-form" novalidate autocomplete="off">\n'
    + '<label for="phrase-input">What did you see?</label>\n'
    + '<div class="phrase-row">\n'
    + '<input id="phrase-input" data-testid="phrase-input" type="text" placeholder="pigeons" aria-describedby="phrase-error" autocomplete="off" spellcheck="false">\n'
    + '<button type="submit" class="btn primary" data-testid="phrase-submit">Pin it</button>\n'
    + '</div>\n'
    + '<p class="field-error" id="phrase-error" data-testid="phrase-error" role="alert" hidden></p>\n'
    + '</form>\n'
    + '<button type="button" class="btn" data-testid="detective-btn">Ask the Detective</button>\n'
    + '</section>\n'
    + '<div class="stage">\n'
    + '<div class="board" id="board" data-testid="board" role="group" aria-label="Evidence wall">\n'
    + '<div class="pin-layer" id="pin-layer"></div>\n'
    + '<svg class="string-layer" data-testid="string-layer" xmlns="http://www.w3.org/2000/svg" aria-hidden="false"></svg>\n'
    + '<p class="board-note loading" data-testid="wall-loading">Dusting for prints...</p>\n'
    + '<p class="board-note empty" data-testid="empty-state" hidden>Nothing on the wall. Type something you saw.</p>\n'
    + '<div class="wall-error" data-testid="wall-error" role="alert" hidden>The wall would not talk. Reload and try again. '
    + '<button type="button" class="btn" data-testid="wall-retry">Reload</button></div>\n'
    + '<p class="action-error" data-testid="action-error" role="alert" hidden></p>\n'
    + '</div>\n'
    + '<p class="tie-hint" data-testid="tie-hint" hidden></p>\n'
    + '<section class="panel finding-panel" data-testid="finding-panel" role="dialog" aria-labelledby="finding-heading" hidden>\n'
    + '<h2 id="finding-heading" data-testid="finding-heading">Finding</h2>\n'
    + '<p class="finding-pair" data-testid="finding-pair"></p>\n'
    + '<p class="finding-text" data-testid="finding-text"></p>\n'
    + '<div class="panel-actions">\n'
    + '<button type="button" class="btn danger" data-testid="finding-delete">Cut the string</button>\n'
    + '<button type="button" class="btn" data-testid="finding-close">Close</button>\n'
    + '</div>\n</section>\n'
    + '<section class="panel detective-panel" data-testid="detective-panel" tabindex="-1" aria-label="The Detective" hidden>\n'
    + '<p class="detective-message" data-testid="detective-message"></p>\n'
    + '<div class="panel-actions">\n'
    + '<button type="button" class="btn primary" data-testid="detective-accept">Tie it</button>\n'
    + '<button type="button" class="btn" data-testid="detective-dismiss">Not now</button>\n'
    + '</div>\n</section>\n'
    + '</div>\n'
    + '<div class="sr-only" data-testid="announcer" role="status" aria-live="polite" aria-atomic="true"></div>\n'
    + '<script src="/static/wall.js" defer></script>\n</body>\n</html>\n';
}

function homeHtml() {
  return `${head('RED STRING', 'wall.css', 'light dark')}`
    + '<body class="home-page" data-testid="home">\n<main class="home">\n'
    + '<div class="home-deco" aria-hidden="true">\n'
    + '<span class="deco-card deco-a"><span class="deco-pin"></span><span class="deco-art"></span><span class="deco-line">pigeons</span></span>\n'
    + '<span class="deco-card deco-b"><span class="deco-pin"></span><span class="deco-art"></span><span class="deco-line">the moon</span></span>\n'
    + '<svg class="deco-string" viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false"><path d="M0 0 Q45 130 100 100" fill="none" stroke="#b3201b" stroke-width="2.4" vector-effect="non-scaling-stroke"/></svg>\n'
    + '</div>\n'
    + '<section class="home-card">\n'
    + '<p class="kicker">Case file no. 0001</p>\n'
    + '<h1 data-testid="home-title">RED STRING</h1>\n'
    + '<p class="tagline" data-testid="home-tagline">Everything is connected. You just have not proved it yet.</p>\n'
    + '<button type="button" class="btn primary big" data-testid="home-new-case">Open a new case</button>\n'
    + '<p class="field-error" data-testid="home-error" role="alert" hidden></p>\n'
    + '</section>\n</main>\n'
    + '<script src="/static/home.js" defer></script>\n</body>\n</html>\n';
}

module.exports = { escapeHtml, caseFileHtml, notFoundHtml, wallShellHtml, homeHtml };
