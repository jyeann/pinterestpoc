'use strict';
// HTTP helpers: security headers, JSON responses, error table, bounded JSON body reading (design 4, 5).

const BODY_LIMIT = 4096;
const DRAIN_CAP = 1024 * 1024; // after a 413 we discard (not buffer) at most this much, then drop the socket

const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

const SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

const EMPTY_MSG = 'Say something. Even a hunch has a word in it.';
const LONG_MSG = 'Too long. Evidence must fit on a card: 60 characters, tops.';

// code -> [status, message]
const ERRORS = {
  bad_json: [400, 'Request body must be a JSON object.'],
  too_large: [413, 'Request body too large.'],
  phrase_empty: [400, EMPTY_MSG],
  title_empty: [400, EMPTY_MSG],
  phrase_too_long: [400, LONG_MSG],
  title_too_long: [400, LONG_MSG],
  phrase_invalid: [400, EMPTY_MSG],
  wall_full: [400, 'The wall is full. 100 pins is where the trail goes cold.'],
  strings_full: [400, 'No more string. 500 is where the trail goes cold.'],
  bad_coords: [400, 'Position must be numbers.'],
  bad_pin: [400, 'Both pins must be on this wall.'],
  self_link: [400, 'A pin cannot be linked to itself.'],
  duplicate_string: [409, 'Those two are already connected. I checked.'],
  not_found: [404, 'No such case'],
  method_not_allowed: [405, 'Method not allowed.'],
  rate_limited: [429, 'Slow down, detective.'],
  capacity: [503, 'The archive is full.'],
  internal: [500, 'The wall would not talk.'],
};

function applySecurityHeaders(res) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
}

function send(res, status, contentType, text, headers) {
  const buf = Buffer.from(text, 'utf8');
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
    ...(headers || {}),
  });
  res.end(buf);
}

function sendJson(res, status, obj, headers) {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(obj), headers);
}

function sendHtml(res, status, html, headers) {
  send(res, status, 'text/html; charset=utf-8', html, headers);
}

// sendError(res, code, headers) -> status and message come from the ERRORS table
function sendError(res, code, headers) {
  const entry = ERRORS[code] || ERRORS.internal;
  const key = ERRORS[code] ? code : 'internal';
  const extra = { ...(headers || {}) };
  if (entry[0] === 413) extra.Connection = 'close';
  sendJson(res, entry[0], { error: { code: key, message: entry[1] } }, extra);
}

// Resolves {ok:true, buffer} or {ok:false, code:'too_large'|'bad_json'}. Never buffers more than `limit` bytes.
function readBody(req, limit = BODY_LIMIT) {
  return new Promise((resolve) => {
    let size = 0;
    let done = false;
    const chunks = [];
    const finish = (result) => {
      if (done) return;
      done = true;
      resolve(result);
    };
    const declared = Number(req.headers && req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) finish({ ok: false, code: 'too_large' });
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > DRAIN_CAP) { finish({ ok: false, code: 'too_large' }); req.destroy(); return; }
      if (done) return; // already answered: discard
      if (size > limit) { finish({ ok: false, code: 'too_large' }); return; }
      chunks.push(chunk);
    });
    req.on('end', () => finish({ ok: true, buffer: Buffer.concat(chunks) }));
    req.on('error', () => finish({ ok: false, code: 'bad_json' }));
    req.on('close', () => finish({ ok: false, code: 'bad_json' }));
  });
}

// Strict UTF-8 + JSON.parse; the value must be a plain object (not array, not null).
function parseJsonObject(buffer, opts = {}) {
  if (buffer.length === 0) return opts.allowEmpty ? { ok: true, value: {} } : { ok: false, code: 'bad_json' };
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer);
  } catch {
    return { ok: false, code: 'bad_json' };
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, code: 'bad_json' };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { ok: false, code: 'bad_json' };
  return { ok: true, value };
}

async function readJsonBody(req, limit = BODY_LIMIT, opts = {}) {
  const got = await readBody(req, limit);
  if (!got.ok) return got;
  return parseJsonObject(got.buffer, opts);
}

module.exports = {
  BODY_LIMIT, CSP, SECURITY_HEADERS, ERRORS,
  applySecurityHeaders, sendJson, sendHtml, sendError, readBody, parseJsonObject, readJsonBody,
};
