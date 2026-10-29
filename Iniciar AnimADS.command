#!/bin/bash
# AnimADS - lançador para macOS (duplo clique)
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  O Node.js não está instalado."
  echo "  Vou abrir o site: baixe a versão LTS, instale e abra este arquivo de novo."
  open "https://nodejs.org/pt"
  read -r -p "  Pressione Enter para fechar..."
  exit 1
fi

if [ ! -d "node_modules/sharp" ]; then
  echo ""
  echo "  Primeira vez: instalando o AnimADS. Isso leva alguns minutos..."
  echo ""
  if ! npm install --no-audit --no-fund || ! npx playwright install chromium; then
    echo ""
    echo "  A instalação falhou. Verifique a internet e tente de novo."
    read -r -p "  Pressione Enter para fechar..."
    exit 1
  fi
fi

node server.js --abrir
