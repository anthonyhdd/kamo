#!/usr/bin/env node
/**
 * THE TOP-LEFT GLYPH IS TRACED FROM THE APP ICON, AND THIS IS WHAT TRACES IT.
 *
 * The button next to the wordmark carries the KAMO figure — the one peeking past an edge on
 * icon.png. It was hand-drawn three times before this script existed and it was wrong three
 * times, because a drawing made from looking at a picture is a guess: the proportions drift,
 * the pose flattens, and at 21px the difference between the artwork and an impression of it
 * is the difference between a brand mark and a doodle. The pixels were in the repository the
 * whole time.
 *
 * How it works: render icon.png into a 320px canvas, threshold at luminance 118 (the icon is
 * a bright figure on a near-black ground — the histogram is cleanly bimodal, so the exact
 * value is not delicate), flood-fill to label connected components, drop anything under 180px
 * so the glow speckle goes, follow the boundary of what survives with a Moore neighbourhood
 * walk, and simplify with Douglas-Peucker at 1.6px. Chromium does the PNG decoding, which is
 * why this needs playwright-core: the repo has no image library and does not want one.
 *
 * The WALL is not in the output and cannot be: the icon keeps it in shadow, so it falls below
 * any threshold that isolates the figure. It is added by hand in index.html as a single
 * stroked line — without it the figure reads as standing rather than as hiding.
 *
 * Re-run this if the app icon is ever re-rendered. Do not nudge the path in index.html by
 * hand; that is how it drifts back into being a drawing.
 *
 *   PW_CORE=<dir with node_modules> node scripts/trace-icon.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
const ROOT = new URL('..', import.meta.url).pathname;
const req = createRequire(import.meta.url);
let chromium = null;
for (const base of [process.env.PW_CORE, ROOT, process.cwd()]) {
  try { ({ chromium } = req(base ? base.replace(/\/$/, '') + '/node_modules/playwright-core' : 'playwright-core')); break; } catch {}
}
if (!chromium) { console.log('· playwright-core not installed — set PW_CORE=<dir with node_modules>'); process.exit(0); }
const server = createServer((rq,rs)=>{
  if(rq.url.startsWith('/icon.png')){rs.writeHead(200,{'Content-Type':'image/png'});return rs.end(readFileSync(ROOT + 'icon.png'));}
  rs.writeHead(200,{'Content-Type':'text/html'});rs.end('<body></body>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const { globSync } = await import('node:fs');
const b = await chromium.launch({executablePath: globSync('/opt/pw-browsers/chromium-*/chrome-linux/chrome')[0]});
const p = await b.newPage();
await p.goto(`http://127.0.0.1:${server.address().port}/`);
const paths = await p.evaluate(async ()=>{
  const img=new Image(); img.src='/icon.png'; await img.decode();
  const N=320, c=document.createElement('canvas'); c.width=N;c.height=N;
  const g=c.getContext('2d'); g.drawImage(img,0,0,N,N);
  const d=g.getImageData(0,0,N,N).data;
  const L=(i,j)=>{const k=(j*N+i)*4; return 0.2126*d[k]+0.7152*d[k+1]+0.0722*d[k+2];};
  const T=118;
  const on=(i,j)=> i>=0&&j>=0&&i<N&&j<N && L(i,j)>T;
  // label components (4-conn) to drop the glow speckle
  const lab=new Int32Array(N*N).fill(-1); const comps=[];
  for(let j=0;j<N;j++)for(let i=0;i<N;i++){
    if(!on(i,j)||lab[j*N+i]>=0) continue;
    const id=comps.length; const st=[[i,j]]; let n=0; let minI=i,minJ=j;
    lab[j*N+i]=id;
    while(st.length){const [a,bb]=st.pop(); n++;
      if(bb<minJ||(bb===minJ&&a<minI)){minI=a;minJ=bb;}
      const nb=[[a+1,bb],[a-1,bb],[a,bb+1],[a,bb-1]];
      for(const [u,v] of nb){ if(on(u,v)&&lab[v*N+u]<0){lab[v*N+u]=id; st.push([u,v]);} }}
    comps.push({id,n,minI,minJ});
  }
  comps.sort((x,y)=>y.n-x.n);
  const keep=comps.filter(k=>k.n>=180).slice(0,4);
  // Moore boundary trace per kept component
  const trace=(comp)=>{
    const inC=(i,j)=> i>=0&&j>=0&&i<N&&j<N && lab[j*N+i]===comp.id;
    const dirs=[[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];
    let s=[comp.minI,comp.minJ], cur=s.slice(), dir=6, pts=[], guard=0;
    do{
      pts.push(cur.slice());
      let found=false;
      for(let k=0;k<8;k++){
        const nd=(dir+6+k)%8, u=cur[0]+dirs[nd][0], v=cur[1]+dirs[nd][1];
        if(inC(u,v)){ cur=[u,v]; dir=nd; found=true; break; }
      }
      if(!found) break;
      if(++guard>60000) break;
    } while(!(cur[0]===s[0]&&cur[1]===s[1]));
    return pts;
  };
  const rdp=(pts,eps)=>{
    if(pts.length<3) return pts;
    let dmax=0, idx=0; const [x1,y1]=pts[0], [x2,y2]=pts[pts.length-1];
    for(let i=1;i<pts.length-1;i++){
      const [x0,y0]=pts[i];
      const num=Math.abs((y2-y1)*x0-(x2-x1)*y0+x2*y1-y2*x1);
      const den=Math.hypot(y2-y1,x2-x1)||1e-9;
      const dd=num/den; if(dd>dmax){dmax=dd;idx=i;}
    }
    if(dmax>eps){ const a=rdp(pts.slice(0,idx+1),eps), bb=rdp(pts.slice(idx),eps);
      return a.slice(0,-1).concat(bb); }
    return [pts[0],pts[pts.length-1]];
  };
  const S=24/N;
  return keep.map(k=>{
    const pts=rdp(trace(k),1.6);
    return {n:k.n, d:'M'+pts.map(([i,j])=>`${(i*S).toFixed(2)} ${(j*S).toFixed(2)}`).join('L')+'Z'};
  });
});
console.log('components:', paths.map(p => p.n).join(', '));

/* FITTED HERE, NOT BY HAND. The raw trace is in icon.png's own frame, which is not this
   button's: the icon has its own padding and the glyph has to leave room on the left for the
   wall that the threshold cannot see. Doing the fit in the script is what makes re-running it
   produce the exact string that is in index.html, rather than a starting point someone then
   nudges. LEFT is the gap reserved for the wall; M is the margin on the other three sides. */
const pts = paths.flatMap(p => p.d.slice(1, -1).split('L').map((t) => t.trim().split(/\s+/).map(Number)));
const x0 = Math.min(...pts.map(q => q[0])), x1 = Math.max(...pts.map(q => q[0]));
const y0 = Math.min(...pts.map(q => q[1])), y1 = Math.max(...pts.map(q => q[1]));
const M = 1.3, LEFT = 2.6;
const k = Math.min((24 - LEFT - M) / (x1 - x0), (24 - 2 * M) / (y1 - y0));
const ox = LEFT - x0 * k, oy = (24 - (y1 - y0) * k) / 2 - y0 * k;
const f = (v) => Number(v.toFixed(2));
const fitted = paths.map((p) => 'M' + p.d.slice(1, -1).split('L')
  .map((t) => { const [a, c] = t.trim().split(/\s+/).map(Number); return `${f(a * k + ox)} ${f(c * k + oy)}`; })
  .join('L') + 'Z');

console.log('\n--- paste into #btnPlus in index.html ---');
console.log(`<path d="M${f(LEFT - 0.75)} ${f(M - 0.2)}V${f(24 - M + 0.2)}" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>`);
fitted.forEach((d) => console.log(`<path d="${d}"/>`));
await b.close(); server.close();
