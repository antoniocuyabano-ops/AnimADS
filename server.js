// AnimADS - servidor local
// Abre a interface no navegador e executa o pipeline: análise → roteiro (Claude) → vídeo → som.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { analyze } = require('./lib/analyze');
const { makePlan } = require('./lib/plan');
const { writePage, renderVideo, snapshot, mux } = require('./lib/render');
const audio = require('./lib/audio');

const ROOT = __dirname;
const JOBS_DIR = path.join(ROOT, 'trabalhos');
const OUT_DIR = path.join(ROOT, 'saida');
const VERSION = require('./package.json').version;
fs.mkdirSync(JOBS_DIR, { recursive: true }); fs.mkdirSync(OUT_DIR, { recursive: true });

// ---------------- estado ----------------
const DB = path.join(JOBS_DIR, 'jobs.json');
let jobs = [];
try { jobs = JSON.parse(fs.readFileSync(DB, 'utf8')); } catch {}
jobs.forEach(j => { if (!['pronto', 'erro'].includes(j.status)) { j.status = 'erro'; j.erro = 'Interrompido (o AnimADS foi fechado).'; } });
const save = () => fs.writeFileSync(DB, JSON.stringify(jobs, null, 1));
const clients = new Set();
const emit = (type, data) => { const s = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`; for (const c of clients) c.write(s); };
const pub = j => { const { _tmp, ...rest } = j; return rest; };
const update = (j, patch) => { Object.assign(j, patch); save(); emit('job', pub(j)); };
const log = (j, msg) => { j.log = (j.log || []).concat(`${new Date().toLocaleTimeString('pt-BR')}  ${msg}`).slice(-80); emit('job', pub(j)); };

let claudeStatus = { ok: null, versao: null };
function checkClaude() {
  return new Promise(res => {
    const win = process.platform === 'win32';
    const p = spawn(process.env.ANIMADS_CLAUDE || 'claude', ['--version'], { shell: win });
    let out = ''; p.stdout.on('data', d => out += d);
    p.on('error', () => res({ ok: false }));
    p.on('close', c => res({ ok: c === 0, versao: out.trim().split('\n')[0] }));
    setTimeout(() => { try { p.kill(); } catch {} res({ ok: false }); }, 15000);
  }).then(s => (claudeStatus = s));
}

// ---------------- navegador de render ----------------
let browserP = null;
async function browser() {
  if (browserP) {
    try { const b = await browserP; if (b.isConnected()) return b; } catch {}
    browserP = null;
  }
  const { chromium } = require('playwright');
  const opts = process.env.ANIMADS_CHROMIUM ? { executablePath: process.env.ANIMADS_CHROMIUM } : {};
  browserP = chromium.launch(opts).then(b => { b.on('disconnected', () => { browserP = null; }); return b; })
    .catch(e => { browserP = null; throw new Error('Navegador de render não encontrado. Rode a instalação de novo. ' + e.message.split('\n')[0]); });
  return browserP;
}

// ---------------- pipeline ----------------
let port = 0;
const queue = [];
let running = false;
function enqueue(j, task) { queue.push([j, task]); if (j.status !== 'pronto') update(j, { status: 'na-fila' }); pump(); }
async function pump() {
  if (running || !queue.length) return;
  running = true;
  const [j, task] = queue.shift();
  try { await task(j); } catch (e) {
    console.error(e);
    update(j, { status: 'erro', erro: String(e.message || e).slice(0, 500) }); log(j, 'Erro: ' + (e.message || e));
  }
  running = false; pump();
}

const defaults = { estilo: 'energetico', duracao: 10, musica: true, efeitos: true, muda: true, claude: true };
const fmtName = F => {
  const r = F.w / F.h;
  if (Math.abs(r - 9 / 16) < 0.03) return '9x16'; if (Math.abs(r - 1) < 0.03) return '1x1';
  if (Math.abs(r - 4 / 5) < 0.03) return '4x5'; if (Math.abs(r - 16 / 9) < 0.03) return '16x9';
  return `${F.w}x${F.h}`;
};
const safe = s => s.replace(/[\\/:*?"<>|]+/g, '-').trim();

async function stepPlan(j, opts, feedback) {
  const jobDir = path.join(JOBS_DIR, j.id);
  const an = JSON.parse(fs.readFileSync(path.join(jobDir, 'analise.json'), 'utf8'));
  update(j, { status: 'roteiro', progresso: 0 });
  let previous = null;
  try { previous = JSON.parse(fs.readFileSync(path.join(jobDir, 'plano.json'), 'utf8')); } catch {}
  const plan = await makePlan(an, jobDir, { ...opts, claude: opts.claude && claudeStatus.ok !== false },
    { browser: await browser(), log: m => log(j, m), feedback, previous: feedback ? previous : null });
  writePage(jobDir, an, plan);
  update(j, { roteiro: { fonte: plan.fonte, resumo: plan.resumo || '', camadas: plan.camadas.length } });
  return { an, plan };
}

async function stepRender(j, an, plan, opts) {
  const jobDir = path.join(JOBS_DIR, j.id);
  const url = `http://127.0.0.1:${port}/trabalhos/${j.id}/index.html`;
  const b = await browser();
  await snapshot({ url, F: an.frame, t: plan.duracao - 0.05, out: path.join(jobDir, 'capa.jpg') }, b);
  update(j, { status: 'video', progresso: 0, capa: `/trabalhos/${j.id}/capa.jpg?v=${Date.now()}` });
  log(j, 'Renderizando o vídeo…');
  const silent = path.join(jobDir, 'video_mudo.mp4');
  let last = 0;
  await renderVideo({ url, F: an.frame, dur: plan.duracao, out: silent }, b, p => {
    if (p - last > 0.04 || p === 1) { last = p; j.progresso = Math.round(p * 100); emit('job', pub(j)); }
  });
  update(j, { status: 'som', progresso: 100 });
  const version = (j.versao || 0) + 1;
  const base = `AD_${safe(j.nome)}_${fmtName(an.frame)}_v${version}`;
  const finals = {};
  const withSound = opts.musica || opts.efeitos;
  if (withSound) {
    log(j, 'Gerando trilha e efeitos sonoros…');
    const wav = path.join(jobDir, 'trilha.wav');
    const n = audio.render(plan, an, wav, { musica: opts.musica, efeitos: opts.efeitos });
    log(j, `${n} efeitos sonoros sincronizados`);
    const outSom = path.join(jobDir, 'video_som.mp4');
    await mux(silent, wav, outSom);
    finals.som = outSom;
  }
  if (!withSound || opts.muda) finals.mudo = silent;

  // grava na pasta de origem (subpasta AnimADS) ou na pasta "saida" para uploads
  let destDir = j.uploaded ? path.join(OUT_DIR, safe(j.nome)) : path.join(j.origem, 'AnimADS');
  try { fs.mkdirSync(destDir, { recursive: true }); fs.accessSync(destDir, fs.constants.W_OK); }
  catch { destDir = path.join(OUT_DIR, safe(j.nome)); fs.mkdirSync(destDir, { recursive: true }); }
  const arquivos = [];
  if (finals.som) { const p = path.join(destDir, base + '.mp4'); fs.copyFileSync(finals.som, p); arquivos.push({ tipo: 'com som', caminho: p, url: `/trabalhos/${j.id}/video_som.mp4` }); }
  if (finals.mudo) { const p = path.join(destDir, base + (finals.som ? '_sem-som' : '') + '.mp4'); fs.copyFileSync(finals.mudo, p); arquivos.push({ tipo: 'sem som', caminho: p, url: `/trabalhos/${j.id}/video_mudo.mp4` }); }
  update(j, { status: 'pronto', progresso: 100, versao: version, arquivos, pastaSaida: destDir, terminadoEm: Date.now(), erro: null,
    videoUrl: (arquivos[0] || {}).url + `?v=${Date.now()}` });
  log(j, `Pronto! Salvo em ${destDir}`);
}

async function fullRun(j) {
  const opts = { ...defaults, ...(j.opcoes || {}) };
  const jobDir = path.join(JOBS_DIR, j.id);
  fs.rmSync(path.join(jobDir, 'img'), { recursive: true, force: true });
  fs.rmSync(path.join(jobDir, 'ref_anotada.png'), { force: true });
  update(j, { status: 'analise', progresso: 0, erro: null });
  log(j, 'Analisando camadas…');
  const an = await analyze(j.origem, jobDir, m => log(j, m));
  update(j, { encaixe: an.encaixe, frame: an.frame, formato: fmtName(an.frame), camadas: an.layers.length, referencia: `/trabalhos/${j.id}/referencia.png` });
  if (an.encaixe < 85) log(j, 'Atenção: o encaixe com a referência ficou baixo. Confira se as camadas são do mesmo frame.');
  const { plan } = await stepPlan(j, opts);
  await stepRender(j, an, plan, opts);
}

async function adjustRun(j, pedido) {
  const opts = { ...defaults, ...(j.opcoes || {}) };
  log(j, `Ajuste pedido: "${pedido}"`);
  const { an, plan } = await stepPlan(j, opts, pedido);
  await stepRender(j, an, plan, opts);
}

function hasPngs(dir) { try { return fs.readdirSync(dir).some(f => /\.png$/i.test(f)); } catch { return false; } }
function expandFolders(paths) {
  const out = [];
  for (const p of paths) {
    if (!p) continue;
    if (hasPngs(p)) { out.push(p); continue; }
    let subs = [];
    try { subs = fs.readdirSync(p, { withFileTypes: true }).filter(d => d.isDirectory() && d.name !== 'AnimADS').map(d => path.join(p, d.name)); } catch {}
    out.push(...subs.filter(hasPngs));
  }
  return out;
}

function addJobs(paths, opcoes, uploaded = false) {
  const created = [];
  for (const dir of expandFolders(paths)) {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const j = { id, nome: path.basename(dir), origem: dir, uploaded, opcoes: { ...defaults, ...opcoes }, status: 'na-fila', criadoEm: Date.now(), log: [] };
    fs.mkdirSync(path.join(JOBS_DIR, id), { recursive: true });
    jobs.unshift(j); created.push(j); save(); emit('job', pub(j));
    enqueue(j, fullRun);
  }
  return created;
}

// ---------------- seletor de pastas nativo ----------------
function pickFolders() {
  return new Promise((resolve) => {
    const done = (out) => resolve(out.split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(s => s.replace(/\/$/, '') || '/'));
    if (process.platform === 'win32') {
      const ps = `Add-Type -AssemblyName System.Windows.Forms; [Console]::OutputEncoding=[Text.Encoding]::UTF8;
$o=New-Object System.Windows.Forms.Form -Property @{TopMost=$true; ShowInTaskbar=$false};
$f=New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description='AnimADS - escolha a pasta do AD (ou a pasta com varias pastas de ADs)';
$f.ShowNewFolderButton=$false; if($f.ShowDialog($o) -eq 'OK'){ Write-Output $f.SelectedPath }`;
      execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', ps], { windowsHide: true }, (e, out) => done(e ? '' : out));
    } else if (process.platform === 'darwin') {
      const as = `set fs to choose folder with prompt "AnimADS - escolha as pastas dos ADs" with multiple selections allowed
set out to ""
repeat with f in fs
set out to out & POSIX path of f & linefeed
end repeat
return out`;
      execFile('osascript', ['-e', as], (e, out) => done(e ? '' : out));
    } else {
      execFile('zenity', ['--file-selection', '--directory', '--multiple', '--separator=\n', '--title=AnimADS'], (e, out) => done(e ? '' : out));
    }
  });
}
function openPath(p) {
  if (process.platform === 'win32') spawn('explorer', [p], { detached: true });
  else if (process.platform === 'darwin') spawn('open', [p], { detached: true });
  else spawn('xdg-open', [p], { detached: true, stdio: 'ignore' });
}

// ---------------- HTTP ----------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.mp4': 'video/mp4', '.svg': 'image/svg+xml', '.wav': 'audio/wav' };

function sendFile(req, res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('não encontrado'); }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.range;
    if (range && type === 'video/mp4') {
      const [a, b] = range.replace('bytes=', '').split('-');
      const start = +a, end = b ? +b : st.size - 1;
      res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'no-cache', 'Accept-Ranges': 'bytes' });
    fs.createReadStream(file).pipe(res);
  });
}
const within = (base, p) => { const r = path.resolve(base, '.' + p); return r.startsWith(path.resolve(base)) ? r : null; };
function body(req, limit = 2e6) {
  return new Promise((res, rej) => { let d = ''; req.on('data', c => { d += c; if (d.length > limit) req.destroy(); }); req.on('end', () => { try { res(d ? JSON.parse(d) : {}); } catch (e) { rej(e); } }); });
}
const json = (res, obj, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = decodeURIComponent(u.pathname);
  try {
    if (req.method === 'GET') {
      if (p === '/') return sendFile(req, res, path.join(ROOT, 'public', 'index.html'));
      if (p === '/player/gsap.min.js') return sendFile(req, res, require.resolve('gsap/dist/gsap.min.js'));
      if (p.startsWith('/player/')) return sendFile(req, res, within(path.join(ROOT, 'player'), p.slice(7)));
      if (p.startsWith('/trabalhos/')) { const f = within(JOBS_DIR, p.slice(10)); return f ? sendFile(req, res, f) : (res.writeHead(403), res.end()); }
      if (p === '/api/estado') return json(res, { versao: VERSION, claude: claudeStatus, jobs: jobs.map(pub), plataforma: process.platform, padroes: defaults });
      if (p === '/api/eventos') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.write('retry: 2000\n\n'); clients.add(res); req.on('close', () => clients.delete(res)); return;
      }
      const f = within(path.join(ROOT, 'public'), p);
      return f ? sendFile(req, res, f) : (res.writeHead(404), res.end());
    }
    if (req.method === 'POST') {
      if (p === '/api/escolher-pastas') return json(res, { pastas: await pickFolders() });
      if (p === '/api/adicionar') {
        const b = await body(req);
        const created = addJobs(b.pastas || [], b.opcoes || {}, !!b.upload);
        if (!created.length) return json(res, { erro: 'Nenhuma pasta com PNGs encontrada. Escolha a pasta do AD (ou uma pasta com várias pastas de ADs dentro).' }, 400);
        return json(res, { criados: created.length });
      }
      if (p === '/api/upload') {
        const lote = (u.searchParams.get('lote') || 'x').replace(/[^\w-]/g, '');
        const pasta = safe(u.searchParams.get('pasta') || 'AD'), arq = safe(path.basename(u.searchParams.get('arquivo') || 'f.png'));
        if (!/\.png$/i.test(arq)) return json(res, { ok: true, ignorado: true });
        const dir = path.join(JOBS_DIR, '_uploads', lote, pasta); fs.mkdirSync(dir, { recursive: true });
        const ws = fs.createWriteStream(path.join(dir, arq)); req.pipe(ws);
        ws.on('finish', () => json(res, { ok: true, pasta: dir })); return;
      }
      const m = p.match(/^\/api\/jobs\/([\w]+)\/(gerar|ajustar|remover|abrir)$/);
      if (m) {
        const j = jobs.find(x => x.id === m[1]); if (!j) return json(res, { erro: 'não encontrado' }, 404);
        const b = await body(req);
        if (m[2] === 'gerar') { if (b.opcoes) j.opcoes = { ...j.opcoes, ...b.opcoes }; enqueue(j, fullRun); return json(res, { ok: true }); }
        if (m[2] === 'ajustar') {
          if (!b.pedido) return json(res, { erro: 'Escreva o ajuste.' }, 400);
          if (b.opcoes) j.opcoes = { ...j.opcoes, ...b.opcoes };
          enqueue(j, jj => adjustRun(jj, String(b.pedido).slice(0, 500))); return json(res, { ok: true });
        }
        if (m[2] === 'abrir') { openPath(j.pastaSaida || j.origem); return json(res, { ok: true }); }
        if (m[2] === 'remover') {
          jobs = jobs.filter(x => x !== j); save(); emit('removido', { id: j.id });
          fs.rmSync(path.join(JOBS_DIR, j.id), { recursive: true, force: true }); return json(res, { ok: true });
        }
      }
      if (p === '/api/claude/verificar') return json(res, await checkClaude());
    }
    res.writeHead(404); res.end();
  } catch (e) { console.error(e); json(res, { erro: String(e.message || e) }, 500); }
});

function listen(p0) {
  return new Promise((resolve) => {
    const tryPort = p => { server.once('error', () => tryPort(p + 1)); server.listen(p, '127.0.0.1', () => resolve(p)); };
    tryPort(p0);
  });
}

(async () => {
  port = await listen(+process.env.PORT || 4173);
  const url = `http://127.0.0.1:${port}/`;
  console.log(`\n  AnimADS ${VERSION} rodando em ${url}\n  (deixe esta janela aberta enquanto usa; feche para encerrar)\n`);
  checkClaude().then(s => { console.log('  Claude:', s.ok ? s.versao : 'não encontrado — usando roteiro automático'); emit('claude', s); });
  if (process.argv.includes('--abrir')) {
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' });
    else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' });
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).on('error', () => {});
  }
})();
