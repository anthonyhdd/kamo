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

/* The challenge card the Worker's upstream renders — tiny on purpose. What matters about it
   is the og: tags and the RESPONSE HEADERS, not the body, which is the whole lesson of
   2026-08-12: the body was perfect and every human still got a blank page. */
const CARD = '<!doctype html><html><head><meta property="og:title" content="@tony hid a body in here">'
  + '<meta property="og:image" content="https://qpztlobbnjyjbxqyuzgg.supabase.co/storage/v1/object/public/hides/x.jpg">'
  + '</head><body style="background:#000"><script>location.replace("/?h=abc")</script></body></html>';

let mode = 'healthy';
let chMode = 'ch-healthy';
const server = createServer((req, res) => {
  /* /h/* is the challenge link, served by a different thing in production (a Cloudflare
     Worker in front of a Supabase edge function) and therefore failing independently. */
  if (req.url.startsWith('/h/')) {
    if (chMode === 'ch-404') { res.writeHead(404); return res.end('not found'); }
    if (chMode === 'ch-redirect') { res.writeHead(302, { Location: 'https://playkamo.com/' }); return res.end(); }
    const headers = { 'Content-Type': 'text/html' };
    // The Supabase gateway's anti-phishing header, passed through by a Worker that stopped
    // deleting it. This exact string is the 2026-08-12 outage.
    if (chMode === 'ch-csp') headers['Content-Security-Policy'] = "default-src 'none'; sandbox";
    res.writeHead(200, headers);
    return res.end(chMode === 'ch-noog' ? '<!doctype html><html><head></head><body></body></html>' : CARD);
  }
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

/* ---- THE CHALLENGE LINK ------------------------------------------------------------------
   Driven separately because it is a separate origin in production and because the failure it
   exists to catch is invisible to every check above: the body is correct and the HEADER is
   the fault. The origins are held healthy throughout, so a non-zero exit here can only have
   come from the challenge check. */
function runChallenge(m) {
  mode = 'healthy'; chMode = m;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(ROOT, 'scripts', 'watchdog.mjs')], {
      env: {
        ...process.env,
        KAMO_WATCH_ORIGINS: JSON.stringify([{ name: 'test origin', url }]),
        KAMO_WATCH_CHALLENGE: JSON.stringify({ name: 'test challenge', url: `${url}h/canary` }),
        KAMO_CANARY_HIDE: 'canary',
      },
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ code, out }));
  });
}

console.log('\nA HEALTHY CHALLENGE LINK PASSES');
{
  const r = await runChallenge('ch-healthy');
  r.code === 0 ? ok('200, no CSP, per-hide og: tags → exit 0')
    : bad(`a healthy challenge link failed, so every run would cry wolf:\n${r.out}`);
}

console.log('\nTHE BLANK-PAGE OUTAGE IS CAUGHT');
const chCases = [
  ['ch-csp', /BLANK-PAGE OUTAGE/, 'the 2026-08-12 outage: a passed-through gateway CSP sandboxes the page'],
  ['ch-404', /HTTP 404/, 'every challenge link is dead'],
  ['ch-redirect', /REDIRECTS \(302\)/, 'the Worker route stopped matching and Pages answers /h/*'],
  ['ch-noog', /no og:title/, 'the per-hide <head> is gone — every link previews the same picture'],
];
for (const [m, re, why] of chCases) {
  const r = await runChallenge(m);
  r.code === 1 && re.test(r.out)
    ? ok(`${why}`)
    : bad(`NOT CAUGHT — ${why} (exit ${r.code})\n${r.out.split('\n').slice(0, 8).join('\n')}`);
}

/* THE CHECK MUST NOT FIRE WHEN IT CANNOT MEAN ANYTHING. Every case above this one overrides
   the origins, and the challenge default points at the real playkamo.com — so without this
   skip a unit test would reach the internet and go red on a train. Assert the skip, or the
   next person removes it as dead weight. */
console.log('\nAND IT STAYS OUT OF THE WAY OF THE LOCAL TESTS');
{
  const r = await run('healthy');   // origins overridden, challenge NOT — must not be checked
  /* "challenge link" and not "challenge": MUST_CONTAIN already prints "challenge publishing"
     on every healthy run, and matching that made this assertion fail on correct behaviour. */
  r.code === 0 && !/challenge link/i.test(r.out)
    ? ok('overriding the origins alone leaves the challenge check silent')
    : bad(`the challenge check ran against production from a local test:\n${r.out}`);
}

server.close();
console.log(failed ? `\n✗ ${failed} failure(s)` : '\n✓ the watchdog fails on everything it claims to catch');
process.exit(failed ? 1 : 0);
