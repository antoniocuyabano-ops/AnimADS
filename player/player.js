// AnimADS - player: monta a timeline GSAP a partir da análise + roteiro.
// Usado tanto no preview da interface quanto no render do vídeo.
(function () {
  const D = window.ANIMADS; // { analise, plano, base }
  const A = D.analise, P = D.plano, F = A.frame;
  const stage = document.getElementById('stage');
  Object.assign(stage.style, { width: F.w + 'px', height: F.h + 'px', background: A.bg });

  const E = {};
  const mk = (id, src, x, y, w, h) => {
    const im = new Image();
    im.src = src; im.draggable = false;
    Object.assign(im.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
    stage.appendChild(im); return im;
  };
  E.__fundo = mk('__fundo', D.base + 'img/fundo.png', 0, 0, F.w, F.h);
  const byId = Object.fromEntries(A.layers.map(l => [l.id, l]));
  const shines = {};
  for (const l of A.layers) {
    E[l.id] = mk(l.id, D.base + 'img/' + l.id + '.png', l.x, l.y, l.w, l.h);
    const cfg = (P.camadas || []).find(c => c.id === l.id);
    if (cfg && (cfg.destaques || []).some(d => d.efeito === 'brilho')) {
      const s = document.createElement('div'); s.className = 'shine';
      const url = `url("${D.base}img/${l.id}.png")`;
      Object.assign(s.style, { left: l.x + 'px', top: l.y + 'px', width: l.w + 'px', height: l.h + 'px',
        webkitMaskImage: url, maskImage: url });
      stage.appendChild(s); shines[l.id] = s;
    }
  }

  const DUR = P.duracao || 10;
  const tl = gsap.timeline({ paused: true, defaults: { ease: 'power3.out' } });
  const intensity = { energetico: 1, suave: 0.6, premium: 0.45 }[P.estilo] || 1;

  // fundo vivo
  const fz = (P.fundo && P.fundo.efeito) || 'zoom-lento';
  gsap.set(E.__fundo, { transformOrigin: '50% 40%' });
  if (fz === 'zoom-lento') tl.fromTo(E.__fundo, { scale: 1.12 }, { scale: 1, duration: 1.4 }, 0)
    .to(E.__fundo, { scale: 1.05, duration: DUR - 1.4, ease: 'sine.inOut' }, 1.4);
  else if (fz === 'respirar') tl.to(E.__fundo, { scale: 1.04, duration: DUR / 4, yoyo: true, repeat: 3, ease: 'sine.inOut' }, 0);

  const edgeDist = 260;
  for (const c of (P.camadas || [])) {
    const el = E[c.id], l = byId[c.id]; if (!el || !l) continue;
    const e = c.entrada || { efeito: 'nenhum' };
    const t = Math.max(0, +e.inicio || 0), d = Math.max(0.15, +e.duracao || 0.7);
    gsap.set(el, { transformOrigin: '50% 50%' });
    switch (e.efeito) {
      case 'pop': tl.from(el, { scale: 0.15, opacity: 0, rotation: -8 * intensity, duration: d, ease: `back.out(${1 + intensity})` }, t); break;
      case 'carimbo': tl.from(el, { scale: 1.9, opacity: 0, duration: d, ease: 'power4.in' }, t); break;
      case 'cair': tl.from(el, { y: -(l.y + l.h + 40), duration: d, ease: 'bounce.out' }, t); break;
      case 'subir': tl.from(el, { y: 90, opacity: 0, duration: d }, t); break;
      case 'deslizar-esquerda': tl.from(el, { x: -(l.x + l.w + edgeDist), duration: d }, t); break;
      case 'deslizar-direita': tl.from(el, { x: (F.w - l.x) + edgeDist, duration: d }, t); break;
      case 'deslizar-cima': tl.from(el, { y: -(l.y + l.h + edgeDist), duration: d }, t); break;
      case 'deslizar-baixo': tl.from(el, { y: (F.h - l.y) + edgeDist, duration: d }, t); break;
      case 'girar': tl.from(el, { scale: 0, rotation: -200, duration: d, ease: 'back.out(1.6)' }, t); break;
      case 'fade': tl.from(el, { opacity: 0, duration: d, ease: 'power1.out' }, t); break;
      default: break; // 'nenhum': já está na tela
    }
    const end = t + d;
    const loopLen = Math.max(0, DUR - end);
    if (loopLen > 0.6) {
      if (c.loop === 'flutuar') tl.to(el, { y: '-=' + Math.round(14 * intensity + 4), duration: 1.6, yoyo: true, repeat: Math.max(1, Math.floor(loopLen / 1.6) - 1), ease: 'sine.inOut' }, end);
      else if (c.loop === 'balancar') tl.to(el, { rotation: 3 * intensity, duration: 1.2, yoyo: true, repeat: Math.max(1, Math.floor(loopLen / 1.2) - 1), ease: 'sine.inOut' }, end);
      else if (c.loop === 'pulsar') tl.to(el, { scale: 1 + 0.04 * intensity, duration: 0.8, yoyo: true, repeat: Math.max(1, Math.floor(loopLen / 0.8) - 1), ease: 'sine.inOut' }, end);
    }
    for (const h of (c.destaques || [])) {
      const at = +h.em || 0;
      if (h.efeito === 'tremer') tl.to(el, { rotation: 2.5 * intensity, duration: 0.07, yoyo: true, repeat: 5, ease: 'none' }, at);
      else if (h.efeito === 'pulsar') tl.to(el, { scale: 1 + 0.07 * intensity, duration: 0.35, yoyo: true, repeat: 1, ease: 'power2.inOut' }, at);
      else if (h.efeito === 'brilho' && shines[c.id]) tl.fromTo(shines[c.id], { backgroundPosition: '150% 0' }, { backgroundPosition: '-50% 0', duration: 0.9, ease: 'power2.inOut' }, at);
    }
  }
  tl.set({}, {}, DUR);

  window.TL = tl; window.DUR = DUR;
  window.seek = t => { tl.seek(t, false); };
  window.ready = Promise.all([...stage.querySelectorAll('img')].map(i => i.decode().catch(() => {})));

  // preview: ajusta ao tamanho da janela e toca em loop
  if (location.search.includes('preview')) {
    const fit = () => {
      const s = Math.min(innerWidth / F.w, innerHeight / F.h);
      stage.style.transform = `scale(${s})`; stage.style.transformOrigin = '0 0';
      stage.style.marginLeft = ((innerWidth - F.w * s) / 2) + 'px';
    };
    fit(); addEventListener('resize', fit);
    window.ready.then(() => { tl.repeat(-1).repeatDelay(0.6).play(); });
    window.addEventListener('message', ev => {
      if (ev.data === 'pause') tl.pause(); if (ev.data === 'play') tl.play();
      if (ev.data === 'restart') tl.restart();
    });
  }
})();
