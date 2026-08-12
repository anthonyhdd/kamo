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
    const pts=rdp(trace(k),0.8);
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
/* No gap reserved on the left any more: the hand-drawn panel is gone, so the figure gets the
   whole box and the same margin on all four sides. */
const M = 1.3, LEFT = 1.3;
const k = Math.min((24 - LEFT - M) / (x1 - x0), (24 - 2 * M) / (y1 - y0));
const ox = LEFT - x0 * k, oy = (24 - (y1 - y0) * k) / 2 - y0 * k;
const f = (v) => Number(v.toFixed(2));
const fitted = paths.map((p) => 'M' + p.d.slice(1, -1).split('L')
  .map((t) => { const [a, c] = t.trim().split(/\s+/).map(Number); return `${f(a * k + ox)} ${f(c * k + oy)}`; })
  .join('L') + 'Z');

/* THE CUT EDGE IS STRAIGHT, AND THE THRESHOLD DOES NOT KNOW THAT. Where the figure is hidden
   by the panel, its boundary is a straight vertical line — but the panel's shadow falls across
   the body there, so a luminance cut nibbles two shallow notches out of it, one at chest height
   and one at the belly. At 21px they are invisible; at any size where the outline reads, they
   are a stray tick on the one edge that should be perfectly flat, and they are not in the
   artwork.
   Flattened here rather than in index.html, so a re-run reproduces the shipped path instead of
   re-introducing them. The edge is found as the MEDIAN x of the left-hand boundary points, not
   the minimum — the raised hand pokes further left than the body does, so a minimum would drag
   the whole edge over to the hand. Only wobble within 0.9 of that line is snapped; the hand
   (1.2 out) and the foot (1.4 out) are real and survive. */
const flatten = (d) => {
  const q = d.slice(1, -1).split('L').map((t) => t.trim().split(/\s+/).map(Number));
  const xs = q.map((v) => v[0]), lo = Math.min(...xs), hi = Math.max(...xs);
  /* The MODE of the left-hand x values, in 0.25 buckets — not their median. A median is pulled
     by the hand and the foot, which are left-side points too and stick out further than the
     body; it landed half a pixel to the right of the real edge and bent the whole cut. The cut
     is the value that RECURS, because it is a straight line and everything else is a corner. */
  const left = xs.filter((x) => x < lo + (hi - lo) * 0.28);
  const bins = new Map();
  left.forEach((x) => { const k = Math.round(x * 4) / 4; (bins.get(k) || bins.set(k, []).get(k)).push(x); });
  let bin = [];
  bins.forEach((v) => { if (v.length > bin.length) bin = v; });
  const edge = Math.min(...bin);
  const snapped = q.map(([x, y]) => [Math.abs(x - edge) < 0.9 ? edge : x, y]);
  const out = snapped.filter((v, i) => {
    if (i === 0 || i === snapped.length - 1) return true;
    const [px, py] = snapped[i - 1], [cx, cy] = v, [nx, ny] = snapped[i + 1];
    return !(px === cx && cx === nx);   // collinear on the flat cut — including the notch it just swallowed
  }).filter((v, i, a) => i === 0 || v[0] !== a[i - 1][0] || v[1] !== a[i - 1][1]);
  return 'M' + out.map(([x, y]) => `${f(x)} ${f(y)}`).join('L') + 'Z';
};

console.log('\n--- paste into #btnPlus in index.html ---');
fitted.map(flatten).forEach((d) => console.log(`<path d="${d}"/>`));
await b.close(); server.close();
