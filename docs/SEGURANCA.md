# Segurança no ZapHub

Este documento descreve as proteções que o ZapHub aplica, onde elas ficam no código e o que fica sob responsabilidade de quem instala. Ele serve para você avaliar o projeto antes de usar e para conferir, no código, que cada proteção existe.

Encontrou uma falha? **Não abra issue pública**: veja [SECURITY.md](../.github/SECURITY.md) (contato: ailansanches@tutamail.com).

---

## 1. Como o código é verificado antes de chegar ao servidor

Toda mudança entra por Pull Request e passa por verificações automáticas antes do merge no `main`:

| Verificação | O que garante | Onde |
|---|---|---|
| TypeScript (`tsc --noEmit`) | Tipos corretos em todo o projeto | `.github/workflows/verificacao.yml` |
| Testes automáticos | Regras de segurança cobertas por teste (caminhos de mídia, IP do cliente, 2FA, regex, autoria de mensagens, LGPD) e testes com banco MariaDB real | `src/**/__tests__/` |
| Build de produção | O sistema compila | idem |
| `npm audit` | Dependências sem vulnerabilidade conhecida grave | idem |
| gitleaks | Nenhuma senha, token ou chave no código ou no histórico | idem |
| SonarCloud (Quality Gate) | Confiabilidade e segurança do código novo | integração no GitHub |

O atualizador do servidor (`deploy/atualizar.sh`) **só instala um commit que passou na verificação do GitHub**, compila a versão nova sem tirar o site do ar e **volta sozinho para a versão anterior** se a nova não responder.

Antes da publicação, o projeto passou por uma auditoria de segurança por leitura de código, e as falhas confirmadas foram corrigidas com teste.

---

## 2. Acesso ao painel

- **Senhas** guardadas só como hash **bcrypt**; nunca em texto.
- **Bloqueio de tentativas** de login por conta e por IP (`src/lib/login-rate.ts`). A pré-checagem do login conta no mesmo bloqueio, para não servir de atalho para testar senhas.
- **Verificação em duas etapas (2FA/TOTP)** para o Super Administrador (`src/lib/dois-fatores.ts`):
  - trocar o 2FA exige a senha (e o código atual, se já estiver ligado), e o fator antigo só é substituído depois que o novo é confirmado;
  - um código TOTP não é aceito duas vezes.
- **Papéis** (Super Administrador, Supervisor, Equipe) e **acesso por sessão de WhatsApp**: cada rota confere se o usuário pode ver (`canAccessSession`) ou gerenciar (`podeGerenciarSessao`) aquela sessão (`src/lib/session-access.ts`).
- **Cadastro público desligado** por padrão; contas criadas pelo administrador.
- **Trocar a própria senha** exige a senha atual.
- **Registro de acesso** (logins, falhas, 2FA, criação e remoção de usuários, troca de papel e senha, aceite de termos, manutenção) com data e IP, na tela Segurança.
- **IP do cliente** vem da conexão, não de um cabeçalho que o cliente possa forjar (`src/lib/ip-cliente.ts`); atrás de proxy reverso, configure `TRUST_PROXY=true`.

## 3. Comunicação e navegador

- **HTTPS** próprio (certificado de CA local gerado na instalação) ou atrás de proxy reverso com Let's Encrypt. Com HTTPS ativo, o HTTP fica só no `127.0.0.1` e redireciona.
- **Content-Security-Policy** e cabeçalhos de segurança (`next.config.ts`): bloqueio de enquadramento, `nosniff`, política de referência e de permissões.
- **Redirecionamento após o login** só para caminhos internos (`src/lib/destino-seguro.ts`).
- **Sessão do navegador** em cookie `HttpOnly` do Auth.js, assinado com o `AUTH_SECRET`. O servidor **não sobe em produção** com segredo vazio ou de exemplo.

## 4. Dados guardados

- **Credenciais do WhatsApp cifradas no banco** com AES-256-GCM (`src/lib/crypto.ts`, chave derivada do `AUTH_SECRET` ou do `ENCRYPTION_KEY`).
- **Mídias fora da pasta pública**: cada arquivo é entregue por uma rota que confere, **no banco**, a mensagem dona do arquivo e o acesso do usuário àquela sessão (`src/lib/autorizar-midia.ts`). Só nomes no formato de mídia são servidos; nunca outros arquivos da pasta.
- **Pasta de mídia validada**: não aceita pasta do sistema nem a pasta do aplicativo, e só vira pasta de mídia se estiver vazia ou já marcada (`src/lib/pasta-midia.ts`).
- **Limites de mídia recebida**: tamanho máximo por arquivo (`MIDIA_MAX_MB`, padrão 100 MB) e espaço mínimo livre em disco (`MIDIA_MIN_LIVRE_MB`, padrão 1 GB) antes de baixar (`src/lib/midia-limites.ts`).
- **Auditoria** de mensagens apagadas (quem apagou, quando, por onde).

## 5. WhatsApp e integrações

- **Mídia enviada nunca vai crua ao Baileys**: toda URL de mídia passa por um filtro que recusa caminho local e endereço interno, com limite de tamanho e de tempo (`src/lib/midia-segura.ts`, `src/lib/security.ts`). O mesmo vale para a prévia de links.
- **Editar ou apagar uma mensagem guardada exige ser o autor** (ou administrador do grupo, para apagar), no mesmo chat (`src/modules/whatsapp/store/autoria-protocolo.ts`). Um contato não consegue alterar o histórico de outra pessoa.
- **Ações que podem desconectar a conta** (arquivar, fixar, silenciar enviados ao WhatsApp) ficam desligadas por padrão (`SINCRONIZAR_ESTADO_CHAT`).
- **Respostas automáticas com expressão regular** limitadas em tamanho e forma, para que uma regra não trave o servidor (`src/lib/regex-segura.ts`).
- **Webhooks assinados** com HMAC-SHA256 (`X-Webhook-Signature`), com registro de entregas e retenção.
- **Chave de API** por usuário, com as mesmas permissões dele; nunca liberada para aceitar termos ou apagar a conta.
- **Limites de uso** nas rotas sensíveis (conferência de números, prévias de link, cadastro, exclusão de conta).

## 6. Servidor

- **Serviço systemd com usuário comum**, nunca root; reinicia sozinho se cair.
- **Permissões mínimas de administrador**: o painel só pode parar, iniciar e reiniciar o próprio serviço e disparar a atualização (`deploy/regras-sudo.sh`). Nenhum comando vindo do navegador é executado: as ações de manutenção são fixas e usam `execFile`, sem shell.
- **Manutenção só para o Super Administrador**, e cada ação vai para o registro de acesso.
- **Nenhuma telemetria**: o ZapHub não envia dados a terceiros. Só saem do servidor as mensagens para o WhatsApp e o que o administrador configurar (webhooks, remove.bg) e a busca de prévias de link.

## 7. Privacidade (LGPD)

Aceite versionado de Termos e Privacidade, exportação e exclusão da própria conta, atendimento a pedidos de titulares e retenção configurável. Detalhes em [LGPD.md](LGPD.md).

---

## 8. O que fica com quem instala

Segurança também depende da instalação. Faça:

- **HTTPS sempre**, com o certificado da instalação ou um domínio com Let's Encrypt.
- **`AUTH_SECRET` forte e guardado** (e `ENCRYPTION_KEY`, se usar). Nunca publique o `.env`.
- **2FA ligado** no Super Administrador.
- **Firewall** liberando só a porta do painel, de preferência só para a rede que usa.
- **Atualizações em dia** (Manutenção > Sistema > Atualizar agora).
- **Backup** do banco, do `.env` e da pasta de mídia, guardado com o mesmo cuidado dos dados.
- **Retenção** definida em Privacidade > Retenção, de acordo com a sua política.
- **Termos e Política de Privacidade** revisados por assessoria jurídica e encarregado (DPO) indicado.

## 9. Uso não oficial do WhatsApp

O ZapHub se conecta ao WhatsApp pela biblioteca Baileys, que **não é uma API oficial**. O WhatsApp pode limitar ou bloquear números que violem os termos dele (por exemplo, disparos em massa sem consentimento). Use com responsabilidade.
