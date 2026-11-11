# Instalação do ZapHub

Guia completo para instalar o ZapHub num servidor Linux, do zero até o primeiro WhatsApp conectado, e para mantê-lo atualizado, com backup e migração.

Sumário:

1. [Requisitos](#1-requisitos)
2. [Instalar os programas do sistema](#2-instalar-os-programas-do-sistema)
3. [Baixar o ZapHub](#3-baixar-o-zaphub)
4. [Rodar o instalador](#4-rodar-o-instalador)
5. [Banco de dados](#5-banco-de-dados)
6. [Conferir o .env](#6-conferir-o-env)
7. [HTTPS](#7-https)
8. [Firewall](#8-firewall)
9. [Primeira conta de administrador](#9-primeira-conta-de-administrador)
10. [Conectar o WhatsApp](#10-conectar-o-whatsapp)
11. [Manutenção pelo painel e pasta de mídia](#11-manutenção-pelo-painel-e-pasta-de-mídia)
12. [Atualizar](#12-atualizar)
13. [Backup e migração para outra máquina](#13-backup-e-migração-para-outra-máquina)
14. [Comandos do dia a dia](#14-comandos-do-dia-a-dia)
15. [Problemas comuns](#15-problemas-comuns)
16. [Desenvolvimento local](#16-desenvolvimento-local)

---

## 1. Requisitos

| Item | Detalhe |
| :--- | :--- |
| Sistema | Linux com systemd: Ubuntu, Debian ou derivados do RHEL (AlmaLinux, Rocky). Usuário comum com `sudo`. |
| Node.js | **22** (mínimo 20.9, exigido pelo Next.js 16). |
| Banco | MariaDB 10.6+ ou MySQL 8. |
| git | Baixa o sistema e as atualizações. |
| openssl | Gera o segredo do `.env` e o certificado HTTPS. |
| ffmpeg | Converte as **mensagens de voz** gravadas no painel e faz figurinhas de vídeo. |
| curl e util-linux (`flock`) | Usados pela atualização automática. |
| Memória | 2 a 3 GB de RAM, ou swap. A compilação (`npm run build`) consome bastante memória; o instalador cria 2 GB de swap se a máquina tiver menos de ~3 GB e nenhum swap. |
| Disco | Algumas centenas de MB para o sistema, mais o espaço das mídias recebidas (cresce com o uso). |
| Rede | Saída para a internet (WhatsApp, npm e GitHub). Entrada na porta do painel (3443 por padrão) para quem vai usar. |

## 2. Instalar os programas do sistema

O instalador do ZapHub **confere** esses programas, mas **não instala** nenhum deles.

### Ubuntu / Debian

```bash
sudo apt update
sudo apt install -y git curl openssl ffmpeg mariadb-server util-linux
# Node.js 22 (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # tem que mostrar v22.x (ou no mínimo v20.9)
```

### AlmaLinux / Rocky (RHEL 9 e parecidos)

```bash
sudo dnf install -y git curl openssl util-linux mariadb-server
sudo systemctl enable --now mariadb
# Node.js 22 instalado no sistema (fora do /home, por causa do SELinux)
sudo dnf module install -y nodejs:22
# ffmpeg vem do RPM Fusion (precisa do EPEL e do CRB)
sudo dnf install -y epel-release
sudo dnf config-manager --set-enabled crb
sudo dnf install -y https://mirrors.rpmfusion.org/free/el/rpmfusion-free-release-$(rpm -E %rhel).noarch.rpm
sudo dnf install -y ffmpeg
```

> Não instale o Node com `nvm` dentro do `/home` em servidores com SELinux: o serviço falha com `203/EXEC`. Veja [Problemas comuns](#15-problemas-comuns).

## 3. Baixar o ZapHub

Entre com o **usuário comum** que vai rodar o sistema (não use root) e clone o repositório:

```bash
cd ~
git clone https://github.com/SanchesGi/ZapHub.git zaphub
cd zaphub
```

A pasta pode ter outro nome; os scripts descobrem sozinhos onde estão. O serviço vai rodar com o usuário dono da pasta.

## 4. Rodar o instalador

```bash
bash deploy/instalar.sh
```

**Não rode com `sudo`** (o script recusa root). Ele pede a senha do `sudo` só nos passos que precisam.

O que o `deploy/instalar.sh` faz, em ordem:

1. Confere o Node e avisa se faltar o `openssl` ou o `ffmpeg`.
2. Instala as dependências (`npm install --legacy-peer-deps`).
3. Se **não existir** `.env`: copia o `.env.example` e grava `AUTH_SECRET` novo, `NODE_ENV=production`, `PORT=3005`, `HTTPS_PORT=3443`, `BASE_URL`, `NEXT_PUBLIC_APP_URL` e `NEXT_PUBLIC_API_URL` com o primeiro IP da máquina, `TZ=America/Sao_Paulo`, `DEFAULT_LANGUAGE=pt-BR` e `ENABLE_AUTO_UPDATE_CHECK=true`. Se o MariaDB/MySQL estiver instalado, cria o banco e o usuário com senha aleatória e grava o `DATABASE_URL`. Se o `.env` já existe, **não mexe nele**.
4. Cria as tabelas (`npx prisma generate` e `npx prisma db push`).
5. Se ainda não existe nenhum Super Administrador, **pergunta o nome, o e-mail e a senha** dele (a senha é digitada duas vezes, sem aparecer na tela, com no mínimo 8 caracteres) e cria a conta. É com ela que você entra no painel. Sem terminal interativo, use `WA_ADMIN_EMAIL` e `WA_ADMIN_PASS`.
6. Gera o certificado HTTPS com os IPs da máquina (`deploy/gerar-certificado.sh`).
7. Cria 2 GB de swap em `/swapfile` se houver pouca RAM e nenhum swap.
8. Compila (`npm run build`).
9. Instala e liga o serviço `zaphub` no systemd (sobe no boot e reinicia sozinho se cair).
10. Libera a porta HTTPS no firewall local (firewalld ou ufw).
11. Liga a atualização automática (a cada 5 minutos) só se você passar `WA_AUTO_UPDATE=1`. Por padrão ela fica desligada e você atualiza pelo painel. Veja [Atualizar](#12-atualizar).

Pode rodar de novo quantas vezes precisar: o que já está configurado é mantido.

Variáveis aceitas pelo instalador:

| Variável | Para quê |
| :--- | :--- |
| `WA_ADMIN_EMAIL`, `WA_ADMIN_PASS` e `WA_ADMIN_NAME` | Criam o Super Administrador sem perguntar (ou promovem um usuário que já existe com esse e-mail). Úteis em instalação automatizada. |
| `WA_AUTO_UPDATE=1` | Liga a atualização automática. |

Instalação sem perguntas (a senha não fica no histórico do terminal):

```bash
read -rsp "Senha do administrador: " WA_ADMIN_PASS; echo
WA_ADMIN_EMAIL=voce@empresa.com WA_ADMIN_PASS="$WA_ADMIN_PASS" bash deploy/instalar.sh
```

No fim ele mostra o endereço de acesso: `https://IP_DO_SERVIDOR:3443`.

## 5. Banco de dados

Se o MariaDB/MySQL já estava instalado, o instalador configurou o banco sozinho. Para fazer à mão (ou se ele avisou que não conseguiu):

```bash
sudo bash deploy/configurar-mariadb.sh
```

O script entra no banco como root (pelo socket do sistema), cria o banco `zaphub` (utf8mb4) e o usuário `zaphub` em `127.0.0.1` e `localhost`, com uma senha aleatória, e mostra a linha pronta para o `.env`:

```
DATABASE_URL="mysql://zaphub:SENHA@127.0.0.1:3306/zaphub?connection_limit=20&pool_timeout=30"
```

Para escolher nomes ou senha: `sudo WA_DB_NAME=zaphub WA_DB_USER=zaphub WA_DB_PASS='senha-forte' bash deploy/configurar-mariadb.sh`.

Depois de colar o `DATABASE_URL` no `.env`, crie as tabelas e rode o instalador de novo:

```bash
npx prisma db push
bash deploy/instalar.sh
```

Banco em outro servidor: aponte o `DATABASE_URL` para ele e garanta que o usuário tenha todas as permissões no banco.

## 6. Conferir o .env

Abra o `.env` e confira os endereços. O instalador usa o **primeiro** IP da máquina; se ela tiver mais de um, ou se você vai usar um nome (DNS), ajuste:

```bash
nano .env
```

- `BASE_URL`, `NEXTAUTH_URL`, `NEXT_PUBLIC_APP_URL` e `NEXT_PUBLIC_API_URL` devem ter o endereço pelo qual as pessoas acessam (ex.: `https://192.168.0.10:3443`).
- **`NEXTAUTH_URL` não é preenchido pelo instalador**: ele fica com o valor de exemplo (`https://SEU_IP_OU_DOMINIO:3443`). Troque pelo endereço real.
- Variáveis `NEXT_PUBLIC_*` entram na compilação: depois de mudar, rode `bash deploy/reconstruir.sh`.
- Mudou outras variáveis? Basta `sudo systemctl restart zaphub`.

Todas as variáveis estão explicadas em [CONFIGURACAO.md](CONFIGURACAO.md).

**Guarde uma cópia do `AUTH_SECRET` (e do `ENCRYPTION_KEY`, se usar) num lugar seguro.** As credenciais do WhatsApp ficam cifradas no banco com essa chave: sem ela, um backup do banco não reconecta as sessões.

## 7. HTTPS

O HTTPS é necessário: sem ele o navegador bloqueia o **microfone** (mensagem de voz) e as **notificações**. Há dois caminhos.

### Opção A: certificado próprio (rede interna, acesso por IP)

É o padrão do instalador. O `deploy/gerar-certificado.sh`:

- cria uma autoridade certificadora (CA) local em `certificados/ca.crt` e `ca.key`, válida por 10 anos (só na primeira vez; depois reaproveita);
- gera o certificado do servidor (`certificados/servidor.crt` e `.key`, válido por 825 dias) com `localhost`, o nome da máquina, `127.0.0.1` e todos os IPs dela;
- publica a parte pública da CA em `public/certificado-zaphub.crt` e um instalador para Windows em `public/instalar-certificado-zaphub.bat`, já com o IP do servidor.

Com o certificado presente, o servidor atende em **HTTPS na porta 3443** (rede) e o HTTP (porta `PORT`) fica **só em 127.0.0.1**, redirecionando para o HTTPS. O acesso é sempre `https://IP:3443`.

**Instalar o certificado nos computadores (Windows)**, uma vez por computador:

1. Abra `https://IP_DO_SERVIDOR:3443/instalar-certificado-zaphub.bat` no navegador. Na primeira vez ele avisa "não seguro": continue só para baixar o arquivo.
2. Execute o `.bat`. Ele baixa a CA e a instala para o usuário (não precisa de administrador). O Windows pergunta se confia no certificado: clique em **Sim**.
3. Feche e abra o navegador. O aviso some.

Outros sistemas: baixe `https://IP_DO_SERVIDOR:3443/certificado-zaphub.crt` e importe como autoridade certificadora confiável (no Firefox, em Configurações > Privacidade e Segurança > Certificados, se ele não usar o repositório do sistema).

Refaça o certificado quando o IP mudar ou perto do vencimento (a CA é mantida, então os computadores não precisam reinstalar):

```bash
bash deploy/gerar-certificado.sh
sudo systemctl restart zaphub
```

> A pasta `certificados/` contém a chave da CA. Ela não vai para o git; proteja-a e inclua no backup.

### Opção B: domínio com proxy reverso (Nginx ou Caddy) e Let's Encrypt

Use quando o painel tiver um nome público (ex.: `zap.empresa.com.br`). O proxy cuida do HTTPS e o ZapHub atende em HTTP local.

1. No `.env`:

   ```
   HTTPS_DISABLED="true"
   BASE_URL="https://zap.empresa.com.br"
   NEXTAUTH_URL="https://zap.empresa.com.br"
   NEXT_PUBLIC_APP_URL="https://zap.empresa.com.br"
   NEXT_PUBLIC_API_URL="https://zap.empresa.com.br/api"
   ```

   Recompile e reinicie: `bash deploy/reconstruir.sh`.

   Com `HTTPS_DISABLED="true"` o servidor atende HTTP na porta `PORT` (3005 numa instalação feita pelo instalador) **em todas as interfaces**. Bloqueie essa porta no firewall para que só o proxy chegue nela.

2. **Caddy** (obtém o certificado sozinho), em `/etc/caddy/Caddyfile`:

   ```
   zap.empresa.com.br {
       reverse_proxy 127.0.0.1:3005
   }
   ```

3. **Nginx**, com o certificado do Let's Encrypt (`sudo certbot --nginx -d zap.empresa.com.br`):

   ```nginx
   server {
       listen 443 ssl;
       server_name zap.empresa.com.br;
       # linhas ssl_certificate geradas pelo certbot

       client_max_body_size 100m;   # envio de mídia

       location / {
           proxy_pass http://127.0.0.1:3005;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;     # tempo real (Socket.IO em /api/socket/io)
           proxy_set_header Connection "upgrade";
           proxy_set_header Host $host;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_read_timeout 120s;
       }
   }
   ```

O tempo real só aceita conexões vindas do endereço em `BASE_URL` ou `NEXTAUTH_URL` (além de endereços de rede local), por isso os dois precisam ter o domínio exato.

## 8. Firewall

- O instalador libera a porta HTTPS (`HTTPS_PORT`, 3443) no firewall **local** (firewalld ou ufw). Se não achar nenhum dos dois, ele avisa.
- Se o servidor está num provedor de nuvem ou atrás de outro firewall, libere a mesma porta lá também (isso não dá para fazer pelo instalador).
- Libere só para quem precisa (a rede da empresa, uma VPN). Não é preciso expor a porta HTTP.
- Com proxy reverso (opção B), libere 80 e 443 para o proxy e feche a 3443 e a `PORT`.

```bash
# ufw
sudo ufw allow 3443/tcp
# firewalld
sudo firewall-cmd --permanent --add-port=3443/tcp && sudo firewall-cmd --reload
```

## 9. Primeira conta de administrador

O papel mais alto é o **Super Administrador** (`SUPERADMIN`). Há três jeitos de criar o primeiro:

1. **No instalador** (recomendado): ele pergunta nome, e-mail e senha quando ainda não existe nenhum Super Administrador (passo 4).
2. **Pelo terminal**, a qualquer momento, na pasta do sistema (a senha vai por variável, para não aparecer na lista de processos nem no histórico):

   ```bash
   read -rsp "Senha: " S; echo
   ZAPHUB_ADMIN_SENHA="$S" ZAPHUB_ADMIN_NOME="Seu nome" node scripts/setup-admin.js voce@empresa.com
   ```

   Se o e-mail já existe, o usuário só é promovido a Super Administrador (a senha não muda). Senha nova: no mínimo 8 caracteres.
3. **Pelo primeiro cadastro**: enquanto não houver nenhum usuário, quem se cadastrar em `/auth/register` vira Super Administrador. Depois disso o cadastro público fica fechado (pode ser aberto em Configurações).

> Atenção: até existir o primeiro usuário, **qualquer pessoa** que alcance o painel pode se cadastrar como Super Administrador. Por isso prefira os jeitos 1 ou 2, ou crie a conta logo após instalar.

No primeiro acesso, cada usuário precisa aceitar os Termos de Uso e a Política de Privacidade. Depois, ative a verificação em duas etapas (2FA) do Super Administrador no rodapé do menu lateral.

Perdeu o celular do 2FA? No servidor: `node scripts/desativar-2fa.js voce@empresa.com`.

## 10. Conectar o WhatsApp

1. Entre no painel e abra **Sessões / QR**.
2. Crie uma sessão (um nome e, se quiser, um ID próprio com letras, números e hífens).
3. Conecte: escaneie o QR Code no celular (WhatsApp > **Aparelhos conectados** > Conectar um aparelho) ou peça o **código de pareamento** e digite-o no celular.
4. Quando o status ficar conectado, as conversas começam a aparecer em **Conversas**.

Cada número é uma sessão. As sessões reconectam sozinhas depois de reiniciar o serviço ou atualizar.

## 11. Manutenção pelo painel e pasta de mídia

Para fazer a manutenção pelo painel (menu **Manutenção**, só Super Administrador), sem entrar no servidor, rode **uma vez**:

```bash
cd ~/zaphub
sudo bash deploy/preparar-vm.sh
```

O `deploy/preparar-vm.sh`:

1. cria a pasta de mídia **`/var/lib/zaphub/midia`** (fora do `/home`), com dono = usuário do sistema;
2. instala o serviço `zaphub-atualizar` (usado pelo botão "Atualizar agora"), **sem** ligar a verificação de 5 em 5 minutos;
3. grava `/etc/sudoers.d/zaphub`, que libera sem senha, só para o usuário do sistema, estes comandos e nada mais: `systemctl stop|start|restart zaphub` e `systemctl start --no-block zaphub-atualizar`.

Depois, no painel, **Manutenção**:

- **Armazenamento**: escolha `/var/lib/zaphub/midia` como pasta das mídias e mova os arquivos antigos (por padrão as mídias ficam em `data/media`, dentro da pasta do sistema). A pasta escolhida precisa ser um caminho absoluto simples, fora do sistema e do próprio app, e estar vazia ou já ser uma pasta de mídia do ZapHub.
- **Sistema**: versão, atualizar agora, reiniciar o serviço, relógio do servidor.
- **Logs**: do serviço e das atualizações.
- **Espaço**: o que ocupa o disco (mídias, versão anterior, caches, temporários de áudio, log de atualização) e limpeza com um clique. Mídias podem ser apagadas a partir de 7 dias de idade.

Quando falta algum preparo, o próprio painel mostra o comando a rodar no servidor.

## 12. Atualizar

Há três formas. Todas usam o `deploy/atualizar.sh`, que:

- baixa a versão nova do GitHub (`git pull --ff-only` no branch atual, normalmente `main`);
- **só instala se a verificação do GitHub (workflow "Verificacao": tipos, testes, build, `npm audit`, gitleaks) aprovou aquele commit**;
- atualiza dependências e banco (`prisma db push`, que **recusa** mudanças que apagariam dados);
- compila em `.next.new` com o sistema ainda no ar e só troca se o build ficou completo;
- reinicia (alguns segundos fora do ar; as sessões do WhatsApp reconectam sozinhas) e confere se o site respondeu em até 1 minuto; se não, **volta sozinho** para a versão anterior;
- grava tudo em `logs/atualizacao.log`.

### Token para ler a verificação do GitHub

Sem um token, o `atualizar.sh` não instala nada (avisa "sem-token"). Crie um token **fine-grained** em github.com > Settings > Developer settings > Fine-grained tokens:

- instalando do repositório público `SanchesGi/ZapHub`: acesso **Public repositories (read-only)** basta;
- instalando de um fork ou repositório privado seu: selecione só esse repositório e dê a permissão **Actions: Read-only** (no fork, o GitHub Actions precisa estar ativado para a verificação rodar).

Guarde o token no servidor, com o usuário do sistema:

```bash
mkdir -p ~/.config/zaphub && (umask 077; read -rs -p "Token: " T; echo "$T" > ~/.config/zaphub/github-token); echo
```

Emergência (instalar sem conferir a verificação, só no modo manual): `bash deploy/atualizar.sh --sem-verificacao`.

### 1) Pelo painel

**Manutenção > Sistema > Atualizar agora** (precisa do `preparar-vm.sh`, seção 11). O andamento aparece em **Manutenção > Logs**. O Super Administrador também recebe uma notificação quando há versão nova (desligue com `ENABLE_AUTO_UPDATE_CHECK="false"`).

### 2) Pelo terminal

```bash
cd ~/zaphub
bash deploy/atualizar.sh
```

Pede a senha do `sudo` para parar e iniciar o serviço.

### 3) Atualização automática

A cada 5 minutos o servidor procura versão nova e aplica sozinho. **Com ela ligada, toda versão nova publicada no branch que você segue (e aprovada na verificação) entra no ar sem você agir.** Se prefere decidir quando atualizar, deixe desligada e use o painel.

```bash
sudo bash deploy/ativar-atualizacao-automatica.sh            # liga (instala o timer e as regras do sudo)
sudo bash deploy/ativar-atualizacao-automatica.sh desligar   # desliga
sudo systemctl start zaphub-atualizar                        # roda agora, sem esperar
journalctl -u zaphub-atualizar -n 50 --no-pager              # o que aconteceu
```

O script exige que o usuário do sistema consiga fazer `git fetch` sem senha. Com o repositório público por HTTPS isso já funciona. Para um repositório **privado**, configure uma deploy key (chave SSH só de leitura): o `deploy/configurar-git-vm.sh` faz isso, mas tem o endereço do repositório do autor fixo no script; ajuste a variável `REPO_SSH` antes de usar.

No automático, uma versão que falhou não é tentada de novo até chegar um commit mais novo. Pelo painel ou pelo terminal, ela é tentada de novo.

> Mudanças locais nos arquivos do repositório (por exemplo, nos textos de `/terms` e `/privacy`) podem impedir o `git pull`. Faça essas mudanças num fork seu e instale a partir dele.

## 13. Backup e migração para outra máquina

O git traz só o código. O que precisa de backup:

| O quê | Onde | Por quê |
| :--- | :--- | :--- |
| Banco | MariaDB/MySQL (`zaphub`) | Usuários, mensagens, contatos, configurações e as credenciais das sessões do WhatsApp (cifradas). |
| `.env` | pasta do sistema | Principalmente `AUTH_SECRET` e `ENCRYPTION_KEY`: sem eles as credenciais do banco não abrem e as sessões precisam ser conectadas de novo. |
| Mídias | pasta configurada em Manutenção > Armazenamento (`/var/lib/zaphub/midia` ou `data/media`) | Fotos, áudios, vídeos e documentos. |
| `certificados/` | pasta do sistema | A CA local. Mantendo-a, os computadores não precisam reinstalar o certificado. |

### Fazer o backup

```bash
cd ~/zaphub
sudo mysqldump --single-transaction --routines zaphub | gzip > zaphub-banco-$(date +%F).sql.gz
tar czf zaphub-arquivos-$(date +%F).tar.gz .env certificados
sudo tar czf zaphub-midia-$(date +%F).tar.gz -C /var/lib/zaphub midia     # ou: tar czf ... data/media
```

Guarde os arquivos fora do servidor. O dump e o `.env` contêm dados pessoais e segredos: proteja-os (criptografia, acesso restrito).

### Migrar para outra máquina

1. Na máquina nova, faça as seções 2 a 4 (instalação normal, com `WA_AUTO_UPDATE=0` se preferir).
2. Pare o serviço novo: `sudo systemctl stop zaphub`.
3. **Pare o serviço antigo também** (`sudo systemctl stop zaphub` na máquina antiga). As duas não podem ficar conectadas às mesmas sessões do WhatsApp ao mesmo tempo: uma derruba a outra.
4. Restaure o banco:

   ```bash
   gunzip -c zaphub-banco-AAAA-MM-DD.sql.gz | sudo mysql zaphub
   ```

5. No `.env` novo, troque o `AUTH_SECRET` (e o `ENCRYPTION_KEY`, se usava) pelos valores do antigo. Mantenha o `DATABASE_URL` que o instalador gerou. Ajuste os endereços (`BASE_URL` etc.) se o IP ou o nome mudou.
6. Restaure as mídias **no mesmo caminho** de antes (o caminho fica gravado no banco). Para `/var/lib/zaphub/midia`, rode antes `sudo bash deploy/preparar-vm.sh` e depois:

   ```bash
   sudo tar xzf zaphub-midia-AAAA-MM-DD.tar.gz -C /var/lib/zaphub
   sudo chown -R "$USER": /var/lib/zaphub/midia
   ```

7. Para manter a mesma CA, copie a pasta `certificados/` antiga e rode `bash deploy/gerar-certificado.sh` (gera o certificado do servidor com os IPs novos e reaproveita a CA).
8. Se mudou alguma variável `NEXT_PUBLIC_*`, `bash deploy/reconstruir.sh`; senão, `sudo systemctl start zaphub`.

Com o banco e o `AUTH_SECRET` certos, as sessões costumam reconectar sem novo QR Code. Se alguma não reconectar, conecte de novo em **Sessões / QR**.

## 14. Comandos do dia a dia

```bash
sudo systemctl status zaphub             # está no ar?
sudo systemctl restart zaphub            # reiniciar
sudo systemctl stop zaphub               # parar
journalctl -u zaphub -f                  # log ao vivo
bash deploy/atualizar.sh                 # atualizar
bash deploy/reconstruir.sh               # recompilar do zero (tela sem estilo, mudança em NEXT_PUBLIC_*)
bash deploy/gerar-certificado.sh         # refazer o certificado (ex.: IP mudou)
```

## 15. Problemas comuns

**A compilação morre ou a tela abre "sem estilo".** Quase sempre é falta de memória. Crie swap e recompile do zero:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
bash deploy/reconstruir.sh
```

O `reconstruir.sh` para o serviço, apaga o build antigo, compila do zero, confere se o CSS foi gerado e reinicia. Depois, no navegador, Ctrl+F5.

**O serviço não sobe com `status=203/EXEC` (SELinux).** O Node está dentro do `/home` (por exemplo, instalado com `nvm`) e o SELinux bloqueia. Instale o Node no sistema (`sudo dnf module install nodejs:22` ou o pacote do NodeSource) e rode `bash deploy/instalar.sh` de novo para regravar o serviço com o caminho certo.

**"A porta HTTPS 3443 já está em uso" no log.** Já há um ZapHub rodando (por exemplo, um `npm start` aberto à mão junto com o serviço) ou outro programa usa a porta. Veja quem é:

```bash
sudo ss -ltnp | grep -E ':3443|:3005'
```

Feche o processo extra ou mude `HTTPS_PORT`. Se a porta HTTP interna estiver ocupada, o ZapHub só avisa e segue com o HTTPS.

**"FATAL: AUTH_SECRET is unset or using an insecure placeholder".** Gere um segredo (`openssl rand -base64 32`), coloque no `AUTH_SECRET` do `.env` e reinicie.

**Microfone (mensagem de voz) ou notificações não funcionam.** O navegador só libera em conexão segura. Acesse por `https://` e instale o certificado no computador (seção 7). A mensagem de voz também precisa do `ffmpeg` no servidor.

**O login volta para um endereço errado.** Confira `NEXTAUTH_URL` e `BASE_URL` no `.env` (seção 6) e reinicie.

**A atualização não instala ("sem-token", "pendente" ou "reprovada").** Sem token: seção 12. Pendente: a verificação do GitHub ainda está rodando (5 a 10 minutos). Reprovada: aquela versão não passou nos testes e não será instalada. Detalhes em `logs/atualizacao.log` ou **Manutenção > Logs**.

**A atualização parou no `prisma db push`.** A versão nova mudaria o banco de um jeito que apagaria dados, e o `db push` recusou. O sistema continua na versão anterior. Faça backup e veja as notas da versão antes de prosseguir.

**Horários e ordem das mensagens estranhos.** O relógio do servidor está errado (aparece em **Manutenção > Sistema**). Ligue a sincronização: `sudo timedatectl set-ntp true`.

**Outros computadores abrem o painel, mas as mensagens não chegam ao vivo.** O tempo real aceita o endereço de `BASE_URL`/`NEXTAUTH_URL` e endereços de rede local. Acessando por um domínio, ponha o domínio exato nessas variáveis.

## 16. Desenvolvimento local

```bash
git clone https://github.com/SanchesGi/ZapHub.git
cd ZapHub
cp .env.example .env
```

No `.env`: ajuste `DATABASE_URL` e `AUTH_SECRET`, troque `NODE_ENV="production"` por `NODE_ENV="development"` (o `.env` define o modo do servidor) e use endereços `http://localhost:3030`.

```bash
npm install --legacy-peer-deps
npx prisma generate
npx prisma db push
npm run dev            # http://localhost:3030
```

Sem a pasta `certificados/`, o servidor de desenvolvimento atende só em HTTP. O primeiro cadastro vira Super Administrador.

Testes e verificações (os mesmos da verificação do GitHub):

```bash
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json   # tipos
npm test                                                         # testes sem banco
TEST_DATABASE_URL="mysql://usuario:senha@127.0.0.1:3306/zaphub_teste" npm run test:banco
npm run build
```

O banco de `test:banco` precisa ser descartável e ter "test" no nome. Mais detalhes em [.github/CONTRIBUTING.md](../.github/CONTRIBUTING.md).
