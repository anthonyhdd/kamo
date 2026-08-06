#!/usr/bin/env node
/**
 * Tests for watchdog.mjs against a local server that can be told to misbehave.
 *
 * The watchdog only earns its place if it FAILS on the things it claims to catch. It cannot
 * be rehearsed against production — production is supposed to be healthy, and the one time it
 * was not, nothing was watching. So each failure mode is reproduced here deliberately,
 * including the one that actually happened: a redirect to a cleartext host.
 *
 *   node scripts/test-watchdog.mjs
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REAL = readFileSync(join(ROOT, 'index.html'), 'utf8');

let mode = 'healthy';
const server = createServer((req, res) => {
  if (mode === 'redirect') {
    res.writeHead(301, { Location: 'http://kamo.bliss-coach.com/' });
    return res.end();
  }
  if (mode === 'down') { res.writeHead(503); return res.end('service unavailable'); }
  if (mode === 'errorpage') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<h1>404</h1>'); }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  if (mode === 'stale-title') return res.end(REAL.replace('<title>KAMO — Meccha IRL</title>', '<title>KAMO</title>'));
  if (mode === 'ch-off') return res.end(REAL.replace('const CH_MAKE=true', 'const CH_MAKE=false'));
  if (mode === 'broken-js') return res.end(REAL.replace('function chLink(){', 'function chLink({'));
  res.end(REAL);
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

let failed = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { failed++; console.error('  ✗ ' + m); };

/* spawn, NOT spawnSync. The server answering the watchdog's request lives in THIS process, and
   spawnSync blocks this event loop — so the child waits for a response that cannot be sent
   until the child exits. The first version of this test deadlocked on its own healthy case. */
function run(m) {
  mode = m;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(ROOT, 'scripts', 'watchdog.mjs')], {
      env: { ...process.env, KAMO_WATCH_ORIGINS: JSON.stringify([{ name: 'test origin', url }]) },
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ code, out }));
  });
}

console.log('\nA HEALTHY ORIGIN PASSES');
{
  const r = await run('healthy');
  r.code === 0 ? ok('the real index.html, served intact → exit 0')
    : bad(`healthy page failed, so every run would cry wolf:\n${r.out}`);
}

console.log('\nEACH FAILURE MODE IS CAUGHT');
const cases = [
  ['redirect', /REDIRECTS \(301\)/, 'the 2026-08-06 outage: a 301 to a cleartext host'],
  ['down', /HTTP 503/, 'the origin is down'],
  ['errorpage', /not the app, it is an error page/, '200 OK on something that is not the app'],
  ['stale-title', /Meccha IRL/, 'the title link previews depend on has changed'],
  ['ch-off', /CH_MAKE=true/, 'challenge publishing switched off'],
  ['broken-js', /SYNTAX ERROR/, 'served JavaScript does not parse — dead app, 200 OK'],
];
for (const [m, re, why] of cases) {
  const r = await run(m);
  r.code === 1 && re.test(r.out)
    ? ok(`${why}`)
    : bad(`NOT CAUGHT — ${why} (exit ${r.code})\n${r.out.split('\n').slice(0, 6).join('\n')}`);
}

server.close();
console.log(failed ? `\n✗ ${failed} failure(s)` : '\n✓ the watchdog fails on everything it claims to catch');
process.exit(failed ? 1 : 0);
