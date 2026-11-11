# Servidor novo ou migração

O passo a passo completo está em **[docs/INSTALACAO.md](../docs/INSTALACAO.md)**:

- instalação do zero: seções 1 a 10;
- backup e migração para outra máquina (banco, `.env` com `AUTH_SECRET`/`ENCRYPTION_KEY`, mídias, certificados): seção 13.

Lembrete rápido: o git traz só o código. Os dados (usuários, mensagens, contatos e o pareamento do WhatsApp) ficam no banco; as mídias, na pasta de mídia.

## Token para a atualização ler a verificação do GitHub

O `deploy/atualizar.sh` só instala versões aprovadas na verificação do GitHub e, para consultá-la, precisa de um token fine-grained (repositório público: acesso "Public repositories (read-only)"; repositório privado: só ele, com "Actions: Read-only"). Guarde-o com o usuário do sistema:

```bash
mkdir -p ~/.config/zaphub && (umask 077; read -rs -p "Token: " T; echo "$T" > ~/.config/zaphub/github-token); echo
```

Emergência, sem conferir a verificação: `bash deploy/atualizar.sh --sem-verificacao`. Detalhes em [docs/INSTALACAO.md](../docs/INSTALACAO.md#12-atualizar).
