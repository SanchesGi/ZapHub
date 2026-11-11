#!/usr/bin/env bash
# minha versao: deixa a VM baixar as atualizacoes do SEU repositorio PRIVADO SEM senha.
# Usa uma "deploy key" (chave SSH so-leitura) pela porta 443 (quase sempre liberada na saida).
# Roda UMA vez. Depois, atualizar o sistema e so:  bash deploy/atualizar.sh
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEY="$HOME/.ssh/zaphub-deploy"
# minha versao: o repositorio vem do proprio clone (origin); WA_REPO="dono/repo" sobrescreve
SLUG="${WA_REPO:-$(git -C "$DIR" remote get-url origin 2>/dev/null | sed -E 's#^(https://([^@/]*@)?github\.com/|git@github\.com:)##; s#\.git$##')}"
if [[ -z "$SLUG" ]]; then echo "ERRO: nao achei o repositorio (git remote origin). Rode com WA_REPO=dono/repo bash deploy/configurar-git-vm.sh"; exit 1; fi
REPO_SSH="git@github.com:$SLUG.git"

mkdir -p "$HOME/.ssh"; chmod 700 "$HOME/.ssh"

# 1) chave so-leitura (so cria se ainda nao existir)
if [ ! -f "$KEY" ]; then
  ssh-keygen -t ed25519 -f "$KEY" -N "" -C "zaphub-servidor" >/dev/null
  echo "Chave de implantacao criada."
else
  echo "Chave de implantacao ja existe — reaproveitando."
fi

# 2) ssh usa essa chave para o github, pela porta 443 (contorna firewall de saida na porta 22)
if ! grep -q "zaphub-deploy" "$HOME/.ssh/config" 2>/dev/null; then
  cat >> "$HOME/.ssh/config" <<EOF

Host github.com
  HostName ssh.github.com
  Port 443
  User git
  IdentityFile $KEY
  IdentitiesOnly yes
EOF
  chmod 600 "$HOME/.ssh/config"
fi

# 3) confia no host do github (porta 443)
ssh-keyscan -p 443 ssh.github.com >> "$HOME/.ssh/known_hosts" 2>/dev/null || true
sort -u "$HOME/.ssh/known_hosts" -o "$HOME/.ssh/known_hosts" 2>/dev/null || true

# 4) aponta o repositorio para SSH
git -C "$DIR" remote set-url origin "$REPO_SSH"

echo ""
echo "=================================================================="
echo " FALTA 1 PASSO (no navegador, UMA vez so):"
echo ""
echo " 1) Abra:  https://github.com/$SLUG/settings/keys/new"
echo " 2) Title:  servidor-zaphub"
echo " 3) NAO marque 'Allow write access' (deixa so-leitura)."
echo " 4) Cole a chave abaixo INTEIRA (uma linha so) no campo Key e salve:"
echo "------------------------------------------------------------------"
cat "$KEY.pub"
echo "------------------------------------------------------------------"
echo ""
echo " Depois de salvar no GitHub, teste e atualize:"
echo "   git -C \"$DIR\" fetch && echo GIT-OK"
echo "   bash deploy/atualizar.sh"
echo "=================================================================="
