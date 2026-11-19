'use strict';
// Entry point (design 6): env -> store -> persistence -> server, plus graceful shutdown.
const path = require('node:path');
const { createStore } = require('./store');
const { createPersist } = require('./persist');
const { createRateLimiter } = require('./ratelimit');
const { createServer } = require('./server');

function parsePort(raw) {
  if (raw === undefined || raw === '') return 3000;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 65535) throw new Error('PORT must be an integer from 0 to 65535');
  return n;
}

// start({env, out, log, signals}) -> Promise<{server, port, stop()}>
async function start(opts = {}) {
  const env = opts.env || process.env;
  const out = opts.out || process.stdout;
  const log = opts.log || ((line) => process.stderr.write(`${line}\n`));
  const port = parsePort(env.PORT);
  const host = env.HOST || '127.0.0.1';

  const store = createStore();
  const file = env.RED_STRING_DATA;
  const persist = file ? createPersist({ file, getData: () => store.toJSON(), log }) : null;
  if (persist) {
    const data = persist.load();
    if (data) store.load(data);
  }
  const rateLimit = env.RATE_LIMIT === '0' ? null : createRateLimiter();
  const server = createServer({ store, persist, rateLimit, publicDir: path.join(__dirname, '..', 'public') });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const actual = server.address().port;
  out.write(`listening on http://${host}:${actual}\n`);

  let stopping = null;
  function stop() {
    if (stopping) return stopping;
    if (persist) persist.flush();
    server.hub.closeAll();
    stopping = new Promise((resolve) => {
      server.close(() => {
        if (persist) persist.flush(); // a change accepted while closing
        resolve();
      });
      server.closeIdleConnections();
      const t = setTimeout(() => server.closeAllConnections(), 200);
      if (t.unref) t.unref();
    });
    return stopping;
  }

  if (opts.signals) {
    const onSignal = () => {
      const force = setTimeout(() => process.exit(0), 2000);
      if (force.unref) force.unref();
      stop().then(() => process.exit(0), () => process.exit(0));
    };
    process.once('SIGTERM', onSignal);
    process.once('SIGINT', onSignal);
  }

  return { server, port: actual, stop };
}

module.exports = { start, parsePort };

if (require.main === module) {
  start({ signals: true }).catch((err) => {
    process.stderr.write(`failed to start: ${err && err.message}\n`);
    process.exit(1);
  });
}
