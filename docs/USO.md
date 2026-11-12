# Guia do usuário do ZapHub

Como usar o painel no dia a dia. Para instalar, veja [INSTALACAO.md](INSTALACAO.md).

## Papéis

| Papel | Nome técnico | O que pode |
| :--- | :--- | :--- |
| Super Administrador | `SUPERADMIN` | Tudo: todas as sessões, todos os usuários, configurações, manutenção, segurança, privacidade. |
| Supervisor | `STAFF` | Gerencia as sessões que são dele ou foram compartilhadas com ele (QR, bot, disparos, agendador, webhooks...) e os usuários da própria equipe. Vê a auditoria de mensagens apagadas. |
| Equipe | `USER` | Usa as conversas das sessões compartilhadas com ele. Se criar uma sessão própria, gerencia só essa. |

Algumas opções do menu só aparecem para quem tem permissão.

## Primeiro acesso

1. Entre em `https://ENDERECO_DO_SERVIDOR:3443` com o e-mail e a senha que o administrador criou.
2. Leia e aceite os **Termos de Uso e a Política de Privacidade**. O aceite é pedido de novo sempre que os textos mudam.
3. Se o navegador avisar que a conexão não é segura, peça ao administrador o instalador do certificado (veja [INSTALACAO.md](INSTALACAO.md#7-https)). Sem HTTPS, o microfone e as notificações não funcionam.

## Barra superior

- **Seletor de sessão**: escolhe qual número (sessão) você está usando. Conversas, grupos, agendador, bot e outras telas mostram sempre a sessão escolhida aqui.
- **Idioma**: português ou inglês.
- **Alertas de mensagem**: som, volume e notificações do navegador quando chega mensagem. Se o navegador não permitir (página sem HTTPS), o menu mostra o link para abrir em HTTPS e para instalar o certificado.
- **Tema**: claro ou escuro.

## Sessões (números de WhatsApp)

**Sessões / QR**

1. Crie uma sessão com um nome (e, se quiser, um ID próprio).
2. Conecte pelo **QR Code** (no celular: WhatsApp > Aparelhos conectados > Conectar um aparelho) ou pelo **código de pareamento**.
3. Acompanhe o status. Pelas ações da sessão é possível reconectar, desconectar ou apagar.

**Acesso às Sessões**: o dono (ou um Supervisor/Super Administrador) compartilha a sessão com outros usuários pelo e-mail e revoga quando quiser. Quem recebe acesso como Equipe vê só as conversas.

**Sessão privada**: na lista de sessões, o dono pode usar **Tornar privada**. A sessão passa a ser só dele: nenhum outro usuário a vê, nem outro Super Administrador (no painel, na API, na auditoria, no gerenciador de mídia, no tempo real e nos webhooks de outras pessoas). Ela não pode ser compartilhada (uma sessão compartilhada só vira privada depois de remover as pessoas com acesso) e as mensagens saem sem assinatura. As ferramentas de LGPD continuam alcançando todas as sessões, porque o responsável pelos dados precisa atender os pedidos dos titulares; e quem administra o servidor tem acesso ao banco.

**Assinatura em negrito** (botão de caneta no campo de mensagem): o cliente vê *Seu Nome* em negrito em cima da mensagem. Vale por sessão: vem ligada nas sessões compartilhadas, desligada nas que só o dono usa e travada nas privadas. Cada pessoa pode ligar ou desligar a sua, separadamente para conversas e grupos.

**Perfil do Bot**: foto, nome e recado do número no WhatsApp.

## Conversas

**Lista de conversas**
- Busca por nome ou número; filtros Todas, Conversas e Grupos.
- **Nova conversa**: abre conversa com qualquer número (DDD + número), mesmo fora da agenda, e já pode levar uma primeira mensagem.
- Conversas fixadas, silenciadas, não lidas e etiquetas aparecem na lista. Pelo menu da conversa: fixar, silenciar, arquivar, marcar como lida ou não lida.

> Por padrão, fixar, silenciar, arquivar e marcar como lida ficam **só no painel** e não mudam nada no celular (configuração `SINCRONIZAR_ESTADO_CHAT`).

**Dentro da conversa**
- **Procurar na conversa**: busca texto nas mensagens e pula até elas.
- **Responder**, **reagir**, **copiar**, **encaminhar** (para uma ou mais conversas; contatos também podem ser encaminhados) e **apagar**. Apagar remove no WhatsApp para todos quando a mensagem é sua (ou você é admin do grupo); o registro fica na Auditoria.
- **Anexos**: fotos e vídeos (com legenda na primeira), documentos e contatos.
- **Mensagem de voz**: clique no microfone, fale e envie. O medidor mostra o volume do microfone; se o áudio sair mudo (microfone desligado ou bloqueado), o envio é barrado e você é avisado. O áudio chega como mensagem de voz normal do WhatsApp.
- **Links** viram clicáveis, com prévia (título e imagem do site).
- **Fotos**: clique para abrir o visualizador, com zoom (+ e -), ajustar à tela, tamanho original (0), girar (R), foto anterior e próxima (setas) e baixar.
- **Vídeos e áudios**: player com velocidade; vídeo pode ir para "imagem sobre imagem".
- **Corrigir**: corretor ortográfico em português, que roda no seu navegador (nada sai do servidor). Palavras ignoradas ficam guardadas no navegador.
- Em grupos, **mencione** participantes digitando `@`.
- **Informações** (painel lateral): dados do contato ou do grupo, etiquetas, copiar número, salvar contato, bloquear ou desbloquear, membros e administradores do grupo.

## Disparos e automação

**Transmissão (disparo em massa)**: cole os números (separados por vírgula ou linha), escreva a mensagem e escolha o intervalo entre envios (um intervalo aleatório é somado). Acompanhe o progresso ao vivo e veja o histórico com enviadas e falhas de cada campanha.

> Disparos em massa para quem não pediu aumentam muito o risco de bloqueio do número e podem violar a LGPD. Veja [LGPD.md](LGPD.md).

**Testador Interativo**: envia mensagens com botões nativos do WhatsApp (resposta rápida, abrir link, ligar, copiar código, lista), com modelos prontos de 1 clique, compositor personalizado (até 10 botões), prévia e histórico. Também abre pelo botão "Interativo e Teste" dentro da conversa.

**Agendador**: agenda mensagem para contato, grupo ou canal, com texto e mídia opcional (por URL). Pode ser única (data e hora) ou recorrente (a cada X minutos, a cada X horas, dias da semana com horário ou expressão cron). O fuso é o definido em Configurações.

**Resposta Automática**: regras por palavra-chave (correspondência exata, contém, começa com ou regex), com resposta em texto e mídia opcional, para todas as conversas, só individuais ou só grupos.

**Configurações do Bot** (por sessão): nome e prefixo dos comandos (`#sticker`, `#ping`, `#uptime`), quem pode usar o bot (público, só o dono, lista branca, lista negra), anti-spam, mensagem de boas-vindas, presença (sempre online, marcar como lida automaticamente), confirmações de leitura e outras opções de privacidade.

**Criador de Figurinhas**: transforma imagem ou vídeo em figurinha e envia para um número ou grupo, com nome do pacote, autor, qualidade e recorte.

## Contatos, grupos e etiquetas

- **Contatos**: lista dos contatos sincronizados da sessão, com busca e paginação.
- **Grupos**: lista dos grupos da sessão, busca e criação de grupos. Membros e administradores aparecem no painel de informações da conversa do grupo; outras ações de administração (nome, descrição, participantes, convite) estão disponíveis pela API.
- **Etiquetas**: crie etiquetas coloridas e atribua conversas a elas. As etiquetas aparecem na lista e no painel de informações.
- **Gerenciador de Mídia**: navega pelas mídias guardadas no servidor, com filtros por tipo e remetente, visualização, download e exclusão em lote.

## Webhooks e API

**Webhooks e API** (por sessão):
- **Chave de API**: gere ou regenere a sua chave. Use-a no cabeçalho `X-API-Key` das requisições. Regenerar invalida a chave anterior na hora.
- **Webhooks**: cadastre uma URL e escolha os eventos (`message.received`, `message.sent`, `message.status`, `message.deleted`, `message.edited`, `connection.update`, `group.update`, `group.participant`, `contact.update`, `status.update`). Com uma chave secreta, cada envio leva a assinatura HMAC-SHA256 no cabeçalho `X-Webhook-Signature`. Dá para testar e ver o registro das entregas.

> Webhooks mandam dados de mensagens para fora do servidor. Só aponte para sistemas da sua organização ou de parceiros com contrato.

**Documentação da API** (`/docs`) e **Swagger UI** (`/swagger`): referência das rotas, com exemplos. Também em [API_DOCUMENTATION.md](API_DOCUMENTATION.md) e [API-QUICK-REFERENCE.md](API-QUICK-REFERENCE.md).

## Administração

**Usuários** (Super Administrador e Supervisor): criar, editar e remover usuários, definir o papel e o supervisor responsável. O Supervisor vê e cria só usuários da Equipe dele.

**Configurações**: nome da aplicação, logotipo, favicon, fuso horário padrão, cadastro público e verificação de atualizações. Todos veem; só o Super Administrador altera.

**Verificação em duas etapas (2FA)** (Super Administrador): no rodapé do menu lateral. Ative, escaneie o QR Code num app autenticador (Google Authenticator, Authy etc.) e confirme com um código. Para desativar, informe a senha. Perdeu o celular: o administrador do servidor roda `node scripts/desativar-2fa.js email`.

**Auditoria** (Super Administrador e Supervisor): mensagens apagadas, com o conteúdo, a conversa, quem escreveu, quem apagou e por onde (pelo painel, pelo próprio celular do número ou pelo contato no WhatsApp) e se foi apagada para todos ou só para si.

**Auditoria de acesso** (Super Administrador): logins e falhas, 2FA, logout, usuários criados e removidos, papéis e senhas alterados, sessões compartilhadas, ações de manutenção e aceites dos termos, com IP e data.

**Monitor do Sistema** (Super Administrador): uso de CPU, memória e disco do servidor.

**Notificações** (Super Administrador): envie avisos para usuários do painel. Cada usuário vê os seus na caixa de notificações.

**Manutenção** (Super Administrador):
- **Armazenamento**: pasta das mídias, mover arquivos para outra pasta, espaço livre.
- **Sistema**: versão, atualizar agora, reiniciar o serviço, relógio do servidor.
- **Logs**: do serviço e das atualizações.
- **Espaço**: o que ocupa o disco e limpeza com um clique (mídias antigas a partir de 7 dias, versão anterior, caches, temporários, log de atualização).

Se faltar o preparo do servidor, a tela mostra o comando para o administrador rodar uma vez (`sudo bash deploy/preparar-vm.sh`).

## Privacidade e seus dados

**Meus dados** (todo usuário): baixe um arquivo com os seus dados no ZapHub ou exclua a sua conta (pede a senha e a confirmação `EXCLUIR`). As sessões de que você é dono são desconectadas e apagadas junto.

**Privacidade** (Super Administrador): pedidos de titulares (contatos que pedem acesso, correção ou exclusão dos dados), busca, exportação e exclusão dos dados de um contato por telefone, e prazos de retenção de mensagens, mídias e logs. Detalhes em [LGPD.md](LGPD.md).

Os textos completos ficam em **Termos** (`/terms`) e **Privacidade** (`/privacy`), com links no rodapé do menu e na tela de login.
