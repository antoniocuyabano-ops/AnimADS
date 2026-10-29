// AnimADS - roteiro da animação
// 1) tenta o Claude da máquina (claude -p) olhando a arte anotada
// 2) se não houver Claude, usa um roteiro automático (heurística)
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const ENTRADAS = ['pop', 'carimbo', 'cair', 'subir', 'deslizar-esquerda', 'deslizar-direita', 'deslizar-cima', 'deslizar-baixo', 'girar', 'fade', 'nenhum'];
const LOOPS = ['flutuar', 'balancar', 'pulsar', 'nenhum'];
const DESTAQUES = ['tremer', 'pulsar', 'brilho'];
const PAPEIS = ['titulo', 'selo', 'marca', 'beneficio', 'oferta', 'cta', 'decoracao', 'legal', 'texto', 'imagem'];

// ---------- roteiro automático ----------
function heuristic(an, opts) {
  const F = an.frame, L = an.layers, DUR = opts.duracao || 10, k = DUR / 10;
  const plan = { duracao: DUR, estilo: opts.estilo || 'energetico', fundo: { efeito: 'zoom-lento' }, camadas: [], fonte: 'automatico' };
  const touches = l => l.x <= 2 || l.y <= 2 || l.x + l.w >= F.w - 2 || l.y + l.h >= F.h - 2;
  const cfg = {};
  const set = (l, papel, efeito, inicio, duracao, loop = 'nenhum', destaques = []) =>
    (cfg[l.id] = { id: l.id, papel, entrada: { efeito, inicio: +(inicio * k).toFixed(2), duracao: +(duracao * k).toFixed(2) }, loop, destaques: destaques.map(d => ({ ...d, em: +(d.em * k).toFixed(2) })) });

  const deco = L.filter(l => touches(l) && !l.group);
  deco.forEach((l, i) => {
    const cx = l.x + l.w / 2, cy = l.y + l.h / 2;
    const dists = { 'deslizar-esquerda': cx, 'deslizar-direita': F.w - cx, 'deslizar-cima': cy, 'deslizar-baixo': F.h - cy };
    const dir = Object.entries(dists).sort((a, b) => a[1] - b[1])[0][0];
    const small = l.w < F.w * 0.4;
    set(l, 'decoracao', dir, 0.1 + i * 0.12, 0.75, small ? 'flutuar' : 'nenhum');
  });
  const legal = L.filter(l => !cfg[l.id] && l.h < F.h * 0.02);
  let rest = L.filter(l => !cfg[l.id] && !legal.includes(l)).sort((a, b) => a.y - b.y || a.x - b.x);
  const solo = rest.filter(l => !l.group);
  const title = solo.filter(l => l.y + l.h / 2 < F.h * 0.45).sort((a, b) => b.w * b.h - a.w * a.h)[0];
  const offer = solo.filter(l => l !== title && l.y + l.h / 2 > F.h * 0.55).sort((a, b) => b.w * b.h - a.w * a.h)[0];
  if (title) set(title, 'titulo', 'pop', 0.35, 0.9, 'flutuar');
  rest = rest.filter(l => l !== title && l !== offer);
  // selos acima do título caem
  const above = title ? rest.filter(l => l.y + l.h <= title.y + title.h * 0.35 && l.w * l.h < title.w * title.h * 0.5) : [];
  above.forEach((l, i) => set(l, 'selo', 'cair', 0.95 + i * 0.15, 0.8, 'nenhum', [{ efeito: 'tremer', em: 1.85 }, { efeito: 'pulsar', em: 5.9 }]));
  rest = rest.filter(l => !above.includes(l));
  // demais em cascata, linhas de uma mesma lista juntas
  let t = 1.3, lastRow = null;
  for (const l of rest) {
    const row = l.group ? l.group + ':' + Math.round(l.y / 20) : l.id;
    if (lastRow !== null && row !== lastRow) t += 0.42;
    const icon = l.kind === 'icone' || (l.w < F.w * 0.18 && l.h < F.w * 0.18);
    const off = l.group && l.kind === 'texto' ? 0.1 : 0;
    set(l, l.group ? 'beneficio' : 'texto', icon ? 'pop' : 'subir', t + off, icon ? 0.5 : 0.55);
    lastRow = row;
  }
  const tOffer = Math.min(Math.max(t + 0.7, 3.6), 5.0);
  if (offer) set(offer, 'oferta', 'pop', tOffer, 0.75, 'nenhum', [
    { efeito: 'tremer', em: tOffer + 0.75 }, { efeito: 'brilho', em: tOffer + 1.3 }, { efeito: 'pulsar', em: tOffer + 2.3 },
    { efeito: 'brilho', em: 7.7 }, { efeito: 'pulsar', em: 8.6 }]);
  legal.forEach(l => set(l, 'legal', 'fade', tOffer + 0.9, 0.5));
  plan.camadas = L.map(l => cfg[l.id] || { id: l.id, papel: 'texto', entrada: { efeito: 'fade', inicio: 1.5 * k, duracao: 0.5 }, loop: 'nenhum', destaques: [] });
  return plan;
}

// ---------- validação ----------
function sanitize(plan, an, opts) {
  const DUR = opts.duracao || plan.duracao || 10;
  const ids = new Set(an.layers.map(l => l.id));
  const out = { duracao: DUR, estilo: opts.estilo || plan.estilo || 'energetico',
    fundo: { efeito: ['zoom-lento', 'respirar', 'nenhum'].includes(plan.fundo && plan.fundo.efeito) ? plan.fundo.efeito : 'zoom-lento' },
    camadas: [], fonte: plan.fonte || 'claude', resumo: plan.resumo || '' };
  const seen = new Set();
  for (const c of plan.camadas || []) {
    if (!ids.has(c.id) || seen.has(c.id)) continue; seen.add(c.id);
    const e = c.entrada || {};
    const ef = ENTRADAS.includes(e.efeito) ? e.efeito : 'pop';
    const ini = Math.min(Math.max(0, +e.inicio || 0), DUR * 0.7);
    out.camadas.push({ id: c.id, papel: PAPEIS.includes(c.papel) ? c.papel : 'texto',
      entrada: { efeito: ef, inicio: +ini.toFixed(2), duracao: +Math.min(Math.max(0.2, +e.duracao || 0.7), 2).toFixed(2) },
      loop: LOOPS.includes(c.loop) ? c.loop : 'nenhum',
      destaques: (c.destaques || []).filter(d => DESTAQUES.includes(d.efeito) && +d.em >= 0 && +d.em < DUR - 0.3)
        .map(d => ({ efeito: d.efeito, em: +(+d.em).toFixed(2) })) });
  }
  for (const l of an.layers) if (!seen.has(l.id))
    out.camadas.push({ id: l.id, papel: 'texto', entrada: { efeito: 'fade', inicio: 1.5, duracao: 0.5 }, loop: 'nenhum', destaques: [] });
  return out;
}

// ---------- Claude ----------
function findClaude() {
  return process.env.ANIMADS_CLAUDE || 'claude';
}

function runClaude(cwd, prompt, timeoutMs = 240000) {
  return new Promise((resolve, reject) => {
    const args = ['-p', prompt, '--output-format', 'json', '--allowedTools', 'Read', '--max-turns', '6'];
    const win = process.platform === 'win32';
    const p = spawn(findClaude(), win ? args.map(a => /\s/.test(a) ? `"${a}"` : a) : args,
      { cwd, shell: win, env: process.env });
    let out = '', err = '';
    const timer = setTimeout(() => { p.kill(); reject(new Error('O Claude demorou demais para responder.')); }, timeoutMs);
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
    p.on('error', e => { clearTimeout(timer); reject(e); });
    p.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error((err || out || `claude saiu com código ${code}`).slice(0, 400)));
      try {
        const j = JSON.parse(out);
        if (j.is_error) return reject(new Error(String(j.result || 'erro do Claude').slice(0, 400)));
        resolve(String(j.result || ''));
      } catch { resolve(out); }
    });
  });
}

function extractJson(text) {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = m ? m[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  return JSON.parse(body);
}

function buildPrompt(an, opts, feedback, previous) {
  const F = an.frame;
  const rows = an.layers.map((l, i) =>
    `| ${i + 1} | ${l.id} | ${l.name.replace(/\|/g, '/')} | ${l.x},${l.y} | ${l.w}x${l.h} | ${l.group ? 'peça de ' + l.group + ' (' + l.kind + ')' : ''} |`).join('\n');
  return `# Roteiro de animação de anúncio (AnimADS)

Você é motion designer de anúncios de performance (Meta/TikTok). Crie o roteiro de animação deste AD.

## Arquivos nesta pasta (leia com a ferramenta Read)
- \`ref_anotada.png\`: a arte final com cada camada numerada (caixas coloridas). Os números são da tabela abaixo.
- \`referencia.png\`: a arte final limpa.

## Formato
Frame ${F.w}x${F.h}px. Duração: ${opts.duracao || 10}s. Estilo pedido: **${opts.estilo || 'energetico'}**.
O vídeo deve funcionar sem som. Leitura: o que mais vende (oferta/desconto/preço) precisa estar na tela e estável por pelo menos 40% do vídeo e o frame final é a arte completa.

## Camadas (de baixo para cima)
| nº | id | nome no Figma | x,y | tamanho | obs |
|---|---|---|---|---|---|
${rows}

O fundo (img/fundo.png) já é a arte sem essas camadas; ele recebe só um efeito global.

## Vocabulário permitido
- papel: ${PAPEIS.join(', ')}
- entrada.efeito: ${ENTRADAS.join(', ')}  (deslizar-X = vem do lado X; "nenhum" = já começa na tela)
- loop (depois da entrada): ${LOOPS.join(', ')}
- destaques (momentos pontuais): ${DESTAQUES.join(', ')}  ("brilho" = reflexo de luz passando, ótimo em blocos de oferta e botões)
- fundo.efeito: zoom-lento, respirar, nenhum
O som é gerado automaticamente a partir desses efeitos (pop, impacto no título e na oferta, whoosh nos deslizes, quiques no "cair", brilho sonoro etc.), então capriche na escolha dos efeitos e nos tempos.

## Boas práticas
- 0–2s gancho (título/marca grandes entram com impacto, faixas e selos nas bordas deslizam do lado mais próximo).
- Depois, argumentos em cascata (0.3–0.5s entre itens; ícone e texto da mesma linha juntos, texto 0.1s depois).
- Oferta/preço com entrada forte ("pop" ou "carimbo") até ~45% do vídeo, depois destaques (tremer logo após entrar, brilho, pulsar) espaçados.
- Textos legais pequenos: "fade" discreto.
- Elementos pequenos e soltos podem "flutuar"; não use loop em textos longos.
- Estilo suave/premium: menos efeitos, entradas "fade"/"subir", sem "tremer".
${previous ? `\n## Roteiro atual\n\`\`\`json\n${JSON.stringify(previous)}\n\`\`\`\n` : ''}${feedback ? `\n## Pedido de ajuste do designer\n"${feedback}"\nAplique o pedido ao roteiro atual, mudando só o necessário.\n` : ''}
## Resposta
Responda APENAS com um bloco JSON neste formato (todas as camadas, use os ids exatos):
\`\`\`json
{"resumo":"uma frase sobre a ideia da animação","fundo":{"efeito":"zoom-lento"},
 "camadas":[{"id":"...","papel":"titulo","entrada":{"efeito":"pop","inicio":0.35,"duracao":0.9},"loop":"flutuar",
   "destaques":[{"efeito":"pulsar","em":6.2}]}]}
\`\`\`
`;
}

async function annotate(an, jobDir, browser) {
  const F = an.frame;
  const colors = ['#ff2d55', '#00c2ff', '#7cff00', '#ff9500', '#bf5af2', '#ffd60a', '#30d158', '#ff375f'];
  const boxes = an.layers.map((l, i) => `<div class="b" style="left:${l.x}px;top:${l.y}px;width:${l.w}px;height:${l.h}px;border-color:${colors[i % 8]}"><span style="background:${colors[i % 8]}">${i + 1}</span></div>`).join('');
  const html = `<html><body style="margin:0"><div id="s" style="position:relative;width:${F.w}px;height:${F.h}px;overflow:hidden">
  <img src="referencia.png" style="position:absolute;left:0;top:0;width:${F.w}px;height:${F.h}px;filter:saturate(.7) brightness(.9)">${boxes}</div>
  <style>.b{position:absolute;border:5px solid;box-sizing:border-box}.b span{position:absolute;left:-5px;top:-5px;font:bold 38px Arial;color:#000;padding:2px 12px;border-radius:0 0 10px 0}</style></body></html>`;
  fs.writeFileSync(path.join(jobDir, 'ref_anotada.html'), html);
  const pg = await browser.newPage({ viewport: { width: F.w, height: F.h } });
  await pg.goto(pathToFileURL(path.join(jobDir, 'ref_anotada.html')).href);
  await pg.waitForLoadState('load');
  const buf = await pg.locator('#s').screenshot();
  await pg.close();
  const sharp = require('sharp');
  await sharp(buf).resize({ width: Math.min(F.w, 900) }).png().toFile(path.join(jobDir, 'ref_anotada.png'));
}

async function makePlan(an, jobDir, opts, { browser, log = () => {}, feedback, previous } = {}) {
  const useClaude = opts.claude !== false;
  if (useClaude) {
    try {
      if (browser && !fs.existsSync(path.join(jobDir, 'ref_anotada.png'))) await annotate(an, jobDir, browser);
      fs.writeFileSync(path.join(jobDir, 'PROMPT.md'), buildPrompt(an, opts, feedback, previous));
      log(feedback ? 'Claude aplicando o ajuste…' : 'Claude criando o roteiro…');
      const txt = await runClaude(jobDir, 'Leia o arquivo PROMPT.md nesta pasta e siga as instrucoes. Responda apenas com o JSON pedido.');
      const plan = sanitize({ ...extractJson(txt), fonte: 'claude' }, an, opts);
      fs.writeFileSync(path.join(jobDir, 'plano.json'), JSON.stringify(plan, null, 1));
      log('Roteiro do Claude: ' + (plan.resumo || 'ok'));
      return plan;
    } catch (e) {
      log('Claude indisponível (' + String(e.message || e).split('\n')[0].slice(0, 140) + '). Usando roteiro automático.');
    }
  }
  let plan = heuristic(an, opts);
  if (feedback && previous) plan = applyFeedbackLocally(previous, feedback, an, opts);
  plan = sanitize(plan, an, opts);
  plan.fonte = 'automatico';
  fs.writeFileSync(path.join(jobDir, 'plano.json'), JSON.stringify(plan, null, 1));
  return plan;
}

// ajustes simples sem Claude
function applyFeedbackLocally(prev, fb, an, opts) {
  const p = JSON.parse(JSON.stringify(prev)); const f = fb.toLowerCase();
  let s = 1;
  if (/r[aá]pid|acelera|curt/.test(f)) s = 0.8;
  if (/devagar|lent|calm/.test(f)) s = 1.25;
  if (s !== 1) for (const c of p.camadas) {
    c.entrada.inicio = +(c.entrada.inicio * s).toFixed(2); c.entrada.duracao = +(c.entrada.duracao * s).toFixed(2);
    c.destaques.forEach(d => d.em = +(d.em * s).toFixed(2));
  }
  if (/sem tremer|tira.*trem/.test(f)) p.camadas.forEach(c => c.destaques = c.destaques.filter(d => d.efeito !== 'tremer'));
  if (/sem brilho|tira.*brilho/.test(f)) p.camadas.forEach(c => c.destaques = c.destaques.filter(d => d.efeito !== 'brilho'));
  p.fonte = 'automatico';
  return p;
}

module.exports = { makePlan, heuristic, sanitize, annotate };
