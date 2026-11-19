#!/usr/bin/env node
'use strict';
const path = require('node:path');
const { strongVerify, loadConfig, cleanupTempDirs } = require('../lib/strong-verify');

const USAGE = 'verify [--config verify.config.json] [--fast]   (--fast skips mutation; for quick iteration only)';

async function main(argv) {
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  let configPath = 'verify.config.json';
  let fast = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--fast') fast = true;
    else if (argv[i] === '--config' && argv[i + 1]) { configPath = argv[i + 1]; i += 1; }
    else throw new Error(`Unknown argument: ${argv[i]}\n${USAGE}`);
  }
  const config = loadConfig(path.resolve(root, configPath));
  const { pass } = await strongVerify(root, config, { fast });
  return pass ? 0 : 1;
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { cleanupTempDirs(); process.exit(130); });
}

main(process.argv.slice(2))
  .then((code) => { process.exitCode = code; })
  .catch((err) => { console.error(`verify: ${err.message}`); process.exitCode = 2; });
