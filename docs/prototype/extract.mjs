// One-off: unpack the bundled prototype into docs/prototype/extracted/
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const SRC = path.resolve('docs/prototype/Augur-Terminal.html');
const OUT = path.resolve('docs/prototype/extracted');
fs.mkdirSync(path.join(OUT, 'resources'), { recursive: true });

const html = fs.readFileSync(SRC, 'utf8');

function scriptBody(type) {
  const re = new RegExp(`<script type="${type}">([\\s\\S]*?)<\\/script>`);
  const m = html.match(re);
  return m ? m[1].trim() : null;
}

// 1) template
const tplRaw = scriptBody('__bundler/template');
const template = JSON.parse(tplRaw);
fs.writeFileSync(path.join(OUT, 'template.html'), template);
console.log('template.html', template.length, 'chars');

// 2) thumbnail svg
const svg = html.match(/<svg viewBox[\s\S]*?<\/svg>/);
if (svg) {
  fs.writeFileSync(path.join(OUT, 'thumbnail.svg'), svg[0]);
  console.log('thumbnail.svg', svg[0].length, 'chars');
}

// 3) manifest resources (gzip+base64)
const ext = { 'text/javascript': 'js', 'text/css': 'css', 'font/woff2': 'woff2',
  'image/svg+xml': 'svg', 'image/png': 'png', 'application/json': 'json' };
for (const which of ['__bundler/manifest', '__bundler/ext_resources']) {
  const raw = scriptBody(which);
  if (!raw) { console.log(which, 'MISSING'); continue; }
  let manifest;
  try { manifest = JSON.parse(raw); } catch (e) { console.log(which, 'parse fail', e.message); continue; }
  for (const [id, entry] of Object.entries(manifest)) {
    if (!entry || !entry.data) continue;
    let buf = Buffer.from(entry.data, 'base64');
    if (entry.compressed) { try { buf = zlib.gunzipSync(buf); } catch (e) { /* maybe not gzip */ } }
    const e = ext[entry.mime] || 'bin';
    fs.writeFileSync(path.join(OUT, 'resources', `${id}.${e}`), buf);
    console.log(which, id, entry.mime, buf.length, 'bytes');
  }
}
console.log('DONE');
