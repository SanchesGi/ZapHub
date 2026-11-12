#!/usr/bin/env bash
# minha versao: instala o ZapHub num servidor Linux com UM comando.
#   cd /caminho/do/zaphub && bash deploy/instalar.sh
# O que faz: dependencias -> .env (com segredo novo) -> banco -> Prisma -> certificado HTTPS -> build -> servico.
# Idempotente: pode rodar de novo sem estragar o que ja existe. NAO roda como root (so usa sudo no servico/banco).
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"
USUARIO="$(id -un)"
echo "=== Instalando o ZapHub em: $DIR  (usuario: $USUARIO) ==="

if [ "$(id -u)" = "0" ]; then
  echo "NAO rode este instalador como root/sudo. Rode como o usuario normal; ele pede sudo só quando precisa."
  exit 1
fi

sudo_ok() { command -v sudo >/dev/null 2>&1; }

# 1) Node
if ! command -v node >/dev/null 2>&1; then
  echo "ERRO: Node.js nao encontrado. Instale o Node 22 (minimo 20.9; ex.: https://nodejs.org ou nvm) e rode de novo."
  exit 1
fi
NODE_OK="$(node -p 'const [a,b]=process.versions.node.split(".").map(Number); a>20||(a===20&&b>=9)?1:0')"
if [[ "$NODE_OK" != "1" ]]; then
  echo "ERRO: Node $(node -v) e muito antigo. Use o Node 22 (minimo 20.9, exigido pelo Next.js 16)."
  exit 1
fi
echo "Node: $(node -v)"

# programas usados por recursos: openssl (certificado) e ffmpeg (mensagem de voz e figurinha de video)
command -v openssl >/dev/null 2>&1 || echo "AVISO: openssl nao encontrado — o HTTPS nao sera gerado. Instale com: sudo apt install -y openssl"
command -v ffmpeg  >/dev/null 2>&1 || echo "AVISO: ffmpeg nao encontrado — mensagem de voz e figurinha de video nao funcionam. Instale com: sudo apt install -y ffmpeg"

# 2) dependencias do projeto
echo "--- Instalando dependencias (pode demorar)..."
npm install --no-audit --no-fund --legacy-peer-deps

# 3) .env (so cria se nao existir — nunca sobrescreve segredo/banco ja configurados)
set_env() { # set_env CHAVE VALOR  -> grava CHAVE="VALOR" no .env
  local k="$1"; shift; local v="$*"; local f="$DIR/.env"
  touch "$f"
  grep -vE "^${k}=" "$f" > "$f.tmp" 2>/dev/null || true
  printf '%s="%s"\n' "$k" "$v" >> "$f.tmp"
  mv "$f.tmp" "$f"
}
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"; [ -z "$IP" ] && IP="localhost"

if [ ! -f "$DIR/.env" ]; then
  echo "--- Criando .env novo..."
  [ -f "$DIR/.env.example" ] && cp "$DIR/.env.example" "$DIR/.env" || touch "$DIR/.env"
  set_env AUTH_SECRET "$(openssl rand -base64 32)"
  set_env NODE_ENV production
  set_env PORT 3030
  set_env HTTPS_PORT 3443
  set_env BASE_URL "https://$IP:3443"
  set_env NEXTAUTH_URL "https://$IP:3443"
  set_env NEXT_PUBLIC_APP_URL "https://$IP:3443"
  set_env NEXT_PUBLIC_API_URL "https://$IP:3443/api"
  set_env TZ "America/Sao_Paulo"
  set_env DEFAULT_LANGUAGE "pt-BR"
  set_env ENABLE_AUTO_UPDATE_CHECK "true"

  # banco: se o MariaDB/MySQL estiver instalado, cria o usuario e ja aponta o DATABASE_URL
  if command -v mariadb >/dev/null 2>&1 || command -v mysql >/dev/null 2>&1; then
    if sudo_ok; then
      echo "--- Configurando o banco (MariaDB/MySQL)..."
      WA_DB_PASS="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)"
      # minha versao: o mesmo nome de banco/usuario do configurar-mariadb.sh (WA_DB_NAME / WA_DB_USER, padrao zaphub)
      WA_DB_NAME="${WA_DB_NAME:-zaphub}"; WA_DB_USER="${WA_DB_USER:-zaphub}"
      if WA_DB_PASS="$WA_DB_PASS" WA_DB_NAME="$WA_DB_NAME" WA_DB_USER="$WA_DB_USER" sudo -E bash "$DIR/deploy/configurar-mariadb.sh" >/dev/null 2>&1; then
        set_env DATABASE_URL "mysql://$WA_DB_USER:$WA_DB_PASS@127.0.0.1:3306/$WA_DB_NAME?connection_limit=20&pool_timeout=30"
        echo "Banco configurado."
      else
        echo "AVISO: nao consegui configurar o banco automaticamente. Rode:  sudo bash deploy/configurar-mariadb.sh"
        echo "       e cole a linha DATABASE_URL no .env."
      fi
    fi
  else
    echo "AVISO: MariaDB/MySQL nao encontrado. Instale (sudo apt install -y mariadb-server),"
    echo "       rode  sudo bash deploy/configurar-mariadb.sh  e ajuste o DATABASE_URL no .env."
  fi
else
  echo "--- .env ja existe — mantendo o que esta la."
fi

# 4) Prisma (cliente + tabelas)
echo "--- Preparando o banco (Prisma)..."
npx prisma generate
npx prisma db push

# 4b) Super Administrador: a conta com que voce entra no painel pela primeira vez.
# Vem de WA_ADMIN_EMAIL/WA_ADMIN_PASS (instalacao sem perguntas) ou, se ainda nao existe nenhum, e perguntada aqui.
ADMIN_EMAIL="${WA_ADMIN_EMAIL:-}"
ADMIN_SENHA="${WA_ADMIN_PASS:-}"
ADMIN_NOME="${WA_ADMIN_NAME:-}"
# a senha nao fica no ambiente do resto da instalacao (npm install/build e scripts de pacotes conseguiriam le-la)
unset WA_ADMIN_PASS
if [[ -z "$ADMIN_EMAIL" || -z "$ADMIN_SENHA" ]]; then
  QTD_ADMIN="$(node scripts/setup-admin.js --contar 2>/dev/null || echo "?")"
  if [[ "$QTD_ADMIN" = "0" ]]; then
    if [[ -t 0 ]]; then
      echo ""
      echo "=== Conta do Super Administrador ==="
      echo "Com ela voce entra no painel e cria as contas da equipe. Guarde o e-mail e a senha."
      read -r -p "Seu nome: " ADMIN_NOME
      while :; do
        read -r -p "E-mail de acesso: " ADMIN_EMAIL
        ADMIN_EMAIL="$(printf '%s' "$ADMIN_EMAIL" | tr -d '[:space:]')"
        [[ "$ADMIN_EMAIL" =~ ^[^@]+@[^@]+\.[^@]+$ ]] && break
        echo "E-mail invalido. Exemplo: voce@empresa.com"
      done
      while :; do
        read -r -s -p "Senha (minimo 8 caracteres): " ADMIN_SENHA; echo
        if (( ${#ADMIN_SENHA} < 8 )); then echo "Senha curta demais."; continue; fi
        read -r -s -p "Repita a senha: " ADMIN_SENHA2; echo
        [[ "$ADMIN_SENHA" == "$ADMIN_SENHA2" ]] && break
        echo "As senhas nao conferem. Tente de novo."
      done
      ADMIN_SENHA2=""
    else
      echo "AVISO: nenhum Super Administrador criado (instalacao sem terminal interativo)."
      echo "       Crie depois, na pasta do sistema:"
      echo "       read -rsp 'Senha: ' S; echo; ZAPHUB_ADMIN_SENHA=\"\$S\" node scripts/setup-admin.js voce@empresa.com"
    fi
  elif [[ "$QTD_ADMIN" != [0-9]* ]]; then
    echo "AVISO: nao consegui conferir se ja existe um Super Administrador (o banco respondeu?)."
    echo "       Sem ele, o primeiro cadastro em /auth/register vira Super Administrador. Crie a conta agora, na pasta do sistema:"
    echo "       read -rsp 'Senha: ' S; echo; ZAPHUB_ADMIN_SENHA=\"\$S\" node scripts/setup-admin.js voce@empresa.com"
  fi
fi
if [[ -n "$ADMIN_EMAIL" && -n "$ADMIN_SENHA" ]]; then
  echo "--- Criando o Super Administrador $ADMIN_EMAIL..."
  # a senha vai por variavel de ambiente (na linha de comando ela apareceria na lista de processos)
  ZAPHUB_ADMIN_SENHA="$ADMIN_SENHA" ZAPHUB_ADMIN_NOME="$ADMIN_NOME" node scripts/setup-admin.js "$ADMIN_EMAIL" \
    || echo "AVISO: nao foi possivel criar o Super Administrador agora. Veja docs/INSTALACAO.md (Primeira conta de administrador)."
fi
ADMIN_SENHA=""

# 5) certificado HTTPS (com os IPs desta VM)
if command -v openssl >/dev/null 2>&1; then
  echo "--- Gerando o certificado HTTPS..."
  bash "$DIR/deploy/gerar-certificado.sh" || echo "AVISO: falha ao gerar o certificado (segue sem HTTPS)."
fi

# 6) build de producao
# minha versao: garante swap antes do build (o Next consome memoria; sem swap a VM mata o build -> tela quebrada)
if sudo_ok && ! sudo swapon --show 2>/dev/null | grep -q .; then
  TOTKB="$(awk '/MemTotal/{print $2}' /proc/meminfo 2>/dev/null || echo 0)"
  if [ "${TOTKB:-0}" -lt 3000000 ]; then
    echo "--- Pouca RAM e sem swap: criando 2 GB de swap para o build nao estourar..."
    if sudo dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none && sudo chmod 600 /swapfile && sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile; then
      grep -q '/swapfile' /etc/fstab 2>/dev/null || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
      echo "Swap de 2 GB criado."
    else
      echo "AVISO: nao consegui criar o swap. Se o build falhar por falta de memoria, crie manualmente."
    fi
  fi
fi
echo "--- Compilando (build)..."
export NODE_OPTIONS="--max-old-space-size=2048"
npm run build

# 7) servico (systemd): reinicia sozinho se cair e sobe no boot
if sudo_ok && command -v systemctl >/dev/null 2>&1; then
  SERVICO="zaphub"
  echo "--- Instalando o servico $SERVICO (systemd)..."
  NODE_BIN="$(command -v node)"
  case "$NODE_BIN" in
    /home/*|/root/*)
      echo "AVISO: o Node esta em '$NODE_BIN' (dentro de /home)."
      echo "       Em servidores com SELinux o servico pode falhar (203/EXEC). Se falhar, instale o Node no sistema:"
      echo "       sudo dnf module install nodejs:22   (ou apt install nodejs)  e rode este instalador de novo." ;;
  esac
  TMP="$(mktemp)"
  sed -e "s|__DIR__|$DIR|g" -e "s|__USER__|$USUARIO|g" -e "s|__NODE__|$NODE_BIN|g" "$DIR/deploy/zaphub.service.modelo" > "$TMP"
  sudo cp "$TMP" "/etc/systemd/system/$SERVICO.service"
  rm -f "$TMP"
  sudo systemctl daemon-reload
  sudo systemctl enable "$SERVICO"
  sudo systemctl restart "$SERVICO"
  echo "Servico instalado. Status:  sudo systemctl status $SERVICO   |   Log:  journalctl -u $SERVICO -f"
else
  echo "AVISO: sem sudo/systemctl — o servico nao foi instalado."
  echo "       Para rodar manual:  NODE_ENV=production npm start"
fi

# 7b) firewall LOCAL: libera SO a porta HTTPS (unica usada na rede). O HTTP fica so no localhost.
# Obs.: pode haver um firewall EXTERNO (fora da VM) que so libera a 3443 — isso nao se controla por aqui.
if sudo_ok; then
  P_HTTPS="$(grep -E '^HTTPS_PORT=' "$DIR/.env" 2>/dev/null | head -1 | sed -E 's/^HTTPS_PORT="?([0-9]+)"?.*/\1/')"; [ -z "$P_HTTPS" ] && P_HTTPS=3443
  if command -v firewall-cmd >/dev/null 2>&1; then
    echo "--- Liberando a porta $P_HTTPS no firewall local (firewalld)..."
    sudo firewall-cmd --permanent --add-port="$P_HTTPS"/tcp >/dev/null 2>&1 || true
    sudo firewall-cmd --reload >/dev/null 2>&1 || true
  elif command -v ufw >/dev/null 2>&1; then
    echo "--- Liberando a porta $P_HTTPS no firewall local (ufw)..."
    sudo ufw allow "$P_HTTPS"/tcp >/dev/null 2>&1 || true
  else
    echo "AVISO: nao achei firewalld/ufw. Se os outros PCs nao abrirem, libere a porta $P_HTTPS no firewall."
  fi
fi

# 8) atualizacao automatica (cada push no main do GitHub entra no ar sozinho). DESLIGADA por padrao: ligue com WA_AUTO_UPDATE=1
#    (so faz sentido apontando para o SEU fork, que voce controla).
if [[ "${WA_AUTO_UPDATE:-0}" = "1" ]] && sudo_ok && command -v systemctl >/dev/null 2>&1; then
  echo "--- Ligando a atualizacao automatica (a cada 5 min)..."
  git rev-parse HEAD > "$DIR/.versao-no-ar" 2>/dev/null || true
  sudo bash "$DIR/deploy/ativar-atualizacao-automatica.sh" \
    || echo "AVISO: atualizacao automatica nao ligada (veja a mensagem acima). Depois:  sudo bash deploy/ativar-atualizacao-automatica.sh"
fi

echo ""
echo "=== ZapHub instalado ==="
echo "Acesse (seguro):  https://$IP:3443"
echo "Certificado p/ os PCs do setor:  https://$IP:3443/instalar-certificado-zaphub.bat"
echo "Admin (se ainda nao existe):  node scripts/setup-admin.js email@empresa.com SENHA"
