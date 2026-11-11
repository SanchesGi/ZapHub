#!/usr/bin/env bash
# minha versao: prepara o servidor UMA VEZ para o painel fazer a manutencao sozinho (sem entrar mais no terminal).
#   sudo bash deploy/preparar-vm.sh
#
# O que faz (pode rodar de novo quantas vezes quiser; nao muda o que ja esta certo):
#   1) cria a pasta das midias fora do /home: /var/lib/zaphub/midia, do usuario dono do app;
#      depois escolha essa pasta no painel (Manutencao > Armazenamento) e clique em "Mover arquivos".
#      (Se o painel ja usa outra pasta, ela continua valendo: a pasta fica gravada no banco.)
#   2) instala o servico de atualizacao (roda deploy/atualizar.sh --auto). NAO liga o timer de 5 em 5 min:
#      a atualizacao so roda quando voce clicar em "Atualizar agora" no painel (Manutencao).
#      Para o automatico, use:  sudo bash deploy/ativar-atualizacao-automatica.sh
#   3) libera SEM senha, so para o usuario do app, os comandos de parar/iniciar/reiniciar o servico e de iniciar a
#      atualizacao (deploy/regras-sudo.sh). Nada mais.
set -euo pipefail

if [[ "$(id -u)" != "0" ]]; then
  echo "Rode com sudo:  sudo bash deploy/preparar-vm.sh"
  exit 1
fi

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
USUARIO="${SUDO_USER:-$(stat -c '%U' "$DIR")}"
SYSTEMCTL="$(command -v systemctl)"
MIDIA="/var/lib/zaphub/midia"
SERVICO_ATUALIZAR="zaphub-atualizar"

if [[ "$USUARIO" = "root" ]]; then
  echo "ERRO: rode com sudo a partir do usuario do app (nao como root direto), ou a pasta $DIR pertence ao root."
  exit 1
fi

# 1) pasta das midias
mkdir -p "$MIDIA"
chown "$USUARIO": "$MIDIA"
chmod 750 "$MIDIA"
command -v restorecon >/dev/null 2>&1 && restorecon -R "$MIDIA" || true   # SELinux: rotulo padrao de /var/lib
echo "[1/3] Pasta das midias pronta: $MIDIA (dono: $USUARIO)"

# 2) servico de atualizacao (sem timer)
sed -e "s|__DIR__|$DIR|g" -e "s|__USER__|$USUARIO|g" "$DIR/deploy/zaphub-atualizar.service.modelo" > "/etc/systemd/system/$SERVICO_ATUALIZAR.service"
"$SYSTEMCTL" daemon-reload
echo "[2/3] Servico $SERVICO_ATUALIZAR instalado (o timer automatico continua como estava)."

# 3) sudoers (o mesmo conteudo que os outros scripts gravam)
bash "$DIR/deploy/regras-sudo.sh" "$USUARIO" "$SYSTEMCTL"
echo "[3/3] Permissoes do painel liberadas em /etc/sudoers.d/zaphub."

echo ""
echo "=== Pronto. Agora tudo pelo painel ==="
echo " - Manutencao > Armazenamento: escolha $MIDIA e clique em Mover arquivos (se ainda nao escolheu uma pasta fora do /home)."
echo " - Manutencao: Atualizar agora, Reiniciar, Logs e Liberar espaco."
