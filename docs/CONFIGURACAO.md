# Configuração do ZapHub

A configuração fica em dois lugares:

- no arquivo **`.env`**, na pasta do sistema (endereços, portas, banco, segredos, comportamento do servidor);
- no **painel**, em Configurações e Manutenção (nome do app, fuso, cadastro, pasta de mídia, retenção de dados).

## O arquivo .env

O modelo é o [`.env.example`](../.env.example). Numa instalação nova, o `deploy/instalar.sh` cria o `.env` sozinho (veja [INSTALACAO.md](INSTALACAO.md#4-rodar-o-instalador)). Para criar à mão:

```bash
cp .env.example .env
nano .env
```

Depois de mudar:

- variáveis comuns: `sudo systemctl restart zaphub`;
- variáveis **`NEXT_PUBLIC_*`** entram na compilação: `bash deploy/reconstruir.sh` (ou `npm run build` e reiniciar).

O `.env` tem segredos. Ele já está no `.gitignore`: nunca o envie para o git e guarde uma cópia segura do `AUTH_SECRET` (e do `ENCRYPTION_KEY`, se usar).

### 1. Obrigatórias

| Variável | Exemplo | Para que serve |
| :--- | :--- | :--- |
| `DATABASE_URL` | `mysql://zaphub:SENHA@127.0.0.1:3306/zaphub` | Conexão com o MariaDB/MySQL (o único banco suportado). O `deploy/configurar-mariadb.sh` mostra a linha pronta, com `?connection_limit=20&pool_timeout=30`. |
| `AUTH_SECRET` | gerado com `openssl rand -base64 32` | Assina as sessões de login e, se não houver `ENCRYPTION_KEY`, é a base da chave que cifra as credenciais do WhatsApp no banco. Em produção o servidor não sobe se ele estiver vazio ou com um valor de exemplo conhecido. **Trocar desloga todos e desconecta as sessões do WhatsApp.** |
| `BASE_URL` | `https://192.168.0.10:3443` | Endereço público do painel. Usado no tempo real (Socket.IO aceita conexões vindas desse endereço). |
| `NEXTAUTH_URL` | `https://192.168.0.10:3443` | Endereço usado pelo login (next-auth) e também aceito pelo tempo real. O instalador **não** preenche: troque o valor de exemplo. |
| `NEXT_PUBLIC_APP_URL` | `https://192.168.0.10:3443` | Endereço usado nos metadados das páginas públicas, `robots.txt` e `sitemap.xml`. Entra no build. |
| `NEXT_PUBLIC_API_URL` | `https://192.168.0.10:3443/api` | Base da API mostrada na página de documentação do painel. Entra no build. |
| `NODE_ENV` | `production` | Modo do servidor. O serviço `zaphub` e o `npm start` já usam `production`. Para desenvolvimento (`npm run dev`), use `development`. |

### 2. Portas e HTTPS

| Variável | Padrão | Para que serve |
| :--- | :--- | :--- |
| `PORT` | `3030` no código; o instalador grava `3005` | Porta HTTP. Com certificado, escuta **só em 127.0.0.1** e redireciona para o HTTPS (checagem interna). Sem certificado ou com `HTTPS_DISABLED="true"`, é a porta principal e escuta em todas as interfaces. Precisa ser diferente da `HTTPS_PORT`. |
| `HTTPS_PORT` | `3443` | Porta HTTPS, a usada na rede quando há certificado em `certificados/`. |
| `NEXT_PUBLIC_HTTPS_PORT` | `3443` | A mesma porta, para o painel montar o link "abrir em HTTPS" quando alguém entra por HTTP. Entra no build. |
| `HTTPS_DISABLED` | `false` | `"true"` desliga o HTTPS próprio. Use atrás de um proxy reverso (Nginx, Caddy) com Let's Encrypt. |
| `HTTP_REDIRECT_HTTPS` | ligado | `"false"` desliga o redirecionamento HTTP para HTTPS. |
| `HOSTNAME` | `localhost` | Nome usado só para montar origens e redirecionamentos quando não há outro dado. Não define em qual interface o servidor escuta. |

O HTTPS próprio usa `certificados/servidor.key`, `servidor.crt` e `ca.crt`, gerados por `deploy/gerar-certificado.sh`. Microfone (mensagem de voz) e notificações do navegador só funcionam em HTTPS.

### 3. Idioma e fuso

| Variável | Padrão | Para que serve |
| :--- | :--- | :--- |
| `TZ` | `America/Sao_Paulo` | Fuso do processo e das datas mostradas no painel. Também é o fuso do agendador quando o painel não define outro. |
| `DEFAULT_LANGUAGE` | `pt-BR` | Idioma do painel para quem ainda não escolheu no seletor (`pt-BR` ou `en`). Veja [I18N.md](I18N.md). |

### 4. WhatsApp

| Variável | Padrão | Para que serve |
| :--- | :--- | :--- |
| `BAILEYS_LOG_LEVEL` | `error` | Nível de log da biblioteca do WhatsApp: `fatal`, `error`, `warn`, `info`, `debug` ou `trace`. Em produção, `error`. |
| `SINCRONIZAR_ESTADO_CHAT` | `false` | `"true"` envia ao WhatsApp o que for feito no painel em silenciar, fixar, arquivar e marcar como lida. Com `"false"` (recomendado) isso fica só no painel: um envio malformado desse tipo pode desconectar todos os aparelhos da conta. |
| `VOICE_OPUS_BITRATE` | `48k` | Qualidade (bitrate Opus) da mensagem de voz convertida no servidor. Valores bem acima (como 160k) fazem o app do WhatsApp no Android recusar tocar o áudio. |
| `VOICE_DENOISE` | ligado | `"false"` desliga a redução de ruído extra que o servidor aplica na mensagem de voz. |

A conversão da mensagem de voz usa o `ffmpeg` instalado no servidor, procurado só em `/usr/bin`, `/usr/local/bin` e `/bin` (nunca pelo PATH). Se ele estiver em outro lugar, informe o caminho completo em `FFMPEG_PATH`.

### 5. Painel

| Variável | Padrão | Para que serve |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_CHAT_PAGE_SIZE` | `50` | Quantas conversas a lista do chat carrega por vez. Entra no build. |
| `NEXT_PUBLIC_ALLOW_INDEXING` | `false` | `"true"` deixa buscadores indexarem as páginas públicas (`robots.txt` e `sitemap.xml`). Entra no build. |
| `ENABLE_AUTO_UPDATE_CHECK` | `true` | Avisa o Super Administrador quando há versão nova no repositório de origem (`origin` do git local). `"false"` desliga só o aviso; não afeta a atualização automática. |

### 6. Segurança (opcional)

| Variável | Padrão | Para que serve |
| :--- | :--- | :--- |
| `ENCRYPTION_KEY` | vazio | Chave própria para cifrar as credenciais do WhatsApp no banco (AES-256-GCM). Sem ela, a chave vem do `AUTH_SECRET`. Use um valor longo e aleatório (por exemplo `openssl rand -hex 32`) e guarde junto com o `AUTH_SECRET`. Definir ou trocar depois que as sessões existem impede que elas sejam lidas: conecte-as de novo. |
| `CSP_DISABLED` | `false` | `"true"` desliga a Content-Security-Policy. Só para diagnosticar; não use em produção. |
| `TRUST_PROXY` | `false` | Use `"true"` só atrás de proxy reverso (Nginx/Caddy): o IP do cliente passa a vir do `X-Forwarded-For` (última entrada). Sem proxy, o IP vem da conexão e não pode ser forjado. Sem essa opção atrás de um proxy, todos os limites e registros usam o IP do proxy. |
| `MIDIA_MAX_MB` | `100` | Tamanho máximo, em MB, de cada mídia recebida que o servidor baixa. Acima disso, a mensagem fica com a mídia pendente. |
| `MIDIA_MIN_LIVRE_MB` | `1024` | Espaço livre mínimo, em MB, no disco da pasta de mídia para baixar mídias recebidas. Abaixo disso, o download espera (a mensagem fica com "tentar de novo"). |

### 7. Testes (só desenvolvimento)

| Variável | Para que serve |
| :--- | :--- |
| `TEST_DATABASE_URL` | Banco **descartável** para `npm run test:banco`. O nome do banco precisa conter "test"; os testes apagam o que criam. |

### Variáveis internas

Não precisam estar no `.env`:

- `NEXT_DIST_DIR`: pasta do build, usada pelo `deploy/atualizar.sh` para compilar em `.next.new` sem derrubar o sistema.
- `TURBOPACK=1` (ou `TURBO=true`): usa o Turbopack no `npm run dev` em vez do webpack.

## O que se configura pelo painel

### Configurações (todos veem; só o Super Administrador altera)

| Item | Padrão | Observação |
| :--- | :--- | :--- |
| Nome da aplicação | `ZapHub` | Aparece no menu lateral e no título do navegador. |
| URL do logotipo e do favicon | vazio | Imagens próprias para o painel. |
| Fuso horário padrão | `America/Sao_Paulo` | Usado pelo agendador (e pela limpeza de retenção). Prevalece sobre o `TZ` do `.env` para o agendador. |
| Registro público de usuários | desligado | Ligado, qualquer pessoa que alcance o painel cria uma conta (papel Equipe). Deixe desligado e crie as contas em Usuários. |
| Atualizações do sistema | — | Botão para verificar se há versão nova. |

### Manutenção (só Super Administrador)

| Item | Observação |
| :--- | :--- |
| Pasta das mídias (aba Armazenamento) | Por padrão, `data/media` dentro da pasta do sistema. Recomendado: `/var/lib/zaphub/midia`, criada pelo `deploy/preparar-vm.sh`. A troca move os arquivos antigos em segundo plano. Precisa ser um caminho absoluto simples, fora das pastas do sistema e da pasta do app. |
| Atualizar e reiniciar (aba Sistema) | Precisam do `deploy/preparar-vm.sh` rodado uma vez. |
| Limpeza de espaço (aba Espaço) | Mídias com mais de N dias (mínimo 7), versão anterior, caches, temporários de áudio e log de atualização. |

### Privacidade (só Super Administrador)

| Item | Observação |
| :--- | :--- |
| Retenção de mensagens, mídias e logs | Em dias (mínimo 30) ou vazio para guardar para sempre. A limpeza roda todo dia às 03:00 no fuso do sistema e pode ser executada na hora. Detalhes em [LGPD.md](LGPD.md). |

### Por sessão

Configurações do bot, respostas automáticas, webhooks e perfil do WhatsApp são definidos por sessão, nas telas próprias. Veja [USO.md](USO.md).
