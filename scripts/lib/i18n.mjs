/* WHAT THE DICTIONARY HAS TO COVER, read from the source the same way the page reads it.
 *
 * index.html translates two kinds of copy: what the script renders through kT("…"),
 * kTn("… {n} …", n) and the tagged kT`… ${a} … ${b} …` at each call site, and the static
 * markup's text nodes and four attributes, which kTr() walks once at boot. Both sets of keys
 * are derived HERE from index.html so that check.mjs can hold KLANG to them — a key whose
 * English changed at the call site is a translation that can never be shown again, and a key
 * with no entry is English shipped to exactly the users the dictionary exists for. Neither is
 * visible in a browser set to English, which is every browser the DOM tests run in.
 *
 * The key of a tagged template is what kT builds at runtime: the cooked string pieces joined
 * by {0}, {1}, … in source order. cook() mirrors the escapes JavaScript applies, so a "\n" in
 * the source and the newline the page actually sees are the same key.
 */

export function cook(s) {
  return s.replace(/\\(u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|([\s\S]))/g, (m, _a, u1, u2, x, c) => {
    if (u1) return String.fromCodePoint(parseInt(u1, 16));
    if (u2) return String.fromCharCode(parseInt(u2, 16));
    if (x) return String.fromCharCode(parseInt(x, 16));
    return { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', '0': '\0', '\n': '' }[c] ?? c;
  });
}

/* Every kT( / kTn( / kT` call in the inline scripts. Returns [{key, line}] with duplicates
   kept, so a caller can count call sites; dedupe with new Set(map(k => k.key)). A call whose
   first argument is not a literal (kT(f.label), kT(msg)) is a pass-through of a key wrapped
   elsewhere and is not a key of its own. */
export function callKeys(html) {
  const out = [];
  const lineAt = (i) => html.slice(0, i).split('\n').length;
  const plain = /\bkTn?\(\s*(["'])((?:\\[\s\S]|(?!\1)[^\\\n])*)\1/g;
  let m;
  while ((m = plain.exec(html))) out.push({ key: cook(m[2]), line: lineAt(m.index) });
  const tagged = /\bkT`/g;
  while ((m = tagged.exec(html))) {
    let i = m.index + 3, key = '', n = 0, piece = '';
    while (i < html.length) {
      const c = html[i];
      if (c === '\\') { piece += c + html[i + 1]; i += 2; continue; }
      if (c === '`') { i++; break; }
      if (c === '$' && html[i + 1] === '{') {
        key += cook(piece) + '{' + (n++) + '}'; piece = '';
        let d = 1; i += 2;
        while (i < html.length && d) {
          const ch = html[i];
          if (ch === '`') { i = skipTemplate(html, i); continue; }
          if (ch === '"' || ch === "'") { i = skipString(html, i); continue; }
          if (ch === '{') d++; else if (ch === '}') d--;
          i++;
        }
        continue;
      }
      piece += c; i++;
    }
    key += cook(piece);
    out.push({ key, line: lineAt(m.index) });
    tagged.lastIndex = i;
  }
  return out;
}
function skipString(s, i) { const q = s[i]; i++; while (i < s.length) { if (s[i] === '\\') { i += 2; continue; } if (s[i] === q) return i + 1; i++; } return i; }
function skipTemplate(s, i) { i++; while (i < s.length) { if (s[i] === '\\') { i += 2; continue; } if (s[i] === '`') return i + 1; if (s[i] === '$' && s[i + 1] === '{') { let d = 1; i += 2; while (i < s.length && d) { if (s[i] === '`') { i = skipTemplate(s, i); continue; } if (s[i] === '"' || s[i] === "'") { i = skipString(s, i); continue; } if (s[i] === '{') d++; else if (s[i] === '}') d--; i++; } continue; } i++; } return i; }

/* The static markup: every text node and placeholder/aria-label/title/alt value between <body>
   and the first <script>, whitespace collapsed exactly as kTr collapses it. */
export function staticKeys(html) {
  /* At a line start: a CSS comment above the body says "<body> at boot" and would move the
     start of the walk into the stylesheet. */
  const a = html.indexOf('\n<body>') + 1;
  const b = html.indexOf('\n<script', a) + 1;
  let s = html.slice(a, b).replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)[\s\S]*?<\/\1>/g, '');
  const dec = (t) => t.replace(/&middot;/g, '·').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&rarr;/g, '→').replace(/&times;/g, '×').replace(/&hellip;/g, '…').replace(/&#8203;/g, '');
  const texts = [...s.matchAll(/>([^<>]*)</g)].map((m) => dec(m[1]).replace(/\s+/g, ' ').trim());
  const attrs = [...s.matchAll(/\b(placeholder|aria-label|title|alt)="([^"]+)"/g)].map((m) => dec(m[2]).trim());
  return [...new Set([...texts, ...attrs].filter((t) => /[A-Za-z]{2,}/.test(t) && !/^(KA|MO|KAMO)$/.test(t)))];
}

/* The KLANG literal, as the page evaluates it. It is kept as strict JSON on purpose, so this
   reads exactly what the browser gets and nothing can hide in an expression. */
export function dictionary(html) {
  const m = html.match(/\nconst KLANG = (\{[\s\S]*?\n\});\n/);
  if (!m) throw new Error('const KLANG = {…}; is gone from index.html');
  return JSON.parse(m[1]);
}

/* The languages the UI is translated in FULL — every string the page asks for. The other
   entries of KLANG carry the core set (static markup and the first call sites) and fall back
   to English for the rest, which is what they did before. */
export const FULL = ['ru', 'es', 'pt', 'fr'];
export const placeholders = (s) => [...s.matchAll(/\{(\d+|n)\}/g)].map((m) => m[1]).sort().join(',');
export const tags = (s) => [...s.matchAll(/<\/?([a-z]+)\b/g)].map((m) => m[1]).sort().join(',');
