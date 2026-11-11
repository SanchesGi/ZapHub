# Política de segurança

## Como avisar sobre uma falha

**Não abra uma issue pública** para falhas de segurança: isso expõe quem usa o ZapHub antes da correção.

Mande um e-mail para **ailansanches@tutamail.com** com:

- o que você encontrou e o impacto (por exemplo: acesso a mensagens de outro usuário, execução de comando no servidor);
- os passos para reproduzir, de preferência numa instalação de teste;
- a versão (commit) em que encontrou;
- se quiser, como prefere ser creditado.

Também é possível usar o recurso **"Report a vulnerability"** (Security Advisories) do GitHub, que mantém o relato privado.

## O que esperar

- Resposta inicial em até 7 dias.
- Correção priorizada conforme a gravidade, com aviso no repositório quando a versão corrigida sair.
- Crédito a quem relatou, se desejar.

Pedimos que você não divulgue a falha publicamente antes da correção (ou de 90 dias do relato, o que vier primeiro).

## Versões com suporte

Só a versão mais recente do branch `main` recebe correções de segurança. Mantenha sua instalação atualizada (Manutenção > Sistema > Atualizar agora).

## Boas práticas para quem instala

- Use HTTPS (o `deploy/gerar-certificado.sh` cria um certificado local; com domínio, use um proxy reverso com Let's Encrypt).
- Gere um `AUTH_SECRET` forte e guarde-o com segurança. Nunca publique o `.env`.
- Ative a verificação em duas etapas (2FA) para o Super Administrador.
- Deixe o cadastro público desligado (padrão) e crie as contas pelo painel.
- Restrinja o acesso à porta do painel no firewall a quem precisa.
- Lembre que você é o controlador dos dados pessoais tratados na sua instalação (LGPD). Veja `docs/LGPD.md`.
