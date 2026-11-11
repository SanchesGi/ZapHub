#!/usr/bin/env bash
# minha versao: atualiza o ZapHub a partir do SEU GitHub SEM derrubar o site se algo falhar.
#   bash deploy/atualizar.sh          -> manual (mostra tudo)
#   bash deploy/atualizar.sh --auto   -> usado pelo timer a cada 5 min (silencioso quando nao ha novidade)
#   bash deploy/atualizar.sh --sem-verificacao -> EMERGENCIA: instala sem esperar a verificacao do GitHub
#
# Como funciona:
#   - compila a versao nova numa pasta separada (.next.new), enquanto o site ATUAL continua no ar;
#   - so troca se o build ficou COMPLETO (tem BUILD_ID e CSS) e se consegue parar o servico;
#   - depois de subir, confere se o site responde; se nao responder, VOLTA SOZINHO para a versao anterior;
#   - qualquer falha devolve o codigo para o commit que estava no ar (o servico nunca fica com codigo novo e build velho);
#   - a versao que falhou e anotada e nao e tentada de novo ate chegar um commit mais novo no GitHub.
# Arquivos de controle (fora do git): .versao-no-ar, .versao-falhou, .atualizando.lock
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"
AUTO=0; SEM_VERIFICACAO=0
for arg in "$@"; do
  case "$arg" in
    --auto) AUTO=1 ;;
    --sem-verificacao) SEM_VERIFICACAO=1 ;;  # emergencia, so no manual (ver "verificacao do GitHub" abaixo)
  esac
done
[ "$AUTO" = 1 ] && SEM_VERIFICACAO=0
# minha versao: o painel (Manutencao > Atualizar agora) deixa esta marca antes de iniciar o servico de atualizacao (zaphub-atualizar).
# Assim o --auto conta tudo o que fez (inclusive "nada novo" e "verificacao pendente") e tenta de novo uma versao
# que falhou antes, como no manual. O sudo continua sem senha (e o servico do systemd).
PAINEL=0
if [[ -f "$DIR/.atualizar-pelo-painel" ]]; then PAINEL=1; rm -f "$DIR/.atualizar-pelo-painel"; fi
QUIETO="$AUTO"; [[ "$PAINEL" = 1 ]] && QUIETO=0
# tudo o que este script escreve tambem vai para logs/atualizacao.log (o painel mostra em Manutencao > Logs)
mkdir -p "$DIR/logs"
LOG_ARQ="$DIR/logs/atualizacao.log"
if [[ -f "$LOG_ARQ" ]] && [[ "$(wc -c < "$LOG_ARQ")" -gt 2000000 ]]; then
  tail -n 3000 "$LOG_ARQ" > "$LOG_ARQ.tmp" && mv "$LOG_ARQ.tmp" "$LOG_ARQ"
fi
exec > >(tee -a "$LOG_ARQ") 2>&1
SERVICO="zaphub"
SYSTEMCTL="$(command -v systemctl || echo /usr/bin/systemctl)"
# minha versao: no automatico o sudo tem que ser SEM senha (sudoers do ativar-atualizacao-automatica.sh);
# no manual usa sudo normal (pede a sua senha) — assim da para atualizar a mao sem configurar nada antes.
sctl() { if [ "$AUTO" = 1 ]; then sudo -n "$SYSTEMCTL" "$@"; else sudo "$SYSTEMCTL" "$@"; fi; }
MARCA_NO_AR="$DIR/.versao-no-ar"
MARCA_FALHOU="$DIR/.versao-falhou"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

if [ ! -d "$DIR/.git" ]; then
  log "ERRO: esta pasta nao e um clone do seu repositorio git."
  log "Clone o seu repositorio e rode a partir dele:  git clone SEU_REPO zaphub && cd zaphub && bash deploy/instalar.sh"
  exit 1
fi

# uma atualizacao por vez (o timer e uma execucao manual nao podem se cruzar)
exec 9>"$DIR/.atualizando.lock"
if ! flock -n 9; then
  [[ "$QUIETO" = 1 ]] || log "Ja existe uma atualizacao em andamento. Tente de novo em alguns minutos."
  exit 0
fi

[[ "$QUIETO" = 1 ]] || log "Procurando novidades no seu GitHub..."
if ! git fetch --quiet; then
  log "AVISO: nao consegui falar com o GitHub (rede?). Tento de novo na proxima rodada."
  exit 0
fi
REMOTO="$(git rev-parse '@{u}' 2>/dev/null || echo '')"
if [ -z "$REMOTO" ]; then
  log "ERRO: este branch nao esta ligado a um remoto. Rode:  git branch --set-upstream-to=origin/main"
  exit 1
fi
LOCAL="$(git rev-parse @)"
# 1a vez com este script: considera no ar o commit atual da pasta
NO_AR="$(cat "$MARCA_NO_AR" 2>/dev/null || echo "$LOCAL")"
[ -f "$MARCA_NO_AR" ] || echo "$NO_AR" > "$MARCA_NO_AR"

if [ "$NO_AR" = "$REMOTO" ]; then
  [[ "$QUIETO" = 1 ]] || log "Ja esta na versao mais nova (${REMOTO:0:7}). Nada a fazer."
  exit 0
fi
# minha versao: a trava "ja falhou" vale so para o AUTOMATICO (nao tentar a mesma versao ruim para sempre).
# No manual, VOCE mandou atualizar: tenta de novo e so avisa que falhou antes.
if [ "$(cat "$MARCA_FALHOU" 2>/dev/null || echo '')" = "$REMOTO" ]; then
  if [[ "$AUTO" = 1 ]] && [[ "$PAINEL" = 0 ]]; then exit 0; fi
  log "Obs.: a versao ${REMOTO:0:7} falhou numa tentativa anterior; tentando de novo (manual)."
fi

# minha versao: so instala commit APROVADO na verificacao do GitHub (.github/workflows/verificacao.yml:
# tipos, testes, build, npm audit, gitleaks). Le o resultado pela API do GitHub com o mesmo token do git
# (precisa da permissao "Actions: Read-only" no token). Resultado: aprovada | pendente | reprovada | sem-token | sem-acesso
# minha versao: a VM baixa o codigo por deploy key (SSH), que nao consulta a API. O token fica em arquivo proprio;
# o token salvo do git continua valendo como alternativa.
ARQ_TOKEN="${XDG_CONFIG_HOME:-$HOME/.config}/zaphub/github-token"
verificacao_github() {
  local url slug token resp codigo
  url="$(git remote get-url origin)"
  slug="$(printf '%s' "$url" | sed -E 's#^(https://([^@/]*@)?github\.com/|git@github\.com:)##; s#\.git$##')"
  # GIT_TERMINAL_PROMPT=0: sem token salvo, nao fica parado pedindo usuario/senha (travaria o automatico)
  token=""
  if [ -r "$ARQ_TOKEN" ]; then token="$(tr -d '[:space:]' < "$ARQ_TOKEN")"; fi
  [ -n "$token" ] || token="$(printf 'protocol=https\nhost=github.com\n\n' | GIT_TERMINAL_PROMPT=0 git credential fill 2>/dev/null | sed -n 's/^password=//p' | head -1 || true)"
  # minha versao: sem token tenta assim mesmo — em repositorio PUBLICO a API de Actions responde sem autenticacao
  local auth=()
  [[ -n "$token" ]] && auth=(-H "Authorization: Bearer $token")
  resp="$(curl -s --max-time 20 -w '\n%{http_code}' ${auth[@]+"${auth[@]}"} -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/$slug/actions/runs?head_sha=$REMOTO&event=push&per_page=30" || true)"
  codigo="$(printf '%s' "$resp" | tail -n 1)"
  if [[ "$codigo" != "200" ]]; then
    if [[ -z "$token" ]]; then echo "sem-token"; else echo "sem-acesso"; fi
    return
  fi
  printf '%s' "$resp" | sed '$d' | node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const runs = (JSON.parse(s).workflow_runs || []).filter((r) => r.name === "Verificacao");
      if (!runs.length) return console.log("pendente");
      const r = runs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
      if (r.status !== "completed") return console.log("pendente");
      console.log(r.conclusion === "success" ? "aprovada" : "reprovada");
    });' 2>/dev/null || echo "sem-acesso"
}
if [ "$SEM_VERIFICACAO" = 1 ]; then
  log "ATENCAO: --sem-verificacao — instalando ${REMOTO:0:7} SEM conferir a verificacao do GitHub (emergencia)."
else
  RESULTADO="$(verificacao_github)"
  case "$RESULTADO" in
    aprovada)
      [[ "$QUIETO" = 1 ]] || log "Verificacao do GitHub: APROVADA para ${REMOTO:0:7}." ;;
    pendente)
      [[ "$QUIETO" = 1 ]] || log "A verificacao do GitHub de ${REMOTO:0:7} ainda nao terminou (leva uns 5-10 min). Tente de novo depois."
      exit 0 ;;
    reprovada)
      log "A verificacao do GitHub REPROVOU ${REMOTO:0:7}. Nao vou instalar. Veja o motivo em: https://github.com/$(git remote get-url origin | sed -E 's#^(https://([^@/]*@)?github\.com/|git@github\.com:)##; s#\.git$##')/actions"
      [ "$AUTO" = 1 ] && exit 0 || exit 1 ;;
    sem-token)
      log "Nao ha token para ler a verificacao do GitHub (a deploy key so baixa o codigo)."
      log "Crie um fine-grained token com 'Actions: Read-only' e guarde em $ARQ_TOKEN (passos em docs/INSTALACAO.md, secao Atualizar). Emergencia: bash deploy/atualizar.sh --sem-verificacao"
      [ "$AUTO" = 1 ] && exit 0 || exit 1 ;;
    *)
      log "O GitHub recusou a leitura da verificacao (token vencido ou sem a permissao 'Actions: Read-only')."
      log "Ajuste o token em github.com > Settings > Developer settings > Fine-grained tokens. Emergencia: bash deploy/atualizar.sh --sem-verificacao"
      [ "$AUTO" = 1 ] && exit 0 || exit 1 ;;
  esac
fi

log "Atualizando de ${NO_AR:0:7} para ${REMOTO:0:7}:"
git --no-pager log --oneline "${NO_AR}..${REMOTO}" 2>/dev/null | head -20 | sed 's/^/    /' || true

# falha em qualquer passo a partir daqui: devolve o codigo ao que esta no ar e anota a versao que falhou
FALHOU_EM=""
voltar_codigo() {
  local codigo=$?
  [ "$codigo" = 0 ] && return 0
  log "ERRO durante: ${FALHOU_EM:-atualizacao}. Voltando o codigo para ${NO_AR:0:7} (o site continua na versao atual)."
  rm -rf "$DIR/.next.new"
  git checkout -- package-lock.json 2>/dev/null || true
  git reset --hard --quiet "$NO_AR" || true
  npm install --no-audit --no-fund --legacy-peer-deps >/dev/null 2>&1 || true
  npx prisma generate >/dev/null 2>&1 || true
  [ "$AUTO" = 1 ] && echo "$REMOTO" > "$MARCA_FALHOU"  # so o automatico trava a versao; manual sempre pode tentar
  exit "$codigo"
}
trap voltar_codigo EXIT

FALHOU_EM="baixar o codigo (git pull)"
# o npm install reescreve o package-lock na VM; descarta essa mudanca local para o pull nao travar
git checkout -- package-lock.json 2>/dev/null || true
if [ "$LOCAL" != "$REMOTO" ]; then
  git pull --ff-only --quiet
fi

FALHOU_EM="instalar dependencias (npm install)"
npm install --no-audit --no-fund --legacy-peer-deps

FALHOU_EM="atualizar o banco (prisma db push)"
npx prisma generate
# sem --accept-data-loss: uma mudanca que apagaria dados e RECUSADA e a atualizacao para aqui
npx prisma db push --skip-generate

FALHOU_EM="compilar (build)"
log "Compilando a versao nova em .next.new (o site atual continua no ar)..."
rm -rf .next.new
export NODE_OPTIONS="--max-old-space-size=2048"
NEXT_DIST_DIR=.next.new npm run build

tem_css() { ls "$1"/static/chunks/*.css >/dev/null 2>&1 || ls "$1"/static/css/*.css >/dev/null 2>&1; }
if [ ! -f .next.new/BUILD_ID ] || ! tem_css .next.new; then
  FALHOU_EM="conferir o build (faltou BUILD_ID ou CSS, quase sempre falta de memoria; crie um swap)"
  false
fi

FALHOU_EM="parar o servico (no manual pede a sua senha; no automatico precisa do sudoers: sudo bash deploy/ativar-atualizacao-automatica.sh)"
log "Trocando para a versao nova (parada de poucos segundos; as sessoes do WhatsApp reconectam sozinhas)..."
sctl stop "$SERVICO"

FALHOU_EM="trocar a pasta do build"
rm -rf .next.old
[ -d .next ] && mv .next .next.old
mv .next.new .next
sctl start "$SERVICO"

# conferencia: HTTPS e o servidor principal; sem certificado (ou HTTPS desligado) o app atende em HTTP na PORT
# (o "|| true" importa: chave ausente faz o grep sair com erro, e com set -e isso derrubava o script
#  DEPOIS de subir a versao nova)
lerenv() { { grep -E "^$1=" .env 2>/dev/null || true; } | head -1 | sed -E "s/^$1=\"?([^\"]*)\"?.*/\1/"; }
PHTTPS="$(lerenv HTTPS_PORT)"; [ -z "$PHTTPS" ] && PHTTPS=3443
PHTTP="$(lerenv PORT)"; [[ -z "$PHTTP" ]] && PHTTP=3030
if [ "$(lerenv HTTPS_DISABLED)" != "true" ] && [ -f certificados/servidor.crt ] && [ -f certificados/servidor.key ]; then
  URL_TESTE="https://localhost:$PHTTPS/auth/login"
else
  URL_TESTE="http://localhost:$PHTTP/auth/login"
fi
no_ar() { curl -sk -o /dev/null -w '%{http_code}' --max-time 10 "$URL_TESTE" | grep -qE '^(200|30[0-9])$'; }
OK=0
for _ in $(seq 1 12); do sleep 5; if no_ar; then OK=1; break; fi; done

if [ "$OK" = 1 ]; then
  trap - EXIT
  echo "$REMOTO" > "$MARCA_NO_AR"
  rm -f "$MARCA_FALHOU"
  rm -rf .next.old
  log "=== Atualizado para ${REMOTO:0:7} e no ar em https://<IP-da-VM>:$PHTTPS ==="
  exit 0
fi

# nao respondeu em 1 minuto: volta sozinho para a versao anterior (codigo e build)
log "ERRO: a versao nova nao respondeu em 1 minuto. Voltando para ${NO_AR:0:7}..."
trap - EXIT
sctl stop "$SERVICO" || true
if [ -d .next.old ]; then rm -rf .next && mv .next.old .next; fi
git checkout -- package-lock.json 2>/dev/null || true
git reset --hard --quiet "$NO_AR"
npm install --no-audit --no-fund --legacy-peer-deps >/dev/null 2>&1 || true
npx prisma generate >/dev/null 2>&1 || true
sctl start "$SERVICO" || true
[ "$AUTO" = 1 ] && echo "$REMOTO" > "$MARCA_FALHOU"
log "Versao anterior restaurada. Veja o motivo no log:  journalctl -u $SERVICO -n 80 --no-pager"
exit 1
