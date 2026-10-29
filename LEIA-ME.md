# AnimADS v0.1 (protótipo)

Transforma as camadas de um AD exportadas do Figma em um **vídeo animado com trilha e efeitos sonoros**, sem precisar de After Effects.
O roteiro da animação é criado pelo **Claude instalado na máquina**. Se o Claude não estiver disponível, o AnimADS usa um roteiro automático.

---

## 1. Instalação (uma vez por computador)

1. **Node.js (versão LTS)**: baixe em <https://nodejs.org/pt> e instale com as opções padrão.
2. **Claude Code** (opcional, mas recomendado): instale seguindo <https://docs.claude.com/pt/docs/claude-code/overview>.
   Depois, abra o terminal, digite `claude` e faça o login uma vez.
3. Descompacte a pasta **AnimADS** em um lugar fixo (ex.: `Documentos\AnimADS`).

## 2. Abrir o programa

- **Windows:** dois cliques em **`Iniciar AnimADS.bat`**.
  Se o Windows mostrar "O Windows protegeu o computador", clique em *Mais informações* → *Executar assim mesmo*.
- **Mac:** clique com o botão direito em **`Iniciar AnimADS.command`** → *Abrir* (só na primeira vez; depois é duplo clique).

Na primeira vez, ele instala as dependências (cerca de 300 MB, alguns minutos). Depois disso, abre direto no navegador.
**Deixe a janela preta aberta enquanto usa.** Fechar essa janela encerra o AnimADS.

## 3. Preparar a pasta de cada AD (no Figma)

1. Selecione todas as camadas de primeiro nível dentro do frame do AD → **Export** → **PNG 1x** → **Export N layers**.
2. Selecione o próprio frame → **PNG 1x** → salve na mesma pasta como **`referencia.png`**.
3. Uma pasta por AD. Para gerar vários de uma vez, coloque as pastas dos ADs dentro de uma pasta "mãe".

## 4. Usar

1. Arraste as pastas para a área grande (ou clique em **Escolher pastas no computador**).
2. Escolha estilo (Energético, Suave ou Premium), duração e som.
3. Acompanhe a fila. Cada AD leva cerca de 1 a 2 minutos.
4. Clique no AD para assistir, ver a linha do tempo da animação e **pedir ajustes em texto** ("deixa mais rápido", "o selo entra girando").

Os vídeos ficam em uma subpasta **`AnimADS`** dentro da pasta de cada AD, com e sem som.
Quando os arquivos foram arrastados para a janela, os vídeos ficam em `AnimADS/saida`.

## 5. Como funciona

```
pasta do AD ─▶ análise (posição de cada camada na referência, ordem, fundo limpo, divisão de listas)
            ─▶ roteiro (Claude lê a arte numerada e escolhe papéis, entradas, loops e destaques)
            ─▶ vídeo (Chromium renderiza quadro a quadro a 30 fps, GSAP) ─▶ som (sintetizado e sincronizado) ─▶ MP4
```

- Tudo roda **no computador do designer**. O Claude recebe apenas a arte de referência, a arte numerada e a lista de camadas, para criar o roteiro.
- Os sons são sintetizados em código, então não há problema de direitos autorais.
- Arquivos principais: `lib/analyze.js` (encaixe), `lib/plan.js` (roteiro e prompt do Claude), `player/player.js` (animações), `lib/audio.js` (sons), `server.js` (interface e fila).

## 6. Problemas comuns

| Sintoma | O que fazer |
|---|---|
| "Não encontrei a arte completa" | Exporte o frame como `referencia.png` na mesma pasta. |
| Encaixe abaixo de 85% | As camadas e a referência não são do mesmo frame ou da mesma escala. Exporte tudo em 1x. |
| "Sem Claude: roteiro automático" | Instale o Claude Code e faça login (`claude` no terminal). Depois clique no selo para verificar de novo. Se o comando tiver outro nome ou caminho, defina a variável `ANIMADS_CLAUDE`. |
| Antivírus bloqueou a instalação | Libere a pasta do AnimADS e abra o iniciador de novo. |
| Porta ocupada | O AnimADS tenta automaticamente a próxima porta (4174, 4175...). |
