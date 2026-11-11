#!/usr/bin/env bash
# minha versao: liga (ou desliga) a atualizacao automatica do ZapHub neste servidor.
#   sudo bash deploy/ativar-atualizacao-automatica.sh            -> liga (checa o GitHub a cada 5 min)
#   sudo bash deploy/ativar-atualizacao-automatica.sh desligar   -> desliga
#
# O que faz ao ligar:
#   1) libera, SEM senha, so os comandos de parar/iniciar/reiniciar o servico e de iniciar a atualizacao
#      (deploy/regras-sudo.sh); o usuario continua sem poder rodar outra coisa como root;
#   2) instala o servico de atualizacao (roda deploy/atualizar.sh --auto) e o timer de 5 em 5 minutos.
# Cada push no branch main do GitHub entra no ar sozinho em ate ~5 min + o tempo do build.
# So faz sentido apontando para o SEU repositorio (fork), que voce controla.
set -euo pipefail

if [[ "$(id -u)" != "0" ]]; then
  echo "Rode com sudo:  sudo bash deploy/ativar-atualizacao-automatica.sh"
  exit 1
fi

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
USUARIO="${SUDO_USER:-$(stat -c '%U' "$DIR")}"
SYSTEMCTL="$(command -v systemctl)"
SA="zaphub-atualizar"

if [[ "${1:-}" = "desligar" ]]; then
  "$SYSTEMCTL" disable --now "$SA.timer" 2>/dev/null || true
  rm -f "/etc/systemd/system/$SA.timer"
  "$SYSTEMCTL" daemon-reload
  echo "Atualizacao automatica DESLIGADA. O botao Atualizar agora do painel continua funcionando."
  exit 0
fi

if [[ "$USUARIO" = "root" ]]; then
  echo "ERRO: a pasta $DIR pertence ao root. O ZapHub deve rodar com um usuario comum (veja deploy/instalar.sh)."
  exit 1
fi
if [[ ! -d "$DIR/.git" ]]; then
  echo "ERRO: $DIR nao e um clone do git. A atualizacao automatica baixa do GitHub; clone o repositorio primeiro."
  exit 1
fi
command -v flock >/dev/null 2>&1 || { echo "ERRO: falta o comando flock (pacote util-linux)."; exit 1; }
command -v curl  >/dev/null 2>&1 || { echo "ERRO: falta o curl (sudo apt install -y curl)."; exit 1; }

# o servidor precisa conseguir baixar do GitHub sem senha (repositorio publico, ou deploy key num privado)
if ! sudo -u "$USUARIO" -H git -C "$DIR" fetch --quiet 2>/dev/null; then
  echo "ERRO: o usuario $USUARIO nao consegue baixar do GitHub sem senha."
  echo "      Num repositorio privado, configure a deploy key primeiro:  bash deploy/configurar-git-vm.sh"
  exit 1
fi

# 1) sudo sem senha so para parar/iniciar/reiniciar o servico (e o "Atualizar agora" do painel)
bash "$DIR/deploy/regras-sudo.sh" "$USUARIO" "$SYSTEMCTL"

# 2) servico + timer (o timer chama o servico de mesmo nome)
sed -e "s|__DIR__|$DIR|g" -e "s|__USER__|$USUARIO|g" "$DIR/deploy/zaphub-atualizar.service.modelo" > "/etc/systemd/system/$SA.service"
cp "$DIR/deploy/zaphub-atualizar.timer" "/etc/systemd/system/$SA.timer"
"$SYSTEMCTL" daemon-reload
"$SYSTEMCTL" enable --now "$SA.timer"

echo ""
echo "=== Atualizacao automatica LIGADA ==="
echo "Usuario: $USUARIO   Pasta: $DIR"
echo "Checa o GitHub a cada 5 minutos. Proxima rodada:"
"$SYSTEMCTL" list-timers "$SA.timer" --no-pager | sed -n '1,2p'
echo ""
echo "Ver o que aconteceu nas atualizacoes:  journalctl -u $SA -n 50 --no-pager   (ou no painel: Manutencao > Logs)"
echo "Rodar agora sem esperar:              sudo systemctl start $SA   (ou no painel: Atualizar agora)"
echo "Desligar:                             sudo bash deploy/ativar-atualizacao-automatica.sh desligar"
