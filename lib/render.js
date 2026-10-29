// AnimADS - página da animação + render frame a frame + mixagem
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function ffmpegPath() {
  if (process.env.ANIMADS_FFMPEG) return process.env.ANIMADS_FFMPEG;
  try { const p = require('ffmpeg-static'); if (p && fs.existsSync(p)) return p; } catch {}
  return 'ffmpeg';
}

function writePage(jobDir, an, plan) {
  const data = JSON.stringify({ analise: an, plano: plan, base: '' }).replace(/</g, '\\u003c');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>AnimADS preview</title>
<style>html,body{margin:0;background:#0b0b10;overflow:hidden}#stage{position:relative;overflow:hidden}
#stage img,.shine{position:absolute;display:block;will-change:transform,opacity;user-select:none}
.shine{pointer-events:none;background:linear-gradient(105deg,rgba(255,255,255,0) 38%,rgba(255,255,255,.55) 50%,rgba(255,255,255,0) 62%);
background-size:300% 100%;background-position:150% 0;background-repeat:no-repeat;-webkit-mask-size:100% 100%;mask-size:100% 100%}</style>
</head><body><div id="stage"></div>
<script>window.ANIMADS=${data};</script>
<script src="/player/gsap.min.js"></script><script src="/player/player.js"></script></body></html>`;
  fs.writeFileSync(path.join(jobDir, 'index.html'), html);
}

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = ''; p.stderr.on('data', d => err += d);
    p.on('error', reject);
    p.on('close', c => c === 0 ? resolve() : reject(new Error('ffmpeg: ' + err.slice(-400))));
  });
}

async function renderVideo({ url, F, dur, out, fps = 30 }, browser, onProgress = () => {}) {
  const pg = await browser.newPage({ viewport: { width: F.w, height: F.h }, deviceScaleFactor: 1 });
  try {
    await pg.goto(url);
    await pg.evaluate('window.ready');
    const stage = pg.locator('#stage');
    const n = Math.round(dur * fps);
    const ff = spawn(ffmpegPath(), ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out],
      { stdio: ['pipe', 'ignore', 'pipe'] });
    let ferr = ''; ff.stderr.on('data', d => ferr += d);
    const done = new Promise((res, rej) => { ff.on('error', rej); ff.on('close', c => c === 0 ? res() : rej(new Error('ffmpeg: ' + ferr.slice(-400)))); });
    for (let f = 0; f < n; f++) {
      await pg.evaluate(`seek(${f / fps})`);
      const img = await stage.screenshot({ type: 'jpeg', quality: 94 });
      if (!ff.stdin.write(img)) await new Promise(r => ff.stdin.once('drain', r));
      if (f % 10 === 0) onProgress(f / n);
    }
    ff.stdin.end();
    await done;
    onProgress(1);
  } finally { await pg.close(); }
}

async function snapshot({ url, F, t, out }, browser) {
  const pg = await browser.newPage({ viewport: { width: F.w, height: F.h } });
  try {
    await pg.goto(url); await pg.evaluate('window.ready');
    await pg.evaluate(`seek(${t})`);
    await pg.locator('#stage').screenshot({ path: out, type: 'jpeg', quality: 85 });
  } finally { await pg.close(); }
}

async function mux(video, wav, out) {
  await run(ffmpegPath(), ['-y', '-i', video, '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
    '-shortest', '-movflags', '+faststart', out]);
}

module.exports = { writePage, renderVideo, snapshot, mux, ffmpegPath };
