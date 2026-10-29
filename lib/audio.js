// AnimADS - trilha e efeitos sonoros sintetizados (sem arquivos de áudio de terceiros)
// Os sons são posicionados lendo o roteiro: cada efeito visual gera seu som no pico do movimento.
const fs = require('fs');

const SR = 48000;

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
let rand = rng(7);
const gauss = () => { let u = 0, v = 0; while (!u) u = rand(); v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const noise = n => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = gauss(); return a; };
const len = d => Math.max(1, Math.round(SR * d));

function env(n, a = 0.005, curve = 4) {
  const e = new Float32Array(n), na = Math.max(1, Math.round(SR * a));
  for (let i = 0; i < n; i++) e[i] = i < na ? i / na : Math.pow(1 - (i - na) / Math.max(1, n - na), curve);
  return e;
}
// biquad (RBJ)
function biquad(x, type, f, q = 0.707) {
  f = Math.min(Math.max(f, 20), SR / 2 - 200);
  const w = 2 * Math.PI * f / SR, c = Math.cos(w), s = Math.sin(w), al = s / (2 * q);
  let b0, b1, b2, a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
  if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; }
  else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; }
  else { b0 = al; b1 = 0; b2 = -al; }
  const y = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
const lp = (x, f) => biquad(x, 'lp', f), hp = (x, f) => biquad(x, 'hp', f);
const bp = (x, lo, hi) => { const c = Math.sqrt(lo * hi); return biquad(x, 'bp', c, Math.max(0.3, c / (hi - lo))); };
const mul = (a, b, k = 1) => { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] * (b ? b[i] : 1) * k; return o; };
const add = (...xs) => { const n = Math.max(...xs.map(x => x.length)); const o = new Float32Array(n); for (const x of xs) for (let i = 0; i < x.length; i++) o[i] += x[i]; return o; };

// ---------- biblioteca de sons ----------
function whoosh(d = 0.5, lo = 300, hi = 4000) {
  const n = len(d), x = noise(n), out = new Float32Array(n), B = 1024;
  // filtro varrendo em blocos (estado do filtro reiniciado por bloco é aceitável no ruído)
  for (let k = 0; k < n; k += B) {
    const p = k / n, f = lo * Math.pow(hi / lo, p);
    const blk = biquad(x.subarray(k, Math.min(n, k + B + 256)), 'bp', f, 1.2);
    for (let i = 0; i < B && k + i < n; i++) out[k + i] = blk[i];
  }
  for (let i = 0; i < n; i++) out[i] *= Math.pow(Math.sin(Math.PI * i / n), 2) * 0.9;
  return out;
}
function impact(d = 0.9, f0 = 110) {
  const n = len(d), e1 = env(n, 0.002, 2.5), o = new Float32Array(n);
  let ph = 0;
  const click = mul(hp(noise(n), 2000), env(n, 0.0005, 40), 0.5);
  const body = mul(lp(noise(n), 900), env(n, 0.001, 10), 0.8);
  for (let i = 0; i < n; i++) {
    const t = i / SR; ph += 2 * Math.PI * (f0 * Math.exp(-t * 6) + 38) / SR;
    o[i] = Math.tanh((Math.sin(ph) * e1[i] * 1.2 + click[i] + body[i]) * 1.5) * 0.9;
  }
  return o;
}
function pop(f = 900, d = 0.12) {
  const n = len(d), e = env(n, 0.001, 6), o = new Float32Array(n); let ph = 0;
  for (let i = 0; i < n; i++) { const t = i / SR; ph += 2 * Math.PI * f * (1 + 1.5 * Math.exp(-t * 60)) / SR; o[i] = Math.sin(ph) * e[i] * 0.7; }
  return o;
}
function bounce(f = 180, d = 0.18) {
  const n = len(d), e = env(n, 0.001, 5), o = new Float32Array(n); let ph = 0;
  for (let i = 0; i < n; i++) { const t = i / SR; ph += 2 * Math.PI * (f * Math.exp(-t * 12) + 60) / SR; o[i] = Math.sin(ph) * e[i] * 0.9; }
  return o;
}
const tick = () => mul(hp(noise(len(0.04)), 3000), env(len(0.04), 0.0005, 12), 0.35);
function shimmer(d = 0.9) {
  const n = len(d), o = new Float32Array(n);
  [2093, 2637, 3136, 3951, 4186].forEach((f, k) => {
    const st = Math.round(k * 0.07 * SR), e = env(n - st, 0.003, 3);
    for (let i = 0; i < n - st; i++) o[st + i] += Math.sin(2 * Math.PI * f * i / SR) * e[i] * 0.18;
  });
  const air = hp(noise(n), 7000);
  for (let i = 0; i < n; i++) o[i] += air[i] * Math.sin(Math.PI * i / n) * 0.05;
  return o;
}
function riser(d = 0.5) {
  const n = len(d), o = new Float32Array(n), nz = hp(noise(n), 1500); let ph = 0;
  for (let i = 0; i < n; i++) { const t = i / SR; ph += 2 * Math.PI * 200 * Math.pow(8, t / d) / SR; o[i] = (Math.sin(ph) * 0.15 + nz[i] * 0.25) * Math.pow(t / d, 2); }
  return o;
}
function cash(d = 0.6) {
  const n = len(d), o = new Float32Array(n);
  [[1568, 0], [2093, 0.06]].forEach(([f, st]) => {
    const s0 = Math.round(st * SR), e = env(n - s0, 0.001, 4);
    for (let i = 0; i < n - s0; i++) o[s0 + i] += (Math.sin(2 * Math.PI * f * i / SR) + 0.4 * Math.sin(2 * Math.PI * f * 2.76 * i / SR)) * e[i] * 0.3;
  });
  return o;
}
function softHit(d = 0.5) { return mul(lp(noise(len(d)), 600), env(len(d), 0.004, 3), 0.6); }
function kick() { const n = len(0.35), e = env(n, 0.001, 3), o = new Float32Array(n); let ph = 0; for (let i = 0; i < n; i++) { const t = i / SR; ph += 2 * Math.PI * (50 + 120 * Math.exp(-t * 30)) / SR; o[i] = Math.sin(ph) * e[i]; } return o; }
const hat = (open) => { const d = open ? 0.18 : 0.05; return mul(hp(noise(len(d)), 8000), env(len(d), 0.001, 6), 0.25); };
const clap = () => mul(bp(noise(len(0.2)), 900, 3000), env(len(0.2), 0.001, 8), 0.5);
function bass(f, d) {
  const n = len(d), o = new Float32Array(n);
  for (let i = 0; i < n; i++) { const s = Math.sin(2 * Math.PI * f * i / SR); o[i] = Math.sign(s) * 0.5 + s; }
  return mul(lp(o, 400), env(n, 0.005, 1.5), 0.35);
}
function pad(freqs, d) {
  const n = len(d), o = new Float32Array(n);
  for (const f of freqs) for (const det of [-0.6, 0, 0.6]) for (let i = 0; i < n; i++) o[i] += Math.sin(2 * Math.PI * (f + det) * i / SR) * 0.03;
  const a = Math.round(0.6 * SR);
  for (let i = 0; i < n; i++) o[i] *= Math.min(1, i / a, (n - i) / a);
  return lp(o, 1800);
}

// ---------- montagem a partir do roteiro ----------
function cuesFromPlan(plan, an) {
  const F = an.frame, by = Object.fromEntries(an.layers.map(l => [l.id, l]));
  const cues = [];
  const pan = l => l ? Math.max(-0.8, Math.min(0.8, ((l.x + l.w / 2) / F.w - 0.5) * 1.6)) : 0;
  let firstBig = null;
  for (const c of plan.camadas) {
    const l = by[c.id], e = c.entrada, t = e.inicio, d = e.duracao, p = pan(l);
    const big = ['titulo', 'oferta', 'cta'].includes(c.papel);
    switch (e.efeito) {
      case 'pop':
        if (big) { cues.push(['riser', t - 0.35, 0.7, 0], ['impact', t + d * 0.15, 1, 0]); }
        else cues.push(['pop', t + d * 0.3, 0.55, p, 700 + (cues.length % 5) * 120]);
        break;
      case 'carimbo': cues.push(['riser', t - 0.2, 0.6, 0], ['impact', t + d, 1, 0]); break;
      case 'cair': [0.364, 0.727, 0.909, 0.955].forEach((q, i) => cues.push(['bounce', t + d * q, [0.9, 0.55, 0.35, 0.2][i], p, 200 - i * 15])); break;
      case 'subir': case 'fade': if (c.papel !== 'legal') cues.push(['whooshS', t, 0.22, p]); break;
      case 'girar': cues.push(['whooshS', t, 0.4, p], ['pop', t + d * 0.6, 0.5, p, 900]); break;
      default: if (e.efeito.startsWith('deslizar')) cues.push(['whoosh', t - 0.05, 0.65, p]);
    }
    if (big && !firstBig) firstBig = t;
    if (c.papel === 'oferta' && ['pop', 'carimbo'].includes(e.efeito)) cues.push(['cash', t + d * (e.efeito === 'carimbo' ? 1 : 0.25), 0.7, 0]);
    for (const h of c.destaques || []) {
      if (h.efeito === 'tremer') for (let k = 0; k < 6; k++) cues.push(['tick', h.em + k * 0.07, 0.5, (k % 2 ? 1 : -1) * 0.4]);
      if (h.efeito === 'brilho') cues.push(['shimmer', h.em + 0.05, 0.7, p]);
      if (h.efeito === 'pulsar') cues.push(['bounce', h.em, 0.45, p, 120]);
    }
  }
  return { cues, firstBig: firstBig == null ? 0.3 : firstBig };
}

function render(plan, an, outWav, opts = {}) {
  rand = rng(7);
  const DUR = plan.duracao, N = Math.round(SR * DUR);
  const L = new Float32Array(N), R = new Float32Array(N);
  const style = plan.estilo || 'energetico';
  const g = { energetico: { sfx: 1, beat: 0.55 }, suave: { sfx: 0.7, beat: 0.35 }, premium: { sfx: 0.55, beat: 0 } }[style] || { sfx: 1, beat: 0.55 };
  const put = (sig, at, gain, p = 0) => {
    const i0 = Math.round(Math.max(0, at) * SR), gl = Math.cos((p + 1) * Math.PI / 4) * 1.414, gr = Math.sin((p + 1) * Math.PI / 4) * 1.414;
    for (let i = 0; i < sig.length && i0 + i < N; i++) { L[i0 + i] += sig[i] * gain * gl; R[i0 + i] += sig[i] * gain * gr; }
  };
  const { cues, firstBig } = cuesFromPlan(plan, an);
  const music = opts.musica !== false, sfx = opts.efeitos !== false;

  if (music) {
    if (g.beat > 0) {
      const bpm = style === 'suave' ? 96 : 120, beat = 60 / bpm, notes = [55, 55, 65.41, 73.42];
      let t = Math.max(0, firstBig), i = 0;
      while (t < DUR - 0.6) {
        put(kick(), t, g.beat);
        if (i % 4 === 1 || i % 4 === 3) put(clap(), t, g.beat * 0.65);
        put(hat(), t + beat / 2, g.beat * 0.9, 0.3); put(hat(), t, g.beat * 0.45, -0.3);
        put(bass(notes[Math.floor(i / 4) % 4], beat * 0.9), t, g.beat * 1.1);
        t += beat; i++;
      }
    } else {
      // premium: cama harmônica suave
      put(pad([220, 277.18, 329.63], DUR - 0.3), 0.1, 1);
      put(pad([110], DUR - 0.3), 0.1, 0.8);
    }
  }
  if (sfx) {
    for (const [type, at, gain, p, f] of cues) {
      if (style !== 'energetico' && type === 'tick') continue;
      const G = gain * g.sfx;
      if (type === 'impact') put(style === 'premium' ? softHit() : impact(0.85, 100), at, G, p);
      else if (type === 'riser') { if (style === 'energetico') put(riser(0.4), at, G, p); }
      else if (type === 'pop') put(pop(f || 900), at, G, p);
      else if (type === 'bounce') put(bounce(f || 180), at, G, p);
      else if (type === 'whoosh') put(whoosh(0.45, 400, 5000), at, G, p);
      else if (type === 'whooshS') put(whoosh(0.3, 1500, 6000), at, G, p);
      else if (type === 'tick') put(tick(), at, G, p);
      else if (type === 'shimmer') put(shimmer(), at, G, p);
      else if (type === 'cash') put(cash(), at, G, p);
    }
    if (music || sfx) put(style === 'premium' ? softHit(1) : impact(1.2, 80), DUR - 0.6, 0.65 * g.sfx, 0);
  }
  // master: fade final, saturação suave, normalização
  const nf = Math.round(0.5 * SR);
  let peak = 1e-9;
  for (let i = 0; i < N; i++) {
    const f = i > N - nf ? (N - i) / nf : 1;
    L[i] = Math.tanh(L[i] * f * 1.1); R[i] = Math.tanh(R[i] * f * 1.1);
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  const k = 0.89 / peak;
  const buf = Buffer.alloc(44 + N * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
  for (let i = 0; i < N; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * k)) * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * k)) * 32767), 46 + i * 4);
  }
  fs.writeFileSync(outWav, buf);
  return cues.length;
}

module.exports = { render };
