# Como contribuir

Obrigado pelo interesse no ZapHub! Contribuições são bem-vindas: correções, melhorias, traduções e documentação.

## Antes de começar

- Para mudanças grandes, abra uma issue antes para combinar a ideia.
- Falhas de segurança **não** vão em issue pública: veja [SECURITY.md](SECURITY.md).
- Ao contribuir, você concorda que sua contribuição é licenciada sob a **AGPL-3.0**, a mesma do projeto (veja [CREDITOS.md](../CREDITOS.md)).

## Ambiente de desenvolvimento

Requisitos: Node.js 22 (mínimo 20.9), MariaDB 10.6+ (ou MySQL 8), git e ffmpeg (para mensagens de voz).

```bash
git clone https://github.com/SanchesGi/ZapHub.git
cd ZapHub
cp .env.example .env            # ajuste DATABASE_URL e AUTH_SECRET
npm install --legacy-peer-deps
npx prisma generate
npx prisma db push              # cria as tabelas no banco
npm run dev                     # http://localhost:3030
```

O primeiro cadastro em `/auth/register` vira Super Administrador. Depois disso o cadastro público fica fechado.

## Antes de abrir o Pull Request

```bash
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json   # tipos
npm test                                                         # testes sem banco
TEST_DATABASE_URL="mysql://usuario:senha@127.0.0.1:3306/zaphub_teste" npm run test:banco
npm run build
```

A verificação do GitHub roda os mesmos passos, além de `npm audit` e do gitleaks (procura senhas e chaves no código).

## Padrões do projeto

- Textos da interface em português (pt-BR) e inglês (`src/i18n/messages`); os dois arquivos precisam ter as mesmas chaves.
- Permissões: rotas de sessão usam `canAccessSession`; ações de gestão usam `podeGerenciarSessao`.
- Server Actions devolvem `{ success: false, error }` em erro esperado (não lance exceção).
- Mídia enviada ao WhatsApp passa sempre pelo filtro `src/lib/midia-segura.ts` (nunca URL crua).
- Não envie ao WhatsApp `chatModify` sem o controle `SINCRONIZAR_ESTADO_CHAT`.
- Nunca inclua `.env`, certificados, chaves, dados de clientes ou logs no commit.
- Mensagens de commit em português, no formato `Área: o que mudou`.

## Fluxo

1. Faça um fork e crie uma branch a partir do `main`.
2. Faça a mudança com testes quando possível.
3. Abra o Pull Request descrevendo o que mudou, por quê e como você verificou.

## Contato

Dúvidas sobre o projeto: **ailansanches@tutamail.com**.
