// يجهّز مجلد www: ينسخ src ثم ينزّل مكتبات الـCDN والخط ويضعها داخل التطبيق ليعمل دون إنترنت.
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '..', 'src');
const OUT = path.join(__dirname, '..', 'www');
const STRICT = process.env.REQUIRE_OFFLINE === 'true';
const UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

function copyDir(a, b) {
  fs.mkdirSync(b, { recursive: true });
  for (const f of fs.readdirSync(a)) {
    const s = path.join(a, f), d = path.join(b, f);
    fs.statSync(s).isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
  }
}
async function get(url, bin) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 60000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: c.signal, redirect: 'follow' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return bin ? Buffer.from(await r.arrayBuffer()) : await r.text();
  } finally { clearTimeout(t); }
}

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  copyDir(SRC, OUT);
  const file = path.join(OUT, 'index.html');
  let html = fs.readFileSync(file, 'utf8');
  fs.mkdirSync(path.join(OUT, 'vendor', 'fonts'), { recursive: true });
  const ok = [], failed = [];

  // 1) مكتبات الـCDN (React, Tailwind, Babel, ...)
  const scripts = [...new Set([...html.matchAll(/<script[^>]*\ssrc="(https?:\/\/[^"]+)"/g)].map(m => m[1]))];
  let i = 0;
  for (const url of scripts) {
    const name = 'vendor/lib' + (i++) + '.js';
    try {
      fs.writeFileSync(path.join(OUT, name), await get(url, true));
      html = html.split(url).join(name);
      ok.push(url);
    } catch (e) { failed.push(url + ' (' + e.message + ')'); }
  }

  // 2) خط Tajawal (للتطبيق ولتضمينه داخل صور التقارير)
  const fm = html.match(/https:\/\/fonts\.googleapis\.com\/css2\?[^'"\s)]+/);
  if (fm) {
    const cssUrl = fm[0];
    try {
      const css = await get(cssUrl, false);
      const blocks = [...css.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*(@font-face\s*\{[^}]*\})/g)].filter(b => b[1] === 'arabic' || b[1] === 'latin');
      if (!blocks.length) throw new Error('no font blocks');
      let out = '', n = 0;
      for (const b of blocks) {
        const u = b[2].match(/url\((https:[^)]+)\)/);
        if (!u) continue;
        const fn = 'vendor/fonts/tajawal-' + (n++) + '.woff2';
        fs.writeFileSync(path.join(OUT, fn), await get(u[1], true));
        out += '/* ' + b[1] + ' */\n' + b[2].replace(u[0], 'url(' + fn + ')') + '\n';
      }
      fs.writeFileSync(path.join(OUT, 'tajawal.css'), out);
      html = html.split(cssUrl).join('tajawal.css');
      // كود تضمين الخط في الصورة كان يتوقع روابط https فقط؛ نسمح بالروابط المحلية
      const pat = 'url\\((https:[^)]+)\\)';
      if (html.includes(pat)) html = html.replace(pat, 'url\\(([^)]+)\\)');
      else throw new Error('font-embed pattern not found');
      ok.push(cssUrl);
    } catch (e) { failed.push('Tajawal font (' + e.message + ')'); }
  }

  fs.writeFileSync(file, html);
  console.log('Bundled locally: ' + ok.length + ' | Failed: ' + failed.length);
  failed.forEach(f => console.warn('  FAILED: ' + f));
  if (failed.length && STRICT) { console.error('REQUIRE_OFFLINE is on: aborting build.'); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
