'use strict';
// Safe static file serving from publicDir (design 5).
const fs = require('node:fs');
const path = require('node:path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};
const NAME_RE = /^[A-Za-z0-9._-]+$/;

// rawName is the (possibly percent-encoded) part after /static/. Returns {file, type} or null.
function resolveStatic(publicDir, rawName) {
  let name;
  try {
    name = decodeURIComponent(String(rawName));
  } catch {
    return null;
  }
  if (!NAME_RE.test(name) || name === '.' || name === '..') return null;
  const type = MIME[path.extname(name).toLowerCase()];
  if (!type) return null;
  const root = path.resolve(publicDir);
  const file = path.resolve(root, name);
  if (!file.startsWith(root + path.sep)) return null;
  return { file, type };
}

// Resolves true when a file was sent, false when the caller should answer 404.
function serveStatic(res, publicDir, rawName, headers) {
  const target = resolveStatic(publicDir, rawName);
  if (!target) return Promise.resolve(false);
  return new Promise((resolve) => {
    fs.readFile(target.file, (err, buf) => {
      if (err) { resolve(false); return; }
      res.writeHead(200, {
        'Content-Type': target.type,
        'Content-Length': buf.length,
        'Cache-Control': 'no-cache',
        ...(headers || {}),
      });
      res.end(buf);
      resolve(true);
    });
  });
}

module.exports = { resolveStatic, serveStatic, MIME };
