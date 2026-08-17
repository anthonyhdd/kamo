#!/usr/bin/env node
/**
 * THE TWO BODIES, RENDERED FROM THE SHIPPED MODELS — vendor/body-{classic,v2}-{stand,wave}.png
 *
 * The player card shows the two characters as pictures rather than as the words "Original"
 * and "New", because the difference between them is a difference of BUILD: the second is
 * wider and rounder with a much larger head, and it is very slightly SHORTER. No label
 * carries that, and a hand-drawn icon of it would be a guess — the same mistake the top bar's
 * figure was traced from the artwork to avoid.
 *
 * So these four stills come out of the app itself, driven headless:
 *   · the same THREE scene, the same materials, the same POSES table (Stand 0, Wave 1)
 *   · ONE common crop box for all four, so the size difference survives the framing — crop
 *     each to fill its own square and the only thing the reader needs to see is gone
 *   · centred on the character's AXIS (its world origin), never on its bounding box: a raised
 *     arm moves the box, and a box-centred crop leaves the body sitting off to one side
 *   · anchored on the FEET, so a pose that raises an arm does not slide the figure down
 *
 * Re-run it whenever vendor/kamo-v2.glb or makeCharacter() changes, or the card will be
 * showing a body the app no longer draws:
 *
 *   PW_CORE=<dir with node_modules> node scripts/shoot-bodies.mjs
 *
 * The live compose screen replaces the worn tile with a capture of the real figure (see
 * khBodyShot) — these are what everywhere else gets, including the whole feed side of the app
 * where the WebGL scene is not running at all.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { pwBases, chromeExe, PW_SETUP } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'vendor');
const req = createRequire(import.meta.url);
let chromium = null;
for (const base of pwBases(ROOT)) {
  try { ({ chromium } = req(base ? join(base, 'node_modules/playwright-core') : 'playwright-core')); break; } catch {}
}
if (!chromium) {
  console.log('· playwright-core not installed — cannot render the bodies — run: ' + PW_SETUP);
  process.exit(0);
}

const real = readFileSync(join(ROOT, 'index.html'), 'utf8');
const at = real.lastIndexOf('</script>');
const html = real.slice(0, at)
  + '\nwindow.__r={'
  + 'async prep(v2){ isPro=true; hasPass=true;'
  + '  try{ localStorage.setItem("kamo_char", v2?"v2":"classic"); }catch(e){}'
  + '  enterCompose();'
  + '  const t0=Date.now();'
  + '  while(v2 && !kamoV2 && Date.now()-t0<15000){ await new Promise(r=>setTimeout(r,200)); }'
  + '  if(v2){ clearCharacters(); spawnHider(); }'
  + '  await new Promise(r=>setTimeout(r,900));'
  + '  return {wants:wantsV2(), glb:!!kamoV2};'
  + '},'
  + 'async pose(i){ try{ setPose(characters[0],i); }catch(e){} await new Promise(r=>setTimeout(r,1500)); return true; },'
  + 'box(){ const c=characters[0]; if(!c) return null;'
  + '  const b=new THREE.Box3().setFromObject(c.charG); const pts=[];'
  + '  for(const x of [b.min.x,b.max.x]) for(const y of [b.min.y,b.max.y]) for(const z of [b.min.z,b.max.z]){'
  + '    const v=new THREE.Vector3(x,y,z).project(camera3);'
  + '    pts.push([ (v.x*0.5+0.5)*glCanvas.clientWidth, (-v.y*0.5+0.5)*glCanvas.clientHeight ]); }'
  + '  const xs=pts.map(p=>p[0]), ys=pts.map(p=>p[1]);'
  + '  return {x:Math.min(...xs), y:Math.min(...ys), w:Math.max(...xs)-Math.min(...xs), h:Math.max(...ys)-Math.min(...ys)};'
  + '},'
  /* Cadre fixe : le centre est celui des PIEDS, pas de la bbox — sinon un bras levé
     décale toute la figurine vers le bas d une pose à l autre. */
  + 'tile(size,side){ renderer.render(scene,camera3);'
  + '  const b=this.box(); if(!b) return null;'
  + '  const sx=glCanvas.width/glCanvas.clientWidth, sy=glCanvas.height/glCanvas.clientHeight;'
  + '  const r=new THREE.Vector3(); characters[0].charG.getWorldPosition(r); r.project(camera3);'
  + '  const cx=(r.x*0.5+0.5)*glCanvas.clientWidth, cy=(b.y+b.h)-side*0.46;'
  + '  const c=document.createElement("canvas"); c.width=size; c.height=size;'
  + '  c.getContext("2d").drawImage(glCanvas,(cx-side/2)*sx,(cy-side/2)*sy,side*sx,side*sy,0,0,size,size);'
  + '  return c.toDataURL("image/png"); }'
  + '};\n'
  + real.slice(at);

const server = createServer((rq, rs) => {
  const p = rq.url.split('?')[0];
  if (p === '/' || p === '/index.html') { rs.writeHead(200, {'content-type':'text/html'}); rs.end(html); return; }
  try {
    const buf = readFileSync(join(ROOT, p));
    const ext = p.split('.').pop();
    const type = ext==='js' ? 'text/javascript' : ext==='glb' ? 'model/gltf-binary' : 'application/octet-stream';
    rs.writeHead(200, {'content-type':type}); rs.end(buf);
  } catch { rs.writeHead(404); rs.end(''); }
});
await new Promise(r => server.listen(0, r));
const url = 'http://127.0.0.1:' + server.address().port + '/';

const browser = await chromium.launch({
  executablePath: chromeExe(ROOT) || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(1500);

const SIDE = 330;
for (const [name, v2] of [['classic', false], ['v2', true]]) {
  console.log(name, JSON.stringify(await page.evaluate((v) => window.__r.prep(v), v2)));
  for (const [pn, pi] of [['stand', 0], ['wave', 1]]) {
    await page.evaluate((i) => window.__r.pose(i), pi);
    const png = await page.evaluate((s) => window.__r.tile(200, s), SIDE);
    writeFileSync(join(OUT, `body-${name}-${pn}.png`), Buffer.from(png.split(',')[1], 'base64'));
    console.log('  ', pn, 'ok');
  }
}
await browser.close();
server.close();
console.log('ok');
