#!/usr/bin/env bash
# minha versao: cria o banco e o usuario do ZapHub no MariaDB/MySQL do Linux.
# Usa a senha definida (ou uma aleatoria) e imprime a linha DATABASE_URL para colar no .env.
# Rode com: sudo bash deploy/configurar-mariadb.sh
set -euo pipefail

BANCO="${WA_DB_NAME:-zaphub}"
USUARIO="${WA_DB_USER:-zaphub}"
SENHA="${WA_DB_PASS:-}"
if [ -z "$SENHA" ]; then
  SENHA="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)"
fi

# acessa o MariaDB como root (no Linux, o root do sistema entra sem senha via socket)
SQL="
CREATE DATABASE IF NOT EXISTS \`$BANCO\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$USUARIO'@'127.0.0.1' IDENTIFIED BY '$SENHA';
CREATE USER IF NOT EXISTS '$USUARIO'@'localhost' IDENTIFIED BY '$SENHA';
ALTER USER '$USUARIO'@'127.0.0.1' IDENTIFIED BY '$SENHA';
ALTER USER '$USUARIO'@'localhost' IDENTIFIED BY '$SENHA';
GRANT ALL PRIVILEGES ON \`$BANCO\`.* TO '$USUARIO'@'127.0.0.1';
GRANT ALL PRIVILEGES ON \`$BANCO\`.* TO '$USUARIO'@'localhost';
FLUSH PRIVILEGES;
"

if command -v mariadb >/dev/null 2>&1; then CLI=mariadb; else CLI=mysql; fi
echo "$SQL" | "$CLI"

echo ""
echo "Banco '$BANCO' e usuario '$USUARIO' prontos."
echo "Coloque esta linha no .env (o instalar.sh ja faz isso se a senha for a padrao):"
echo "DATABASE_URL=\"mysql://$USUARIO:$SENHA@127.0.0.1:3306/$BANCO?connection_limit=20&pool_timeout=30\""
