// AnimADS - análise das camadas
// Encontra a posição de cada PNG dentro da arte de referência, define a ordem de
// empilhamento e divide grupos em lista (ex.: benefícios) em peças animáveis.
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const REF_RE = /^(refer[eê]ncia|reference|ref|arte[ _-]?completa|completo|full)([ _-].*)?$/i;

function slug(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'camada';
}

async function raw(fileOrBuf, w, h) {
  let img = sharp(fileOrBuf).ensureAlpha();
  if (w) img = img.resize(Math.max(1, w), Math.max(1, h), { fit: 'fill', kernel: 'lanczos3' });
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

function listPngs(dir) {
  return fs.readdirSync(dir)
    .filter(f => /\.png$/i.test(f) && !f.startsWith('.') && !/^AD_.*\.png$/i.test(f))
    .map(f => path.join(dir, f));
}

async function isOpaque(file) {
  const st = await sharp(file).stats();
  return st.isOpaque;
}

async function findReference(files) {
  const byName = files.find(f => REF_RE.test(path.parse(f).name));
  if (byName) return byName;
  // senão: a maior imagem 100% opaca com proporção de anúncio
  let best = null, bestArea = 0;
  for (const f of files) {
    const m = await sharp(f).metadata();
    const ratio = m.width / m.height;
    if (ratio < 0.5 || ratio > 1.95) continue;
    if (!(await isOpaque(f))) continue;
    const a = m.width * m.height;
    if (a > bestArea) { best = f; bestArea = a; }
  }
  return best;
}

function medianColor(img) {
  const ch = [[], [], []];
  for (let i = 0; i < img.data.length; i += 4 * 7) for (let c = 0; c < 3; c++) ch[c].push(img.data[i + c]);
  return ch.map(a => { a.sort((x, y) => x - y); return a[a.length >> 1]; });
}

function alphaStats(img) {
  let vis = 0, solid = 0;
  for (let i = 3; i < img.data.length; i += 4) { if (img.data[i] > 10) vis++; if (img.data[i] > 200) solid++; }
  return { vis, solid, solidFrac: vis ? solid / vis : 0 };
}

// amostras do template: [dx, dy, r, g, b, a]
function samples(img, max) {
  let maxA = 0;
  for (let i = 3; i < img.data.length; i += 4) maxA = Math.max(maxA, img.data[i]);
  const thr = Math.max(0.02, 0.15 * maxA / 255);
  const all = [];
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    const i = (y * img.w + x) * 4, a = img.data[i + 3] / 255;
    if (a > thr) all.push([x, y, img.data[i], img.data[i + 1], img.data[i + 2], a]);
  }
  let out = all;
  if (all.length > max) {
    const step = all.length / max; out = [];
    for (let k = 0; k < max; k++) out.push(all[Math.floor(k * step)]);
  }
  out.total = out.reduce((t, s) => t + s[5], 0);
  return out;
}

function score(ref, S, ox, oy, bg) {
  let e = 0, wsum = 0;
  for (const [dx, dy, r, g, b, a] of S) {
    const x = ox + dx, y = oy + dy;
    if (x < 0 || y < 0 || x >= ref.w || y >= ref.h) continue;
    const i = (y * ref.w + x) * 4;
    const pr = a * r + (1 - a) * bg[0], pg = a * g + (1 - a) * bg[1], pb = a * b + (1 - a) * bg[2];
    const d = (pr - ref.data[i]) ** 2 + (pg - ref.data[i + 1]) ** 2 + (pb - ref.data[i + 2]) ** 2;
    e += a * d; wsum += a;
  }
  if (!(wsum > 0) || wsum < 0.35 * S.total) return Infinity;
  return (e / wsum) * (1 + 1.5 * (1 - wsum / S.total)) + 40 * (1 - wsum / S.total);
}

function search(ref, S, tw, th, x0, x1, y0, y1, bg, keep = 1) {
  const best = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const s = score(ref, S, x, y, bg);
    if (best.length < keep || s < best[best.length - 1].s) {
      best.push({ x, y, s }); best.sort((a, b) => a.s - b.s); if (best.length > keep) best.pop();
    }
  }
  return best;
}

// localiza uma camada (buffer PNG em resolução do frame) na referência
async function locate(layerFile, lw, lh, refs, F, bg) {
  const { A, C, full } = refs; // níveis: análise (A), grosso (C) e resolução do frame (full)
  const tA = await raw(layerFile, Math.max(1, Math.round(lw * A.s)), Math.max(1, Math.round(lh * A.s)));
  const SA = samples(tA, 5000);
  let cands;
  const tC = await raw(layerFile, Math.max(1, Math.round(lw * C.s)), Math.max(1, Math.round(lh * C.s)));
  if (tC.w < 8 || tC.h < 6) {
    // elementos pequenos (textos legais): busca direta no nível de análise
    const SAs = samples(tA, 400);
    cands = search(A.img, SAs, tA.w, tA.h, -Math.round(0.3 * tA.w), A.img.w - Math.round(0.7 * tA.w),
      -Math.round(0.3 * tA.h), A.img.h - Math.round(0.7 * tA.h), bg, 4).map(c => ({ ax: c.x, ay: c.y }));
  } else {
    const SC = samples(tC, 700);
    // camadas podem sair parcialmente do quadro (faixas, selos cortados)
    cands = search(C.img, SC, tC.w, tC.h, -Math.round(0.6 * tC.w), C.img.w - Math.round(0.4 * tC.w),
      -Math.round(0.6 * tC.h), C.img.h - Math.round(0.4 * tC.h), bg, 6)
      .map(c => ({ ax: Math.round(c.x * A.s / C.s), ay: Math.round(c.y * A.s / C.s) }));
  }
  if (!cands.length) return { x: Math.round((F.w - lw) / 2), y: Math.round((F.h - lh) / 2), err: Infinity };
  const r = Math.ceil(A.s / C.s) + 1;
  let tF = null, SF = null;
  if (full && A.s < 0.999) { tF = await raw(layerFile); SF = samples(tF, 6000); }
  let best = { s: Infinity };
  for (const c of cands) {
    const b = search(A.img, SA, tA.w, tA.h, c.ax - r, c.ax + r, c.ay - r, c.ay + r, bg, 1)[0];
    if (!b) continue;
    let res = { x: b.x / A.s, y: b.y / A.s, s: b.s };
    if (SF) {
      const rx = Math.ceil(1 / A.s) + 1, X = Math.round(res.x), Y = Math.round(res.y);
      const f = search(full, SF, tF.w, tF.h, X - rx, X + rx, Y - rx, Y + rx, bg, 1)[0];
      if (f) res = { x: f.x, y: f.y, s: f.s };
    }
    if (res.s < best.s) best = res;
  }
  if (!isFinite(best.s)) best = { x: cands[0].ax / A.s, y: cands[0].ay / A.s, s: Infinity };
  return { x: Math.round(best.x), y: Math.round(best.y), err: best.s };
}

// divide uma camada em linhas (e cada linha em ícone + texto) quando parece uma lista
async function splitList(img, F) {
  const rowsOn = [];
  for (let y = 0; y < img.h; y++) {
    let on = false;
    for (let x = 0; x < img.w && !on; x++) if (img.data[(y * img.w + x) * 4 + 3] > 40) on = true;
    rowsOn.push(on);
  }
  const segs = (arr, minGap) => {
    const out = []; let s = null, gap = 0;
    arr.forEach((v, i) => {
      if (v) { if (s === null) s = i; gap = 0; }
      else if (s !== null) { gap++; if (gap >= minGap) { out.push([s, i - gap + 1]); s = null; gap = 0; } }
    });
    if (s !== null) out.push([s, arr.length - gap]);
    return out;
  };
  const rows = segs(rowsOn, Math.round(F.h * 0.012));
  if (rows.length < 2 || rows.length > 6) return null;
  if (rows.some(([a, b]) => b - a < F.h * 0.025)) return null;
  const pieces = [];
  for (const [y0, y1] of rows) {
    const colsOn = [];
    for (let x = 0; x < img.w; x++) {
      let on = false;
      for (let y = y0; y < y1 && !on; y++) if (img.data[(y * img.w + x) * 4 + 3] > 40) on = true;
      colsOn.push(on);
    }
    const cols = segs(colsOn, Math.round(F.w * 0.02));
    if (cols.length >= 2 && cols[0][1] - cols[0][0] < img.w * 0.35) {
      pieces.push({ x: cols[0][0], y: y0, w: cols[0][1] - cols[0][0], h: y1 - y0, kind: 'icone' });
      const rest = cols.slice(1);
      pieces.push({ x: rest[0][0], y: y0, w: rest[rest.length - 1][1] - rest[0][0], h: y1 - y0, kind: 'texto' });
    } else {
      const x0 = cols.length ? cols[0][0] : 0, x1 = cols.length ? cols[cols.length - 1][1] : img.w;
      pieces.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, kind: 'linha' });
    }
  }
  return pieces;
}

function zOrder(layers, A, bg) {
  // relações "fica por cima" entre camadas sólidas que se sobrepõem
  const hard = layers.filter(l => !l.soft);
  const above = new Map(hard.map(l => [l.id, new Set()]));
  for (let i = 0; i < hard.length; i++) for (let j = i + 1; j < hard.length; j++) {
    const P = hard[i], Q = hard[j];
    const x0 = Math.max(P.x, Q.x), y0 = Math.max(P.y, Q.y);
    const x1 = Math.min(P.x + P.w, Q.x + Q.w), y1 = Math.min(P.y + P.h, Q.y + Q.h);
    if (x1 <= x0 || y1 <= y0) continue;
    let eP = 0, eQ = 0, n = 0;
    const step = Math.max(1, Math.round(Math.sqrt((x1 - x0) * (y1 - y0) / 3000)));
    for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) {
      const pa = P._px(x, y), qa = Q._px(x, y);
      if (!pa || !qa || pa[3] < 0.6 || qa[3] < 0.6) continue;
      const ax = Math.round(x * A.s), ay = Math.round(y * A.s);
      if (ax >= A.img.w || ay >= A.img.h) continue;
      const i = (ay * A.img.w + ax) * 4, R = A.img.data;
      eP += (pa[0] - R[i]) ** 2 + (pa[1] - R[i + 1]) ** 2 + (pa[2] - R[i + 2]) ** 2;
      eQ += (qa[0] - R[i]) ** 2 + (qa[1] - R[i + 1]) ** 2 + (qa[2] - R[i + 2]) ** 2;
      n++;
    }
    if (n < 20) continue;
    if (eP < eQ * 0.8) above.get(P.id).add(Q.id);
    else if (eQ < eP * 0.8) above.get(Q.id).add(P.id);
  }
  // ordenação topológica: quem está "abaixo" vem primeiro; empate = maior área embaixo
  const indeg = new Map(hard.map(l => [l.id, 0]));
  for (const [p, s] of above) indeg.set(p, indeg.get(p) + s.size);
  const order = [];
  const pool = hard.slice();
  while (pool.length) {
    pool.sort((a, b) => indeg.get(a.id) - indeg.get(b.id) || b.area - a.area);
    const n = pool.shift();
    order.push(n);
    for (const [p, s] of above) if (s.has(n.id)) indeg.set(p, indeg.get(p) - 1);
  }
  const soft = layers.filter(l => l.soft).sort((a, b) => b.area - a.area);
  return [...soft, ...order];
}

async function analyze(srcDir, jobDir, log = () => {}) {
  const imgDir = path.join(jobDir, 'img');
  fs.mkdirSync(imgDir, { recursive: true });
  const files = listPngs(srcDir);
  if (files.length < 2) throw new Error('A pasta precisa ter os PNGs das camadas e a arte completa (referencia.png).');
  const refFile = await findReference(files);
  if (!refFile) throw new Error('Não encontrei a arte completa. Exporte o frame inteiro como "referencia.png" nesta pasta.');
  const layerFiles = files.filter(f => f !== refFile);
  log(`Referência: ${path.basename(refFile)} · ${layerFiles.length} camadas`);

  const refMeta = await sharp(refFile).metadata();
  let maxLW = 0;
  for (const f of layerFiles) maxLW = Math.max(maxLW, (await sharp(f).metadata()).width);
  const FW = Math.max(refMeta.width, maxLW, 1);
  const F = { w: FW, h: Math.round(FW * refMeta.height / refMeta.width) };
  const sA = Math.min(1, 540 / F.w), sC = sA / 4;
  const A = { s: sA, img: await raw(refFile, Math.round(F.w * sA), Math.round(F.h * sA)) };
  const C = { s: sC, img: await raw(refFile, Math.round(F.w * sC), Math.round(F.h * sC)) };
  const full = refMeta.width >= F.w * 0.99 ? await raw(refFile, F.w, F.h) : null;
  const bg = medianColor(A.img);
  fs.copyFileSync(refFile, path.join(jobDir, 'referencia.png'));

  const layers = [];
  const used = new Set();
  let skipped = 0;
  for (const f of layerFiles) {
    const name = path.parse(f).name;
    let id = slug(name); while (used.has(id)) id += '-b'; used.add(id);
    const img = await raw(f);
    const st = alphaStats(img);
    if (st.vis === 0) { log(`Ignorada (vazia): ${name}`); continue; }
    // brilhos/desfoques grandes já fazem parte do fundo: não precisam ser posicionados
    const soft = st.solidFrac < 0.3 && img.w * img.h > 0.03 * F.w * F.h;
    if (soft) { skipped++; continue; }
    const pos = await locate(f, img.w, img.h, { A, C, full }, F, bg);
    log(`Posicionada: ${name} → (${pos.x}, ${pos.y})`);
    const layer = { id, name, x: pos.x, y: pos.y, w: img.w, h: img.h, area: st.vis, err: Math.round(pos.err) };
    layer._px = (x, y) => {
      const lx = x - layer.x, ly = y - layer.y;
      if (lx < 0 || ly < 0 || lx >= img.w || ly >= img.h) return null;
      const i = (ly * img.w + lx) * 4;
      return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3] / 255];
    };
    layer._file = f; layer._img = img;
    layers.push(layer);
  }
  if (skipped) log(`${skipped} camadas de brilho/desfoque ficam no fundo`);
  if (!layers.length) throw new Error('Nenhuma camada sólida encontrada para animar.');

  const ordered = zOrder(layers, A, bg);

  // divide listas em peças e grava as imagens finais
  const out = [];
  for (const l of ordered) {
    const pieces = await splitList(l._img, F);
    if (pieces) {
      log(`Dividida em ${pieces.length} peças: ${l.name}`);
      let k = 0;
      for (const p of pieces) {
        const pid = `${l.id}--${++k}`;
        await sharp(l._file).extract({ left: p.x, top: p.y, width: p.w, height: p.h }).png().toFile(path.join(imgDir, pid + '.png'));
        out.push({ id: pid, name: `${l.name} · ${p.kind} ${k}`, group: l.id,
          kind: p.kind, x: l.x + p.x, y: l.y + p.y, w: p.w, h: p.h, area: p.w * p.h });
      }
    } else {
      fs.copyFileSync(l._file, path.join(imgDir, l.id + '.png'));
      out.push({ id: l.id, name: l.name, x: l.x, y: l.y, w: l.w, h: l.h, area: l.area });
    }
  }

  // fundo limpo: referência sem os elementos animados (preenchimento por difusão)
  log('Gerando o fundo limpo…');
  await buildPlate(refFile, layers, F, path.join(imgDir, 'fundo.png'));

  // conferência: fundo + camadas vs referência, medida só onde há elementos
  const comps = [];
  for (const l of out) {
    const c = await clipped(path.join(imgDir, l.id + '.png'), l, F);
    if (c) comps.push(c);
  }
  const compBuf = await sharp(path.join(imgDir, 'fundo.png')).composite(comps).png().toBuffer();
  const compSmall = await raw(compBuf, A.img.w, A.img.h);
  let diff = 0, n = 0;
  for (const l of layers) {
    for (let y = Math.max(0, Math.round(l.y * A.s)); y < Math.min(A.img.h, Math.round((l.y + l.h) * A.s)); y += 2)
      for (let x = Math.max(0, Math.round(l.x * A.s)); x < Math.min(A.img.w, Math.round((l.x + l.w) * A.s)); x += 2) {
        const i = (y * A.img.w + x) * 4;
        for (let c = 0; c < 3; c++) diff += Math.abs(compSmall.data[i + c] - A.img.data[i + c]);
        n += 3;
      }
  }
  const match = Math.max(0, Math.min(100, 100 - (diff / Math.max(1, n)) * 1.2));
  await sharp(compBuf).toFile(path.join(jobDir, 'remontagem.png'));

  const result = { frame: F, bg: '#' + bg.map(v => v.toString(16).padStart(2, '0')).join(''),
    encaixe: Math.round(match), layers: out, origem: srcDir };
  fs.writeFileSync(path.join(jobDir, 'analise.json'), JSON.stringify(result, null, 1));
  log(`Encaixe com a referência: ${result.encaixe}%`);
  return result;
}

// Remove os elementos da referência e preenche o buraco suavemente (difusão multiescala)
async function buildPlate(refFile, layers, F, outFile) {
  const k = 4, W = Math.ceil(F.w / k), H = Math.ceil(F.h / k);
  // máscara de cobertura em 1/4 de resolução (máximo do alfa no bloco)
  const M = new Float32Array(W * H);
  for (const l of layers) {
    const img = l._img;
    for (let y = 0; y < img.h; y += 2) for (let x = 0; x < img.w; x += 2) {
      const a = img.data[(y * img.w + x) * 4 + 3] / 255;
      if (a < 0.03) continue;
      const fx = Math.floor((l.x + x) / k), fy = Math.floor((l.y + y) / k);
      if (fx < 0 || fy < 0 || fx >= W || fy >= H) continue;
      const i = fy * W + fx; if (a > M[i]) M[i] = a;
    }
  }
  // dilata 2 células (bordas, sombras e anti-alias)
  let D = M;
  for (let it = 0; it < 2; it++) {
    const N = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let m = D[y * W + x];
      if (x > 0) m = Math.max(m, D[y * W + x - 1]); if (x < W - 1) m = Math.max(m, D[y * W + x + 1]);
      if (y > 0) m = Math.max(m, D[(y - 1) * W + x]); if (y < H - 1) m = Math.max(m, D[(y + 1) * W + x]);
      N[y * W + x] = m;
    }
    D = N;
  }
  const unknown = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) unknown[i] = D[i] > 0.05 ? 1 : 0;

  const small = await raw(refFile, W, H);
  const fillLevel = (img, w, h, unk, init, iters) => {
    const P = [new Float32Array(w * h), new Float32Array(w * h), new Float32Array(w * h)];
    for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) P[c][i] = unk[i] ? (init ? init[c][i] : 0) : img[i * 4 + c];
    for (let it = 0; it < iters; it++) for (let c = 0; c < 3; c++) {
      const p = P[c];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x; if (!unk[i]) continue;
        let s = 0, n = 0;
        if (x > 0) { s += p[i - 1]; n++; } if (x < w - 1) { s += p[i + 1]; n++; }
        if (y > 0) { s += p[i - w]; n++; } if (y < h - 1) { s += p[i + w]; n++; }
        p[i] = s / n;
      }
    }
    return P;
  };
  // nível grosso (1/4 de W) para inicializar, depois refina
  const w2 = Math.ceil(W / 4), h2 = Math.ceil(H / 4);
  const small2 = await raw(refFile, w2, h2);
  const unk2 = new Uint8Array(w2 * h2);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (unknown[y * W + x]) unk2[Math.min(h2 - 1, y >> 2) * w2 + Math.min(w2 - 1, x >> 2)] = 1;
  const meanKnown = [0, 1, 2].map(c => { let s = 0, n = 0; for (let i = 0; i < w2 * h2; i++) if (!unk2[i]) { s += small2.data[i * 4 + c]; n++; } return n ? s / n : 128; });
  const init2 = [0, 1, 2].map(c => new Float32Array(w2 * h2).fill(meanKnown[c]));
  const P2 = fillLevel(small2.data, w2, h2, unk2, init2, 400);
  const init = [0, 1, 2].map(c => { const a = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) a[y * W + x] = P2[c][Math.min(h2 - 1, y >> 2) * w2 + Math.min(w2 - 1, x >> 2)];
    return a; });
  const P = fillLevel(small.data, W, H, unknown, init, 250);

  const fillBuf = Buffer.alloc(W * H * 3), maskBuf = Buffer.alloc(W * H);
  for (let i = 0; i < W * H; i++) {
    for (let c = 0; c < 3; c++) fillBuf[i * 3 + c] = Math.max(0, Math.min(255, Math.round(P[c][i])));
    maskBuf[i] = Math.round(Math.min(1, D[i] * 1.5) * 255);
  }
  const fillFull = await sharp(fillBuf, { raw: { width: W, height: H, channels: 3 } }).resize(F.w, F.h, { kernel: 'cubic' }).blur(2).raw().toBuffer();
  const maskFull = await sharp(maskBuf, { raw: { width: W, height: H, channels: 1 } }).resize(F.w, F.h, { kernel: 'cubic' }).blur(3).extractChannel(0).raw().toBuffer();
  const ref = await sharp(refFile).removeAlpha().resize(F.w, F.h, { fit: 'fill' }).raw().toBuffer();
  const outBuf = Buffer.alloc(F.w * F.h * 3);
  for (let i = 0; i < F.w * F.h; i++) {
    const m = maskFull[i] / 255;
    for (let c = 0; c < 3; c++) outBuf[i * 3 + c] = Math.round(ref[i * 3 + c] * (1 - m) + fillFull[i * 3 + c] * m);
  }
  await sharp(outBuf, { raw: { width: F.w, height: F.h, channels: 3 } }).png().toFile(outFile);
}

// sharp não aceita camadas que saem da tela no composite: recorta antes
async function clipped(file, l, F) {
  const left = Math.max(0, l.x), top = Math.max(0, l.y);
  const ex = { left: left - l.x, top: top - l.y };
  ex.width = Math.min(l.w - ex.left, F.w - left); ex.height = Math.min(l.h - ex.top, F.h - top);
  if (ex.width <= 0 || ex.height <= 0) return null;
  if (ex.left === 0 && ex.top === 0 && ex.width === l.w && ex.height === l.h) return { input: file, left, top };
  return { input: await sharp(file).extract(ex).toBuffer(), left, top };
}

module.exports = { analyze, slug };
