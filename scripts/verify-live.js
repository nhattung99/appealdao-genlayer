const fs = require('fs');
const { execFileSync } = require('child_process');
const os = require('os');
const path = require('path');

const htmlPath = path.join(os.tmpdir(), 'appealdao.html');
const jsPath = path.join(os.tmpdir(), 'appealdao.js');

execFileSync('curl.exe', ['-sL', 'https://appealdao-genlayer.vercel.app/', '-o', htmlPath], { stdio: 'inherit' });
const html = fs.readFileSync(htmlPath, 'utf8');
console.log('html_bytes', html.length);
console.log('has_AppealDAO', html.includes('AppealDAO'));
console.log('has_root', html.includes('id="root"'));

const m = html.match(/src="\/assets\/([^"]+)"/);
if (!m) {
  console.log('NO_ASSET');
  process.exit(1);
}
console.log('asset', m[1]);
execFileSync('curl.exe', ['-sL', `https://appealdao-genlayer.vercel.app/assets/${m[1]}`, '-o', jsPath], { stdio: 'inherit' });
const js = fs.readFileSync(jsPath, 'utf8');
console.log('js_bytes', js.length);
console.log('has_addr', js.includes('0xa7811026685d8d1Bb1d65f77965B9A465668B4aA'));
console.log('has_zero', js.includes('0x0000000000000000000000000000000000000000'));
const idx = js.indexOf('a781102');
console.log('addr_idx', idx);
if (idx >= 0) console.log('context', js.slice(Math.max(0, idx - 60), idx + 80));
