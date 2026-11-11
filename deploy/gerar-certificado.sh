#!/usr/bin/env bash
# minha versao: gera o certificado HTTPS da plataforma no Linux (openssl nativo).
# Detecta os IPs da maquina e coloca todos no certificado, para abrir sem aviso por qualquer um deles.
# Gera tambem o certificado publico (para os clientes instalarem) e o instalador .bat com o IP certo.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERT="$DIR/certificados"
mkdir -p "$CERT" "$DIR/public"

# IPs da maquina (sem o 127.0.0.1) + nome do host
IPS="$(hostname -I 2>/dev/null || true)"
HOST="$(hostname 2>/dev/null || echo localhost)"
PRIMARIO="$(echo "$IPS" | awk '{print $1}')"
[ -z "$PRIMARIO" ] && PRIMARIO="127.0.0.1"

# monta a lista de enderecos do certificado (SAN)
# minha versao: nome da organizacao no certificado (so vale para CA nova; a existente e reaproveitada)
ORG_CA="${WA_CA_ORG:-ZapHub}"
SAN="DNS:localhost,DNS:$HOST,IP:127.0.0.1"
for ip in $IPS; do SAN="$SAN,IP:$ip"; done
echo "Gerando certificado para: $SAN"

# CA local (so se ainda nao existir — nao refaz para nao invalidar o que ja foi instalado nos clientes)
if [ ! -f "$CERT/ca.key" ] || [ ! -f "$CERT/ca.crt" ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 3650 \
    -keyout "$CERT/ca.key" -out "$CERT/ca.crt" \
    -subj "/O=$ORG_CA/CN=$ORG_CA CA local" \
    -addext "basicConstraints=critical,CA:TRUE" \
    -addext "keyUsage=critical,keyCertSign,cRLSign"
  echo "CA local criada."
else
  echo "CA local ja existe — reaproveitando (nao precisa reinstalar nos clientes)."
fi

# certificado do servidor, assinado pela CA, com os IPs atuais
openssl req -newkey rsa:2048 -nodes -sha256 \
  -keyout "$CERT/servidor.key" -out "$CERT/servidor.csr" \
  -subj "/O=$ORG_CA/CN=ZapHub ($HOST)"

cat > "$CERT/servidor.ext" <<EXT
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=$SAN
EXT

openssl x509 -req -in "$CERT/servidor.csr" -CA "$CERT/ca.crt" -CAkey "$CERT/ca.key" \
  -CAcreateserial -out "$CERT/servidor.crt" -days 825 -sha256 -extfile "$CERT/servidor.ext"
rm -f "$CERT/servidor.csr" "$CERT/servidor.ext"

# minha versao: porta HTTPS do .env (padrao 3443) e o nome real da CA (a existente e reaproveitada)
PORTA_HTTPS="$(grep -E '^HTTPS_PORT=' "$DIR/.env" 2>/dev/null | head -1 | sed -E 's/^HTTPS_PORT="?([0-9]+)"?.*/\1/' || true)"
[[ -n "$PORTA_HTTPS" ]] || PORTA_HTTPS=3443
CA_NOME="$(openssl x509 -in "$CERT/ca.crt" -noout -subject -nameopt RFC2253 2>/dev/null | sed -E 's/.*CN=([^,]*).*/\1/' || true)"
[[ -n "$CA_NOME" ]] || CA_NOME="$ORG_CA CA local"

# certificado publico para os clientes instalarem (so a parte publica da CA — nunca a chave)
cp "$CERT/ca.crt" "$DIR/public/certificado-zaphub.crt"

# instalador para os PCs Windows do setor, com o IP deste servidor.
# Baixa a CA pela porta HTTPS (unica alcançavel): como a conexao ainda NAO e confiavel neste momento,
# ignora a validacao SO para pegar o certificado e, depois de instalado, tudo passa a ser confiavel.
cat > "$DIR/public/instalar-certificado-zaphub.bat" <<BAT
@echo off
rem ZapHub - instala o certificado da plataforma neste computador (so para o seu usuario, sem administrador).
echo Instalando o certificado do ZapHub...
echo O Windows vai perguntar se confia em "$CA_NOME": clique em SIM.
powershell -NoProfile -ExecutionPolicy Bypass -Command "\$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; [Net.ServicePointManager]::ServerCertificateValidationCallback={\$true}; \$f=Join-Path \$env:TEMP 'certificado-zaphub.crt'; try { Invoke-WebRequest -UseBasicParsing 'https://$PRIMARIO:$PORTA_HTTPS/certificado-zaphub.crt' -OutFile \$f; certutil -user -addstore Root \$f | Out-Null; if (\$LASTEXITCODE -eq 0) { Write-Host 'Pronto! Feche o navegador e acesse https://$PRIMARIO:$PORTA_HTTPS' } else { Write-Host 'Nao instalado. Rode de novo.' } } catch { Write-Host ('Falha ao baixar: ' + \$_.Exception.Message) }"
echo.
pause
BAT

echo ""
echo "Certificado pronto. HTTPS em: https://$PRIMARIO:$PORTA_HTTPS"
echo "Clientes do setor instalam por: https://$PRIMARIO:$PORTA_HTTPS/instalar-certificado-zaphub.bat"
echo "(a primeira vez o navegador avisa 'nao seguro' so para baixar o .bat/.crt; depois de instalado, some)"
