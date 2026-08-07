#!/usr/bin/env node
/**
 * THE RESULTS CHIP, IN A REAL BROWSER.
 *
 * Everything here is state that only exists at runtime — localStorage, a network answer, and
 * a screen mode — so none of it can be checked by reading the file. What it guards:
 *
 *  · the device remembers what it published at all. Before this, chId was a module-level let
 *    reset every round and never persisted: 518 hides on the server, none attributable to a
 *    phone, and so nothing for a re-engagement surface to read.
 *  · republish REPLACES the old id rather than adding one. Changing taps in the gear mints a
 *    new hide; leaving the old one first would show someone attempts against a round they
 *    abandoned.
 *  · zero attempts says NOTHING. "0 tried" turns a reward into a reproach, and 88% of hides
 *    have never been opened by anyone.
 *  · one read, on the newest hide only.
 *  · it belongs to the camera screen and leaves the moment a round starts.
 *
 * Skips loudly when playwright-core is absent — see scripts/test-peek-dom.mjs.
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-mine-dom.mjs
 */
import { createServer } from 'node:http'; import { readFileSync, globSync } from 'node:fs'; import { join } from 'node:path';
const ROOT='/workspace/kamo';
const real=readFileSync(join(ROOT,'index.html'),'utf8'); const at=real.lastIndexOf('</script>');
const hook=`
window.__t={
  remember:(id)=>{chRemember(id);return chMine();},
  republish:(id,prev)=>{chRemember(id,prev);return chMine();},
  results:async(fake)=>{ window.__rpc=[]; chRpc=async(fn,b)=>{window.__rpc.push([fn,b]); return fake;};
    mineMsg=""; mode="compose"; finished=false; await chMyResults();
    const el=document.getElementById("mineChip");
    return {html:el.innerHTML, display:getComputedStyle(el).display, rpc:window.__rpc}; },
  hideOnRound:()=>{ mode="paint"; updateMineChip(); return getComputedStyle(document.getElementById("mineChip")).display; },
  clear:()=>{ localStorage.removeItem("kamo_hides"); return chMine(); }
};
`;
const html=real.slice(0,at)+hook+real.slice(at);
const MIME={'.js':'text/javascript','.png':'image/png','.json':'application/json'};
const s=createServer((q,r)=>{const p=q.url.split('?')[0];
 if(p==='/'){r.writeHead(200,{'Content-Type':'text/html'});return r.end(html);}
 try{const b=readFileSync(join(ROOT,p.slice(1)));r.writeHead(200,{'Content-Type':MIME[p.slice(p.lastIndexOf('.'))]||'application/octet-stream'});r.end(b);}catch{r.writeHead(404);r.end();}});
await new Promise(r=>s.listen(0,'127.0.0.1',r));
const { createRequire } = await import('node:module');
const req = createRequire(import.meta.url);
let chromium;
for (const base of [process.env.PW_CORE || '', ROOT, process.cwd()]) {
  try { ({ chromium } = req(base ? join(base, 'node_modules/playwright-core') : 'playwright-core')); break; } catch {}
}
if (!chromium) { console.log('· playwright-core not installed — skipping the results-chip DOM test'); s.close(); process.exit(0); }
const b = await chromium.launch({executablePath: globSync('/opt/pw-browsers/chromium-*/chrome-linux/chrome')[0]});
const p = await b.newPage({viewport:{width:390,height:844}});
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto(`http://127.0.0.1:${s.address().port}/`);
await p.waitForFunction(()=>!!window.__t,null,{timeout:10000}).catch(()=>{});
let f=0; const ok=m=>console.log('  ✓ '+m); const bad=m=>{f++;console.error('  ✗ '+m);};

console.log('\nLE TELEPHONE SE SOUVIENT DE SES HIDES');
await p.evaluate(()=>window.__t.clear());
const l1=await p.evaluate(()=>window.__t.remember('aaa'));
const l2=await p.evaluate(()=>window.__t.remember('bbb'));
JSON.stringify(l2)===JSON.stringify(['bbb','aaa'])?ok('newest first ('+JSON.stringify(l2)+')'):bad('ordre: '+JSON.stringify(l2));
const l3=await p.evaluate(()=>window.__t.republish('ccc','bbb'));
JSON.stringify(l3)===JSON.stringify(['ccc','aaa'])?ok('republish remplace l ancien id ('+JSON.stringify(l3)+')'):bad('republish: '+JSON.stringify(l3));
const cap=await p.evaluate(()=>{for(let i=0;i<20;i++)window.__t.remember('x'+i);return window.__t.remember('last').length;});
cap===10?ok('plafonne a 10'):bad('taille '+cap);

console.log('\nLA PASTILLE NE PARLE QUE QUAND IL Y A UNE NOUVELLE');
await p.evaluate(()=>window.__t.clear());
await p.evaluate(()=>window.__t.remember('abc'));
const zero=await p.evaluate(()=>window.__t.results({n_attempts:0,n_found:0}));
zero.display==='none'&&zero.html===''?ok('0 tentative → rien (pas de "0 tried")'):bad('affiche quelque chose a 0: '+JSON.stringify(zero));
const some=await p.evaluate(()=>window.__t.results({n_attempts:12,n_found:3}));
some.display!=='none'&&/12 people tried/.test(some.html)&&/3 found you/.test(some.html)?ok('12/3 → "'+some.html.replace(/<[^>]+>/g,'')+'"'):bad('rendu: '+JSON.stringify(some));
const one=await p.evaluate(()=>window.__t.results({n_attempts:1,n_found:0}));
/1 person tried/.test(one.html)&&/nobody found you/.test(one.html)?ok('1 seul → "'+one.html.replace(/<[^>]+>/g,'')+'"'):bad('singulier: '+one.html);
JSON.stringify(one.rpc)===JSON.stringify([['get_hide',{p_id:'abc'}]])?ok('une seule lecture, sur le hide le plus recent'):bad('rpc: '+JSON.stringify(one.rpc));
const hidden=await p.evaluate(()=>window.__t.hideOnRound());
hidden==='none'?ok('disparait des qu une manche commence'):bad('encore visible en paint: '+hidden);

console.log('\nerreurs page: '+(errs.length?errs.join('\n'):'(aucune)'));
if(errs.length)f++;
await b.close(); s.close();
console.log(f?`\n✗ ${f} echec(s)`:'\n✓ tout passe');
process.exit(f?1:0);
