# Modo demonstração

O modo demonstração mostra o ZapHub funcionando sem conectar nenhum WhatsApp. Ele usa dados fictícios de uma cafeteria inventada, o **Café Aurora**: atendentes, clientes, conversas, encomendas, grupo da equipe, disparos, agendamentos e respostas automáticas.

Serve para conhecer o painel antes de instalar de verdade, para apresentar o sistema e para tirar capturas de tela sem expor dados reais.

## O que muda no modo demonstração

- Nenhum WhatsApp é conectado. As sessões aparecem com o status gravado no banco.
- Nada é alterado pela API e nada é enviado ao WhatsApp: a tentativa recebe a mensagem "Na demonstração nada é alterado nem enviado ao WhatsApp".
- O painel mostra uma faixa avisando que é uma demonstração, e a tela de entrada mostra o acesso de teste.

Pessoas, números (com DDD 00, que não existe), empresas, endereços e documentos são inventados.

## Como rodar

Use um banco **separado** e descartável. O script de dados se recusa a rodar se o nome do banco não tiver "demo", porque ele **apaga tudo** o que houver nesse banco antes de preencher.

```bash
# 1) banco vazio só para a demonstração (como root do MariaDB)
sudo mariadb -e "CREATE DATABASE zaphub_demo CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 2) tabelas e dados fictícios (use um usuário com acesso a esse banco)
export DATABASE_URL="mysql://USUARIO:SENHA@127.0.0.1:3306/zaphub_demo"
npx prisma db push
npx tsx scripts/demo/popular-demo.ts

# 3) o sistema em modo demonstração
export ZAPHUB_DEMO=true NEXT_PUBLIC_ZAPHUB_DEMO=true
npm run build && npm start
```

Entre com **demo@zaphub.demo** e a senha **demo1234** (Super Administrador da demonstração).

As mídias da demonstração (cardápios e uma nota fiscal de exemplo) ficam em `data/demo-midia`, gerados pelo próprio script. Para usar outra pasta, defina `DEMO_PASTA_MIDIA` antes de rodar o script.

## Variáveis

| Variável | Para quê |
| :--- | :--- |
| `ZAPHUB_DEMO=true` | Liga o modo demonstração no servidor (não conecta WhatsApp, recusa alterações e envios). |
| `NEXT_PUBLIC_ZAPHUB_DEMO=true` | Mostra o acesso de teste na tela de entrada. Entra no build. |
| `ZAPHUB_DEMO_AVISO=false` | Esconde a faixa de demonstração do painel (útil para capturas de tela). |
| `DEMO_PASTA_MIDIA` | Pasta das mídias fictícias (padrão `data/demo-midia`). |

## Demonstração pública na internet

Para deixar a demonstração aberta ao público:

- use um servidor **só para ela**, nunca o mesmo de uma instalação real, com um banco que contenha apenas os dados fictícios;
- restaure os dados de tempos em tempos (por exemplo, uma vez por hora com o `cron`), rodando de novo o `scripts/demo/popular-demo.ts`;
- mantenha HTTPS e as atualizações em dia, como em qualquer instalação.

No modo demonstração, algumas ações feitas pelo painel que só mexem no banco (por exemplo, marcar conversa como lida ou fixar uma mensagem) continuam funcionando, para a experiência ficar real. A restauração periódica desfaz tudo.
