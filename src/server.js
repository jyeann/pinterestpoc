'use strict';
// HTTP server wiring (design 4, 5). createServer builds an http.Server without listening.
const http = require('node:http');
const path = require('node:path');
const { createRouter, pathnameOf, ID_RE } = require('./router');
const H = require('./http');
const { createHub } = require('./sse');
const { serveStatic } = require('./static');

const REQUEST_TIMEOUT_MS = 10000;
const HEADERS_TIMEOUT_MS = 5000;
const MUTATING = new Set(['POST', 'PATCH', 'DELETE']);

function createServer(opts = {}) {
  const { store, persist, rateLimit } = opts;
  const publicDir = opts.publicDir || path.join(__dirname, '..', 'public');
  const hub = opts.hub || createHub();
  const pages = opts.pages || require('./pages');

  // `by` of the request currently mutating the store. Store calls are synchronous, so this is race free.
  let currentBy = null;
  store.subscribe((wallId, event, data) => {
    hub.publish(wallId, event, { ...data, by: currentBy });
    if (persist) persist.scheduleSave();
  });

  const mutate = (by, fn) => {
    currentBy = by;
    try { return fn(); } finally { currentBy = null; }
  };

  const json = (res, status, obj) => H.sendJson(res, status, obj);
  const sendResult = (res, status, r, build) => {
    if (!r.ok) return H.sendError(res, r.code);
    return json(res, status, build(r));
  };
  const notFoundPage = (res) => H.sendHtml(res, 404, pages.notFoundHtml());

  const routes = [
    { method: 'GET', path: '/', handler: (c) => serveIndex(c.res) },
    { method: 'GET', path: '/healthz', handler: (c) => json(c.res, 200, { ok: true }) },
    { method: 'GET', path: '/static/*', handler: async (c) => {
      if (!(await serveStatic(c.res, publicDir, c.params.rest))) H.sendError(c.res, 'not_found');
    } },
    { method: 'GET', path: '/w/:id', handler: (c) => shell(c) },
    { method: 'GET', path: '/w/:id/', handler: (c) => shell(c) },
    { method: 'GET', path: '/w/:id/case', handler: (c) => {
      const wall = store.getWall(c.params.id);
      if (!wall) return notFoundPage(c.res);
      return H.sendHtml(c.res, 200, pages.caseFileHtml(wall));
    } },

    { method: 'POST', path: '/api/walls', body: 'optional', handler: (c) => {
      const r = mutate(c.by, () => store.createWall(c.body));
      sendResult(c.res, 201, r, (x) => x.wall);
    } },
    { method: 'GET', path: '/api/walls/:id', handler: (c) => {
      const wall = store.getWall(c.params.id);
      if (!wall) return H.sendError(c.res, 'not_found');
      return json(c.res, 200, wall);
    } },
    { method: 'PATCH', path: '/api/walls/:id', body: 'required', handler: (c) => {
      const r = mutate(c.by, () => store.setTitle(c.params.id, c.body.title));
      sendResult(c.res, 200, r, (x) => ({ title: x.title, ...x.meta }));
    } },
    { method: 'POST', path: '/api/walls/:id/pins', body: 'required', handler: (c) => {
      const r = mutate(c.by, () => store.addPin(c.params.id, c.body));
      sendResult(c.res, 201, r, (x) => ({ pin: x.pin, ...x.meta }));
    } },
    { method: 'PATCH', path: '/api/walls/:id/pins/:pid', body: 'required', handler: (c) => {
      const r = mutate(c.by, () => store.movePin(c.params.id, c.params.pid, c.body));
      sendResult(c.res, 200, r, (x) => ({ pin: x.pin, ...x.meta }));
    } },
    { method: 'DELETE', path: '/api/walls/:id/pins/:pid', handler: (c) => {
      const r = mutate(c.by, () => store.removePin(c.params.id, c.params.pid));
      sendResult(c.res, 200, r, (x) => ({ id: x.id, removedStrings: x.removedStrings, ...x.meta }));
    } },
    { method: 'POST', path: '/api/walls/:id/strings', body: 'required', handler: (c) => {
      const r = mutate(c.by, () => store.addString(c.params.id, c.body.a, c.body.b));
      sendResult(c.res, 201, r, (x) => ({ string: x.string, ...x.meta }));
    } },
    { method: 'DELETE', path: '/api/walls/:id/strings/:sid', handler: (c) => {
      const r = mutate(c.by, () => store.removeString(c.params.id, c.params.sid));
      sendResult(c.res, 200, r, (x) => ({ id: x.id, ...x.meta }));
    } },
    { method: 'GET', path: '/api/walls/:id/detective', handler: (c) => {
      const r = store.detective(c.params.id);
      sendResult(c.res, 200, r, (x) => (x.suggestion
        ? { suggestion: x.suggestion }
        : { suggestion: null, reason: x.reason, message: x.message }));
    } },
    { method: 'GET', path: '/api/walls/:id/events', handler: (c) => {
      const wall = store.getWall(c.params.id);
      if (!wall) return H.sendError(c.res, 'not_found');
      if (!hub.subscribe(c.params.id, c.res, wall, c.req.socket.remoteAddress)) return H.sendError(c.res, 'capacity');
      return undefined;
    } },
  ];
  const router = createRouter(routes);

  async function serveIndex(res) {
    if (!(await serveStatic(res, publicDir, 'index.html'))) H.sendError(res, 'not_found');
  }

  function shell(c) {
    if (!store.getWall(c.params.id)) return notFoundPage(c.res);
    return H.sendHtml(c.res, 200, pages.wallShellHtml(c.params.id));
  }

  async function handle(req, res) {
    H.applySecurityHeaders(res);
    const pathname = pathnameOf(req.url);
    const isApi = pathname === '/api' || pathname.startsWith('/api/');

    if (MUTATING.has(req.method) && rateLimit && !rateLimit.take(req.socket.remoteAddress)) {
      return H.sendError(res, 'rate_limited', { 'Retry-After': '1' });
    }

    const found = router.resolve(req.method, pathname);
    if (found.type === 'not_found') {
      return isApi ? H.sendError(res, 'not_found') : notFoundPage(res);
    }
    if (found.type === 'method_not_allowed') {
      return H.sendError(res, 'method_not_allowed', { Allow: found.allow.join(', ') });
    }

    const { route, params } = found;
    const clientId = req.headers['x-client-id'];
    const ctx = { req, res, params, body: undefined, by: typeof clientId === 'string' && ID_RE.test(clientId) ? clientId : null };
    if (route.body) {
      const got = await H.readJsonBody(req, H.BODY_LIMIT, { allowEmpty: route.body === 'optional' });
      if (!got.ok) return H.sendError(res, got.code);
      ctx.body = got.value;
    }
    return route.handler(ctx);
  }

  const server = http.createServer((req, res) => {
    Promise.resolve()
      .then(() => handle(req, res))
      .catch(() => {
        if (res.headersSent) { res.destroy(); return; }
        H.sendError(res, 'internal');
      });
  });
  server.requestTimeout = opts.requestTimeoutMs === undefined ? REQUEST_TIMEOUT_MS : opts.requestTimeoutMs;
  server.headersTimeout = opts.headersTimeoutMs === undefined ? HEADERS_TIMEOUT_MS : opts.headersTimeoutMs;
  server.hub = hub;
  return server;
}

module.exports = { createServer };

if (require.main === module) {
  require('./main').start({ signals: true }).catch((err) => {
    process.stderr.write(`failed to start: ${err && err.message}\n`);
    process.exit(1);
  });
}
