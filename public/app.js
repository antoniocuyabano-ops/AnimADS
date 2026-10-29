// AnimADS - interface
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const state = { jobs: new Map(), claude: null, open: null, tab: 'video', plans: {} };
const STEPS = ['analise', 'roteiro', 'video', 'som'];
const LABEL = { 'na-fila': 'Na fila', analise: 'Analisando camadas', roteiro: 'Criando roteiro', video: 'Renderizando vídeo', som: 'Mixando som', pronto: 'Pronto', erro: 'Erro' };
const EF = { pop: 'pop', carimbo: 'carimbo', cair: 'cai', subir: 'sobe', fade: 'fade', girar: 'gira', nenhum: '—',
  'deslizar-esquerda': '← desliza', 'deslizar-direita': 'desliza →', 'deslizar-cima': '↓ desce', 'deslizar-baixo': '↑ sobe' };
const PAPEL = { titulo: 'Título', selo: 'Selo', marca: 'Marca', beneficio: 'Benefício', oferta: 'Oferta', cta: 'CTA', decoracao: 'Decoração', legal: 'Legal', texto: 'Texto', imagem: 'Imagem' };

function toast(msg, err) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast on' + (err ? ' err' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.className = 'toast', 4200);
}
const api = async (url, body) => {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.erro || 'Falha na operação');
  return j;
};
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- opções ----------
const opts = { estilo: 'energetico', duracao: 10 };
try { Object.assign(opts, JSON.parse(localStorage.getItem('animads.opts') || '{}')); } catch {}
function readOpts() {
  const o = { estilo: opts.estilo, duracao: +opts.duracao, musica: $('#optMusica').checked, efeitos: $('#optEfeitos').checked,
    muda: $('#optMuda').checked, claude: $('#optClaude').checked };
  try { localStorage.setItem('animads.opts', JSON.stringify(o)); } catch {}
  return o;
}
function paintOpts() {
  $$('#styles .sty').forEach(b => b.classList.toggle('on', b.dataset.v === opts.estilo));
  $$('#dur button').forEach(b => b.classList.toggle('on', +b.dataset.v === +opts.duracao));
  for (const k of ['musica', 'efeitos', 'muda', 'claude']) if (k in opts) $('#opt' + k[0].toUpperCase() + k.slice(1)).checked = !!opts[k];
}
$('#styles').onclick = e => { const b = e.target.closest('.sty'); if (b) { opts.estilo = b.dataset.v; paintOpts(); readOpts(); } };
$('#dur').onclick = e => { const b = e.target.closest('button'); if (b) { opts.duracao = +b.dataset.v; paintOpts(); readOpts(); } };
$$('.opts input').forEach(i => i.onchange = readOpts);
paintOpts();

// ---------- Claude ----------
function paintClaude() {
  const c = state.claude, p = $('#claudePill');
  p.className = 'pill ' + (c == null || c.ok == null ? '' : c.ok ? 'ok' : 'warn');
  $('#claudeTxt').textContent = c == null || c.ok == null ? 'Verificando Claude…' : c.ok ? 'Claude conectado' : 'Sem Claude: roteiro automático';
  p.title = c && c.ok ? (c.versao || '') : 'Instale e faça login no Claude Code para roteiros criados pelo Claude. Clique para verificar de novo.';
}
$('#claudePill').onclick = async () => { state.claude = { ok: null }; paintClaude(); state.claude = await api('/api/claude/verificar'); paintClaude(); };

// ---------- adicionar pastas ----------
$('#pickBtn').onclick = async () => {
  const btn = $('#pickBtn'); btn.disabled = true; $('#dropHint').textContent = 'Escolha a pasta na janela que abriu…';
  try {
    const { pastas } = await api('/api/escolher-pastas');
    if (!pastas.length) { $('#dropHint').textContent = ''; return; }
    const r = await api('/api/adicionar', { pastas, opcoes: readOpts() });
    toast(`${r.criados} AD${r.criados > 1 ? 's' : ''} na fila de produção`);
    $('#dropHint').textContent = '';
  } catch (e) { toast(e.message, true); $('#dropHint').textContent = ''; }
  finally { btn.disabled = false; }
};

const drop = $('#drop');
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); if (ev === 'dragleave' && drop.contains(e.relatedTarget)) return; drop.classList.remove('over'); }));
drop.addEventListener('drop', async e => {
  const items = [...e.dataTransfer.items].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  if (!items.length) return;
  try {
    const groups = await collect(items);
    if (!groups.length) return toast('Não encontrei PNGs. Solte a pasta do AD (ou uma pasta com várias pastas de ADs).', true);
    const lote = Date.now().toString(36);
    const total = groups.reduce((n, g) => n + g.files.length, 0); let sent = 0;
    const pastas = [];
    for (const g of groups) {
      let dir = null;
      for (const f of g.files) {
        const r = await fetch(`/api/upload?lote=${lote}&pasta=${encodeURIComponent(g.name)}&arquivo=${encodeURIComponent(f.name)}`, { method: 'POST', body: f });
        const j = await r.json(); if (j.pasta) dir = j.pasta;
        $('#dropHint').textContent = `Copiando arquivos… ${++sent}/${total}`;
      }
      if (dir) pastas.push(dir);
    }
    $('#dropHint').textContent = '';
    const r = await api('/api/adicionar', { pastas, opcoes: readOpts(), upload: true });
    toast(`${r.criados} AD${r.criados > 1 ? 's' : ''} na fila de produção`);
  } catch (err) { toast(err.message, true); $('#dropHint').textContent = ''; }
});
const fileOf = entry => new Promise((res, rej) => entry.file(res, rej));
async function readAll(dir) {
  const reader = dir.createReader(); let all = [];
  for (;;) { const b = await new Promise((res, rej) => reader.readEntries(res, rej)); if (!b.length) break; all = all.concat(b); }
  return all;
}
async function collect(entries) {
  const groups = [], loose = [];
  const isPng = e => e.isFile && /\.png$/i.test(e.name) && !/^AD_/i.test(e.name);
  async function visit(dir, depth) {
    const kids = await readAll(dir);
    const pngs = kids.filter(isPng);
    if (pngs.length) groups.push({ name: dir.name, files: await Promise.all(pngs.map(fileOf)) });
    else if (depth < 2) for (const k of kids) if (k.isDirectory && k.name !== 'AnimADS') await visit(k, depth + 1);
  }
  for (const e of entries) { if (e.isDirectory) await visit(e, 0); else if (isPng(e)) loose.push(await fileOf(e)); }
  if (loose.length) groups.push({ name: 'AD avulso', files: loose });
  return groups;
}

// ---------- lista ----------
function stepIndex(s) { return s === 'pronto' ? 4 : STEPS.indexOf(s); }
function card(j) {
  let el = document.getElementById('job-' + j.id);
  if (!el) {
    el = document.createElement('article'); el.className = 'job'; el.id = 'job-' + j.id;
    el.onclick = () => openStudio(j.id);
    $('#grid').prepend(el);
  }
  const si = stepIndex(j.status), busy = !['pronto', 'erro'].includes(j.status);
  const img = j.capa || j.referencia;
  const fmt = j.formato ? 'f' + j.formato : '';
  el.classList.toggle('erro', j.status === 'erro');
  el.innerHTML = `
    <div class="thumb ${fmt}">
      ${img ? `<img src="${img}" alt="">` : ''}
      <div class="shade"></div>
      ${j.formato ? `<span class="badge">${j.formato.replace('x', ':')}</span>` : ''}
      ${busy ? `<div class="busy"><div class="spinner"></div><b>${LABEL[j.status] || j.status}${j.status === 'video' ? ' ' + (j.progresso || 0) + '%' : ''}</b></div>` : ''}
      ${j.status === 'pronto' ? '<div class="play"><i></i></div>' : ''}
    </div>
    <div class="job-body">
      <div class="job-name" title="${esc(j.origem)}">${esc(j.nome)}</div>
      <div class="steps4">${STEPS.map((s, i) => `<div class="${i < si ? 'done' : i === si ? 'cur' + (s === 'video' ? '' : ' ind') : ''}" ${i === si && s === 'video' ? `style="--p:${j.progresso || 0}%"` : ''}></div>`).join('')}</div>
      <div class="job-status">
        <span class="${j.status === 'pronto' ? 'ok' : j.status === 'erro' ? 'err' : ''}">${LABEL[j.status] || j.status}${j.versao ? ' · v' + j.versao : ''}</span>
        <span>${j.encaixe != null ? 'encaixe ' + j.encaixe + '%' : ''}</span>
      </div>
      <div class="tags">
        ${j.roteiro ? `<span class="tag ${j.roteiro.fonte === 'claude' ? 'claude' : ''}">${j.roteiro.fonte === 'claude' ? '✦ roteiro Claude' : 'roteiro automático'}</span>` : ''}
        ${j.opcoes ? `<span class="tag">${{ energetico: 'Energético', suave: 'Suave', premium: 'Premium' }[j.opcoes.estilo] || ''}</span><span class="tag">${j.opcoes.duracao}s</span>` : ''}
      </div>
    </div>`;
}
function paintCounts() {
  const all = [...state.jobs.values()];
  const ready = all.filter(j => j.status === 'pronto').length, busy = all.filter(j => !['pronto', 'erro'].includes(j.status)).length;
  $('#counts').innerHTML = all.length ? `${busy ? `<span>${busy} em produção</span>` : ''}<span>${ready} pronto${ready === 1 ? '' : 's'}</span>` : '';
  $('#empty').style.display = all.length ? 'none' : '';
}

// ---------- estúdio ----------
async function openStudio(id) {
  state.open = id; const j = state.jobs.get(id);
  $('#studio').hidden = false;
  state.tab = j.status === 'pronto' ? 'video' : 'live';
  $('#adjText').value = ''; $('#adjStyle').value = '';
  delete state.plans[id];
  await paintStudio(true);
}
function closeModals() {
  $$('.modal').forEach(m => m.hidden = true); state.open = null; $('#stageBox').innerHTML = '';
}
$$('[data-close]').forEach(b => b.onclick = closeModals);
$$('.modal').forEach(m => m.addEventListener('mousedown', e => { if (e.target === m) closeModals(); }));
addEventListener('keydown', e => { if (e.key === 'Escape') closeModals(); });
$('#stageTabs').onclick = e => { const b = e.target.closest('button'); if (b) { state.tab = b.dataset.t; paintStage(true); } };

async function loadPlan(j) {
  if (state.plans[j.id]) return state.plans[j.id];
  try {
    const [pl, an] = await Promise.all([fetch(`/trabalhos/${j.id}/plano.json?v=${Date.now()}`).then(r => r.ok ? r.json() : null),
      fetch(`/trabalhos/${j.id}/analise.json`).then(r => r.ok ? r.json() : null)]);
    if (pl && an) state.plans[j.id] = { pl, an };
  } catch {}
  return state.plans[j.id];
}

let lastStageKey = '';
function paintStage(force) {
  const j = state.jobs.get(state.open); if (!j) return;
  $$('#stageTabs button').forEach(b => b.classList.toggle('on', b.dataset.t === state.tab));
  const key = state.tab + '|' + j.status + '|' + (j.videoUrl || '') + '|' + (j.roteiro && j.roteiro.resumo);
  if (!force && key === lastStageKey) return; lastStageKey = key;
  const box = $('#stageBox');
  const waiting = txt => `<div class="wait"><div class="spinner"></div>${txt}</div>`;
  if (state.tab === 'video') {
    box.innerHTML = j.status === 'pronto' && j.videoUrl ? `<video src="${j.videoUrl}" controls autoplay loop playsinline></video>`
      : j.status === 'erro' ? `<div class="wait">${esc(j.erro || 'Erro')}</div>` : waiting(LABEL[j.status] + '…');
  } else if (state.tab === 'live') {
    box.innerHTML = j.roteiro ? `<iframe src="/trabalhos/${j.id}/index.html?preview&v=${Date.now()}"></iframe>` : waiting('O roteiro ainda está sendo criado…');
  } else {
    box.innerHTML = j.referencia ? `<img src="${j.referencia}" alt="">` : waiting('Analisando…');
  }
}

async function paintStudio(force) {
  const j = state.jobs.get(state.open); if (!j) return;
  $('#sName').textContent = j.nome;
  $('#sMeta').innerHTML = [
    `<span class="tag">${LABEL[j.status]}${j.status === 'video' ? ' ' + (j.progresso || 0) + '%' : ''}</span>`,
    j.formato ? `<span class="tag">${j.formato.replace('x', ':')} · ${j.frame.w}×${j.frame.h}</span>` : '',
    j.encaixe != null ? `<span class="tag">encaixe ${j.encaixe}%</span>` : '',
    j.camadas ? `<span class="tag">${j.camadas} peças animadas</span>` : '',
    j.versao ? `<span class="tag">v${j.versao}</span>` : ''].join('');
  $('#sRoteiro').innerHTML = j.roteiro
    ? `<b>${j.roteiro.fonte === 'claude' ? '✦ Roteiro criado pelo Claude' : 'Roteiro automático'}</b>${j.roteiro.resumo ? '<br>' + esc(j.roteiro.resumo) : ''}`
    : (j.status === 'erro' ? `<b style="color:var(--err)">Erro</b><br>${esc(j.erro)}` : 'O roteiro aparece aqui assim que ficar pronto.');
  paintStage(force);
  const data = j.roteiro ? await loadPlan(j) : null;
  $('#sTimeline').style.display = data ? '' : 'none';
  if (data) $('#sTimeline').innerHTML = timeline(data.pl, data.an);
  $('#sFiles').innerHTML = (j.arquivos || []).map(f => `
    <div class="file"><div class="fi">MP4</div><div class="fn"><b>${esc(f.caminho.split(/[\\/]/).pop())}</b><small>${f.tipo}</small></div>
      <a href="${f.url}" download="${esc(f.caminho.split(/[\\/]/).pop())}">Baixar</a></div>`).join('') +
    `<div class="row-actions">
      ${j.status === 'pronto' ? '<button class="ghost" id="openDir">Abrir pasta</button>' : ''}
      <button class="ghost" id="redo">Gerar do zero</button>
      <button class="ghost danger" id="rm">Remover da lista</button></div>`;
  const od = $('#openDir'); if (od) od.onclick = () => api(`/api/jobs/${j.id}/abrir`).catch(e => toast(e.message, true));
  $('#redo').onclick = async () => { await api(`/api/jobs/${j.id}/gerar`, { opcoes: $('#adjStyle').value ? { estilo: $('#adjStyle').value } : null }); delete state.plans[j.id]; toast('Gerando de novo…'); };
  $('#rm').onclick = async () => { if (!confirm('Remover este AD da lista? Os vídeos já salvos na pasta continuam lá.')) return; await api(`/api/jobs/${j.id}/remover`); closeModals(); };
  $('#sLog').textContent = (j.log || []).join('\n');
  $('#adjBtn').disabled = !['pronto', 'erro'].includes(j.status);
}

function timeline(pl, an) {
  const D = pl.duracao, by = Object.fromEntries(an.layers.map(l => [l.id, l]));
  const rows = pl.camadas.slice().sort((a, b) => a.entrada.inicio - b.entrada.inicio).map(c => {
    const l = by[c.id] || { name: c.id };
    const left = c.entrada.inicio / D * 100, w = Math.max(1.2, c.entrada.duracao / D * 100);
    const dots = (c.destaques || []).map(d => `<i class="tl-dot ${d.efeito}" style="left:${d.em / D * 100}%" title="${d.efeito} em ${d.em}s"></i>`).join('');
    return `<div class="tl-row"><div class="tl-name" title="${esc(l.name)}">${PAPEL[c.papel] || c.papel} · ${esc(l.name)}</div>
      <div class="tl-track"><div class="tl-bar" style="left:${left}%;width:${w}%"><span>${EF[c.entrada.efeito] || c.entrada.efeito}${c.loop && c.loop !== 'nenhum' ? ' · ' + c.loop : ''}</span></div>${dots}</div></div>`;
  }).join('');
  const ticks = Array.from({ length: D / 2 + 1 }, (_, i) => `<span>${i * 2}s</span>`).join('');
  return `<div class="tl-h"><span>Linha do tempo</span><span>${D}s · ${({ energetico: 'Energético', suave: 'Suave', premium: 'Premium' })[pl.estilo] || ''}</span></div>${rows}
    <div class="tl-axis"><div></div><div>${ticks}</div></div>
    <div class="tl-legend"><span><i style="background:#ff4d5e"></i>tremer</span><span><i style="background:#ffd84d"></i>brilho</span><span><i style="background:#5ce1ff"></i>pulsar</span></div>`;
}

$('#chips').onclick = e => { const b = e.target.closest('button'); if (!b) return; const t = $('#adjText'); t.value = (t.value ? t.value.trim() + '. ' : '') + b.textContent; t.focus(); };
$('#adjBtn').onclick = async () => {
  const j = state.jobs.get(state.open); const pedido = $('#adjText').value.trim(), est = $('#adjStyle').value;
  if (!pedido && !est) return toast('Escreva o ajuste ou escolha um estilo.', true);
  try {
    await api(`/api/jobs/${j.id}/ajustar`, { pedido: pedido || `Mudar o estilo para ${est}`, opcoes: est ? { estilo: est } : null });
    delete state.plans[j.id]; $('#adjText').value = ''; state.tab = 'live'; toast('Ajuste enviado. Gerando nova versão…');
  } catch (e) { toast(e.message, true); }
};

$('#helpBtn').onclick = () => { $('#help').hidden = false; };

// ---------- dados ao vivo ----------
function upsert(j) {
  const prev = state.jobs.get(j.id);
  state.jobs.set(j.id, j); card(j); paintCounts();
  if (state.open === j.id) {
    if (prev && prev.status !== j.status && j.status === 'pronto') { state.tab = 'video'; delete state.plans[j.id]; toast(`“${j.nome}” está pronto!`); }
    if (prev && prev.roteiro?.resumo !== j.roteiro?.resumo) delete state.plans[j.id];
    paintStudio();
  } else if (prev && prev.status !== 'pronto' && j.status === 'pronto') toast(`“${j.nome}” está pronto!`);
}
(async function init() {
  const s = await fetch('/api/estado').then(r => r.json());
  $('#ver').textContent = 'v' + s.versao;
  state.claude = s.claude; paintClaude();
  s.jobs.slice().reverse().forEach(upsert);
  paintCounts();
  if (!s.jobs.length && !localStorage.getItem('animads.ajuda')) { $('#help').hidden = false; try { localStorage.setItem('animads.ajuda', '1'); } catch {} }
  const es = new EventSource('/api/eventos');
  es.addEventListener('job', e => upsert(JSON.parse(e.data)));
  es.addEventListener('claude', e => { state.claude = JSON.parse(e.data); paintClaude(); });
  es.addEventListener('removido', e => { const { id } = JSON.parse(e.data); state.jobs.delete(id); document.getElementById('job-' + id)?.remove(); paintCounts(); });
})();
