#!/usr/bin/env bash
# minha versao: grava /etc/sudoers.d/zaphub. Usado pelo preparar-vm.sh e pelo ativar-atualizacao-automatica.sh,
# para os dois gravarem SEMPRE as mesmas regras.
#   bash deploy/regras-sudo.sh <usuario> <caminho-do-systemctl>   (como root)
set -euo pipefail
USUARIO="$1"
SYSTEMCTL="$2"
SUDOERS="/etc/sudoers.d/zaphub"

TMP="$(mktemp)"
cat > "$TMP" <<EOF
# minha versao: ZapHub (gerado por deploy/regras-sudo.sh). So estes comandos, sem senha, para o usuario do app.
$USUARIO ALL=(root) NOPASSWD: $SYSTEMCTL stop zaphub, $SYSTEMCTL start zaphub, $SYSTEMCTL restart zaphub, $SYSTEMCTL start --no-block zaphub-atualizar
EOF
if ! visudo -cf "$TMP" >/dev/null; then
  rm -f "$TMP"
  echo "ERRO: a regra do sudoers ficou invalida. Nada foi alterado."
  exit 1
fi
install -m 0440 -o root -g root "$TMP" "$SUDOERS"
rm -f "$TMP"
