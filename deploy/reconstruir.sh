#!/usr/bin/env bash
# minha versao: reconstroi o sistema do ZERO e reinicia. Use quando a tela ficar "sem estilo"
# (build antigo/pela metade) sem precisar baixar nada novo do GitHub.
#   bash deploy/reconstruir.sh
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"
SERVICO="zaphub"
TEM_SERVICO=0
if command -v systemctl >/dev/null 2>&1 && systemctl cat "$SERVICO.service" >/dev/null 2>&1; then TEM_SERVICO=1; fi

# para o serviço ANTES de apagar o .next (senao ele serve um build pela metade e a tela quebra)
if [[ "$TEM_SERVICO" = 1 ]]; then
  echo "--- Parando o serviço $SERVICO durante a reconstrução..."
  sudo systemctl stop "$SERVICO" 2>/dev/null || true
fi

echo "--- Limpando o build antigo..."
rm -rf .next

echo "--- Dependencias..."
npm install --no-audit --no-fund --legacy-peer-deps

echo "--- Prisma..."
npx prisma generate

echo "--- Compilando do zero (pode demorar; precisa de memoria)..."
export NODE_OPTIONS="--max-old-space-size=2048"
npm run build

if ! ls .next/static/chunks/*.css >/dev/null 2>&1 && ! ls .next/static/css/*.css >/dev/null 2>&1; then
  echo ""
  echo "ERRO: o build NAO gerou o CSS. Quase sempre e falta de memoria na VM."
  echo "Crie um swap de 2 GB e tente de novo:"
  echo "  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile"
  echo "  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab"
  exit 1
fi

echo "--- Reiniciando o servico..."
if [[ "$TEM_SERVICO" = 1 ]]; then
  sudo systemctl restart "$SERVICO"
fi

PORTA="$(grep -E '^PORT=' .env 2>/dev/null | head -1 | sed -E 's/^PORT="?([0-9]+)"?.*/\1/')"; [[ -z "$PORTA" ]] && PORTA=3030
sleep 5
echo ""
echo "=== Reconstruido. Acesse e aperte Ctrl+F5 (ou Ctrl+Shift+R) para limpar o cache do navegador. ==="
echo "    Teste do estilo:  curl -s http://localhost:$PORTA/ | grep -o 'stylesheet' | head -1"
