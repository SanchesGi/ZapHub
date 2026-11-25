# Atualizações do ZapHub

O ZapHub recebe correções e melhorias com frequência. Cada versão publicada aparece aqui, da mais nova para a mais antiga, com o que mudou para quem usa e para quem instala.

Como atualizar uma instalação: **Manutenção > Sistema > Atualizar agora**, no painel (veja [docs/INSTALACAO.md](docs/INSTALACAO.md#12-atualizar)).

Encontrou um erro? Abra uma issue. Falha de segurança: **não abra issue pública**; siga [.github/SECURITY.md](.github/SECURITY.md).

O número da versão segue o padrão `MAIOR.MENOR.CORREÇÃO`: a última parte sobe em correções, a do meio em recursos novos e a primeira em mudanças que exigem cuidado ao atualizar.

---

## 2.10.0 — 25/11/2026

### Novidades
- **Todos os emojis:** o painel de emojis passou a ter a lista completa do padrão Unicode, com todas as categorias (Carinhas e emoção, Pessoas e corpo, Animais e natureza, Comidas e bebidas, Viagens e lugares, Atividades, Objetos, Símbolos e Bandeiras), busca em português e recentes. A lista só é carregada quando o painel abre.
- **Tom de pele por pessoa:** cada atendente escolhe o tom (amarelo ou um dos 5 tons) no painel de emojis. A escolha fica na conta, vale em qualquer computador e é usada também nas reações.
- **Figurinhas direto da conversa:** a estrela "Adicionar às figurinhas" fica sempre visível na figurinha e também no menu da mensagem (botão direito), sem precisar baixar o arquivo. Se a figurinha ainda estiver baixando, o painel avisa.

### Observações
- No Windows, as bandeiras aparecem como letras (ex.: BR), porque o sistema não desenha emojis de bandeira; no celular e no Mac aparecem normalmente.

### Para quem instala
- A atualização adiciona um campo na tabela de usuários (aplicado automaticamente pelo `prisma db push` do `atualizar.sh`) e a dependência `emojibase-data` (só dados, licença MIT).

## 2.9.0 — 25/11/2026

### Novidades
- **Emojis ao escrever:** botão de emoji ao lado do campo de mensagem, com categorias, busca em português e recentes. O emoji entra onde está o cursor, sem enviar.
- **Figurinhas como no aplicativo:** na figurinha recebida, "Adicionar às figurinhas" guarda ela na sua coleção (cada atendente tem a sua). A aba "Figurinhas" do painel de emojis mostra as suas, das mais usadas para as menos, e um clique envia na hora. Dá para remover da coleção e criar uma figurinha nova a partir de uma imagem.

### Manutenção
- O servidor registra no log quando um status chega, é guardado ou é descartado (e o motivo), sem o número completo nem o conteúdo, para facilitar entender quando um status não aparece.

### Para quem instala
- A atualização cria a tabela de figurinhas (aplicado automaticamente pelo `prisma db push` do `atualizar.sh`, sem perda de dados). As figurinhas ficam na subpasta `figurinhas/` da pasta de mídia.
- As figurinhas guardadas são da coleção de cada atendente (como no aplicativo): ficam fora do prazo de retenção de mídias e saem quando o atendente as remove ou quando a conta dele é excluída.

## 2.8.0 — 25/11/2026

### Novidades
- **Auditoria mais fácil de entender:** cada registro virou uma frase ("Maria apagou para todos, pelo painel, às 14:32"), com a conversa, a sessão e a mensagem apagada, agrupados por dia. Filtros por período, sessão, quem apagou, tipo e busca, e uma explicação no topo de quem vê o quê (o Supervisor vê só as sessões dele; o Super Administrador, todas).
- **Apagado só no celular agora fica registrado:** "apagar só para mim" e "apagar conversa" feitos no celular do número vão para a Auditoria e somem também do painel. A conversa apagada aparece num cartão só, com as mensagens para consultar.

### Limites
- "Limpar conversa" pelo celular não chega ao ZapHub (a biblioteca do WhatsApp usada não avisa esse caso); só "apagar" chega.

## 2.7.0 — 25/11/2026

### Novidades
- **Status:** botão "Status" na lista de conversas, com os status de texto, foto e vídeo dos contatos (somem em 24 horas), visualizador com avançar e voltar, e resposta que chega ao autor citando o status. Os status não viram conversa nem notificam. O "visto" é de cada atendente e não é enviado ao WhatsApp, para o autor não ser avisado cada vez que alguém do painel abre.
- **Publicar status** (para quem gerencia a sessão): texto com cor de fundo, foto ou vídeo com legenda. Vai para até 256 contatos que escreveram para a sessão nos últimos 30 dias, no máximo uma publicação por minuto, para proteger o número contra bloqueio.
- **Enquete:** criar pelo menu do clipe (2 a 12 opções, resposta única ou várias) e ver o placar ao vivo na conversa, com quem votou em cada opção. Votar pelo painel ainda não é possível: a biblioteca do WhatsApp usada não envia votos com segurança.
- **Info da mensagem:** enviada, entregue e lida, com horário. Em grupos, a lista de quem recebeu e quem leu (só aparece quem deixa a confirmação de leitura ligada).
- **Administração de grupo** no painel de dados do grupo: adicionar membros por número (com o resultado de cada um), remover, promover e tirar admin, link de convite (mostrar, copiar e redefinir), nome, descrição, "só admins enviam", "só admins editam dados", mensagens temporárias e sair do grupo. Só aparece para quem gerencia a sessão e quando o número da sessão é admin do grupo.

### Correções e segurança
- O link de convite de um grupo só pode ser lido por quem gerencia a sessão (antes qualquer operador com acesso à sessão conseguia, e o link permite entrar no grupo).
- A leitura automática não marca mais status como vistos (o autor era avisado) e a resposta automática não tenta mais responder a status.
- Apagar os dados de um titular (LGPD) também apaga os arquivos dos status dele.
- A rota de membros do grupo valida a ação e limita a 20 números por vez.

### Para quem instala
- A atualização cria a tabela de status vistos e campos novos na tabela de status (aplicado automaticamente pelo `prisma db push` do `atualizar.sh`, sem perda de dados).

## 2.6.0 — 25/11/2026

### Novidades
- **Silenciar uma sessão inteira:** no menu de alertas (sino), cada pessoa escolhe as sessões que não devem tocar som, mostrar a ilha nem notificar. A escolha fica na conta de quem silenciou, vale em qualquer computador e não muda nada para os colegas. O seletor de sessões mostra um sino cortado nas sessões silenciadas.
- **"Digitando…", "gravando áudio…", "online" e "visto por último"** no cabeçalho da conversa aberta. Nos grupos, aparece quem está digitando. "Online" e "visto por último" seguem a privacidade de cada contato no WhatsApp.
- **Selecionar várias mensagens:** pelo menu da mensagem ("Selecionar"), marque até 100 mensagens e copie (com data e autor), encaminhe para várias conversas de uma vez ou apague. As suas são apagadas para todos; as de outras pessoas, só para você.

### Para quem instala
- A atualização adiciona um campo na tabela de usuários (aplicado automaticamente pelo `prisma db push` do `atualizar.sh`).

## 2.5.2 — 25/11/2026

### Segurança e manutenção
- **Next.js 16.4.6:** corrige sete falhas de segurança de gravidade moderada da versão anterior (vazamento entre usuários no cache, injeção de resposta em instalações próprias, exposição de cookie e desvio no otimizador de imagens SVG). A partir desta versão, o próprio Next recusa gerar o sistema em versões com falha conhecida.
- **React 19.3** e atualizações menores de bibliotecas (componentes da tela, gráficos, formulários, agendamento e registro de eventos), sem mudança de funcionamento.

## 2.5.1 — 17/11/2026

### Correções
- **Mensagens de modelo (template, botões e listas):** alertas como os da Defesa Civil e mensagens de bots de empresas apareciam só como "[template]". Agora mostram o título, o texto, o rodapé e os botões, e a imagem, o vídeo ou o documento que vem no topo é baixado e exibido. O webhook também passa a repassar esse conteúdo. Mensagens antigas que já foram gravadas como "[template]" continuam assim.
- **Imagens que ficavam carregando para sempre:** se o servidor reiniciava (por exemplo, numa atualização) enquanto uma mídia ainda estava baixando, ela ficava presa no carregamento. Agora o download é retomado quando a sessão conecta; se não der certo, aparece o botão "tentar de novo".
- **Mídia nova mais rápida:** fotos e vídeos que chegam na hora passam na frente das mídias antigas do histórico que ainda estão baixando.

## 2.5.0 — 14/11/2026

### Novidades
- **ZapHub para Windows:** um programa nativo para Windows 10 e 11 (64 bits), sem navegador, que se conecta ao servidor ZapHub da sua empresa. Precisa do servidor na versão 2.4.0 ou mais nova. Veja [docs/APP-WINDOWS.md](docs/APP-WINDOWS.md).
  - **Acesso seguro:** no primeiro acesso o programa mostra a impressão digital do servidor para você conferir com o administrador e passa a aceitar só esse servidor. Se a identidade do servidor mudar, a conexão é bloqueada com um alerta. O login aceita a verificação em duas etapas (2FA) e fica guardado com a proteção do Windows.
  - **Atendimento:** sessões, conversas e mensagens em tempo real, fotos e áudios na conversa, fotos de perfil, painel de informações do contato ou grupo, busca na conversa, nova conversa e aceite dos termos.
  - **Envio:** texto, arquivos (também colando imagem com Ctrl+V) e mensagens de voz gravadas pelo microfone do computador.
  - **Ações:** responder citando, reagir, encaminhar, editar, apagar e, no menu da conversa, arquivar, silenciar, fixar e marcar como não lida.
  - **No dia a dia:** notificações do Windows, ícone perto do relógio, opção de iniciar com o Windows e tela de configurações.
  - **Arquivos recebidos:** abrem direto só os tipos comuns (PDF, imagens, áudio, vídeo, documentos do Office sem macro); o resto só pode ser salvo. Todo arquivo baixado fica marcado como vindo da internet.
  - **Instalador próprio:** para todos os usuários (pede administrador) ou só para você (sem administrador), com tela de termos e registro da instalação.
  - O instalador **não tem assinatura digital paga**. O Windows SmartScreen pode mostrar "O Windows protegeu o computador": clique em **Mais informações** e depois em **Executar assim mesmo**. Publicamos o SHA-256 de cada instalador para você conferir o arquivo (veja o guia).
- **Editar mensagem enviada (painel e programa):** clique com o botão direito numa mensagem de texto sua e escolha **Editar**. Como no WhatsApp, só vale até 15 minutos depois de enviar; quem recebeu vê a mensagem nova, marcada como editada.

### Correções
- **Troca de sessão com uma conversa aberta:** o painel abria a mesma conversa na sessão nova, e a mensagem podia sair pelo número errado (o cliente via dois números no mesmo assunto). Agora a troca volta para a lista de conversas; o clique numa notificação de outra sessão continua abrindo a conversa certa daquela sessão.
- **Edições feitas no celular** passam a aparecer na hora no painel aberto, marcadas como editadas.

---

## 2.4.0 — 13/11/2026

### Novidades
- **Base para o ZapHub para Windows:** o servidor passa a atender o programa do Windows, que chega na próxima versão, pelas rotas `/api/app/*`. Elas cobrem conversas, mensagens, envio de texto e de mídia, reações, encaminhar, apagar, arquivar, silenciar, fixar, marcar como não lida, contatos, verificação de número, foto e informações do contato ou grupo, e a busca dentro da conversa.
  - Usam o mesmo login do painel e as mesmas permissões da tela de conversas: cada pessoa só vê e mexe nas sessões a que tem acesso, e as sessões privadas continuam só do dono. A chave de API não vale nessas rotas.
  - Pedidos que alteram dados vindos de outro site são recusados.
  - A foto de perfil é buscada pelo próprio servidor; o endereço dela no WhatsApp não chega ao programa.

### Correções
- **Apagar só para mim:** com a sincronização de estado do WhatsApp desligada (o padrão), apagar uma mensagem recebida não manda mais nenhum comando de sincronização ao WhatsApp. A mensagem some só do ZapHub, e o aviso diz isso.
- **Mensagens editadas** passam a ficar marcadas como editadas (vale para as edições feitas a partir desta versão).

---

## 2.3.0 — 12/11/2026

### Novidades
- **Links do WhatsApp abrem no ZapHub:** os links "clique para conversar" (`api.whatsapp.com/send?phone=...&text=...`, `wa.me/...`, `whatsapp://send?...`) mostram o número, a sessão selecionada e o texto, e com o clique em **Abrir conversa** abrem a conversa no ZapHub com o texto pronto no campo. Nada é enviado sozinho. O número do link é internacional, como no WhatsApp, e é conferido antes (resolve o 9º dígito dos números antigos do Brasil).
  - Links desses dentro das conversas abrem no ZapHub, numa aba nova.
  - Em **Configurações > Links do WhatsApp**, o botão "Abrir links do WhatsApp no ZapHub" faz o navegador entregar ao ZapHub os links dos botões "Fale conosco pelo WhatsApp" dos sites. O aplicativo instalado também os recebe.
  - Endereço direto: `/dashboard/abrir?phone=5543999998888&text=Olá`.

### Correções
- Depois do login, o painel volta para o endereço completo que a pessoa tinha aberto (antes perdia os parâmetros).

---

## 2.2.0 — 12/11/2026

### Novidades
- **Sessão privada:** na lista de sessões, o dono pode usar **Tornar privada**. A sessão passa a ser só dele: nenhum outro usuário a vê, nem outro Super Administrador, no painel, na API, na auditoria, no gerenciador de mídia, no tempo real e nos webhooks de outras pessoas. Ela não pode ser compartilhada e as mensagens saem sem assinatura. As ferramentas de LGPD continuam alcançando todas as sessões.
- **Assinatura em negrito por sessão:** vem ligada nas sessões compartilhadas (para todos os usuários), desligada nas que só o dono usa e travada nas privadas. Cada pessoa pode ligar ou desligar a sua.

### Segurança
- **Auditoria do Supervisor:** mostra só as sessões a que ele tem acesso. Antes mostrava também as sessões pessoais da equipe e o que a equipe apagou em qualquer sessão, inclusive o conteúdo das mensagens apagadas.
- **Senha ou e-mail de outra pessoa** alterados por quem administra ficam no registro de acesso, e a pessoa recebe um aviso no painel.
- **Respostas automáticas pelo painel:** criar e editar exige poder gerenciar a sessão (antes bastava ter acesso) e a URL da mídia passa pelo mesmo filtro da API.

---

## 2.1.3 — 12/11/2026

### Segurança
- **API de respostas (`/reply`):** as duas rotas de resposta mandavam o conteúdo recebido direto ao WhatsApp, sem conferir. Com acesso à sessão, dava para pedir uma "imagem" com endereço de arquivo do servidor (`file://...`) e o servidor enviaria esse arquivo. Agora o corpo é validado e a mídia só é aceita por URL `http(s)`, baixada pelo mesmo filtro seguro do envio normal.

### Correções
- **API de envio (`/send`):** voltou a enviar texto. Aceita `"message": "Olá"` ou `"message": { "text": "Olá" }` (antes dava erro 500 ou 400).
- O campo `message` de `/send` e `/reply` aceita só campos conhecidos: `text`, `caption`, `image`, `video`, `audio`, `document`, `sticker` (mídia por URL), `fileName`, `mimetype` e `ptt`.

---

## 2.1.2 — 12/11/2026

### Correções
- **Mídia que sumiu do disco:** não aparece mais quebrada. As mídias recebidas ou enviadas a partir desta versão guardam os dados de download do WhatsApp: se o arquivo sumir (inclusive depois de "limpar mídias antigas" na Manutenção), a mensagem mostra **tentar de novo**, que baixa a mídia de novo enquanto o WhatsApp ainda a tiver. Mídias antigas, sem esses dados, aparecem como "Imagem indisponível no painel" (ou vídeo, áudio, arquivo).
- Texto "O imagem não baixou" corrigido para "A imagem não baixou".

### Segurança
- O navegador e a API REST de mensagens deixam de receber os dados de download das mídias (a chave da mídia no WhatsApp): a tela só fica sabendo se a mídia está baixando ou se falhou. Saiu o evento de tempo real `message.upsert`, sem uso, que mandava a mensagem crua do WhatsApp.
- Os dados de download guardados levam só o necessário para baixar (sem texto citado nem números de terceiros), e a retenção de mídias da LGPD apaga esses dados junto com o arquivo.

---

## 2.1.1 — 12/11/2026

Correções de uma revisão de segurança das versões 2.0.1 e 2.1.0.

### Segurança
- **Modo demonstração:** não guarda registros de acesso (IP e e-mail digitados por visitantes); registros de acesso, logs do servidor, manutenção, espaço em disco e exportação de dados ficam fechados também para leitura; o bloqueio por senhas erradas na conta de demonstração vale por IP. O acesso de teste na tela de entrada passa a depender do servidor estar mesmo em modo demonstração (antes dependia de uma variável do build).
- **Mensagem de voz:** o servidor confere pelos primeiros bytes se a gravação é webm, ogg ou mp4 e informa o formato ao ffmpeg, que deixa de aceitar listas de reprodução capazes de ler outros arquivos ou endereços. Cada conversão usa uma pasta temporária própria.
- **Downloads:** o nome do arquivo perde os caracteres que invertem o texto (usados para disfarçar, por exemplo, um `.exe` como `.pdf`).
- **Instalação:** a senha do administrador passada por variável não fica no ambiente do resto da instalação; se não der para conferir se já existe um Super Administrador, o instalador avisa como criar a conta.

### Correções
- Respostas automáticas na demonstração mostram o motivo da recusa (antes aparecia um erro genérico).

---

## 2.1.0 — 11/11/2026

### Novidades
- **Modo demonstração** (`ZAPHUB_DEMO=true`): o painel funciona com dados fictícios de uma cafeteria inventada, sem conectar nenhum WhatsApp. Alterações pela API e envios são recusados com uma mensagem clara, o painel mostra uma faixa de demonstração e a tela de entrada mostra o acesso de teste. Os dados são criados por `scripts/demo/popular-demo.ts`, que só roda num banco com "demo" no nome. Veja [docs/DEMO.md](docs/DEMO.md).
- **README com imagens** das principais telas, tiradas do modo demonstração.

### Correções
- Textos que apareciam em inglês: "Ontem" na lista de conversas, o status dos agendamentos ("Pendente", "Enviada", "Falhou") e o aviso de falha ao enviar.

---

## 2.0.1 — 11/11/2026

### Correções
- **Mensagem de voz no Android:** a voz gravada no painel chegava ao celular Android com o aviso "o áudio não está disponível porque há algo errado com o arquivo de áudio". A conversão no servidor agora usa 48 kbps (antes 160 kbps, acima do que o WhatsApp aceita em voz) e corrige os tempos do início da gravação. Testado no WhatsApp Web e no Android.
- **Onda da mensagem de voz:** a voz enviada passa a mostrar a onda do áudio no WhatsApp, como as gravadas no celular.
- **Downloads com o nome certo:** documentos baixam com o nome original de quem enviou (antes saíam com um código e sem extensão); fotos, vídeos e áudios baixam com o tipo, a data e a extensão real do arquivo. O cartão do documento na conversa mostra o nome do arquivo.
- **Página inicial:** o símbolo do ZapHub aparece no centro do diagrama (antes virava um bloco âmbar).

### Instalação
- **Conta do Super Administrador na instalação:** o instalador pergunta o nome, o e-mail e a senha (escondida, repetida, com no mínimo 8 caracteres) quando ainda não existe nenhum Super Administrador. A senha vai ao script por variável de ambiente, nunca pela linha de comando.
- Nomes técnicos unificados: serviço `zaphub` (e `zaphub-atualizar`), banco `zaphub`, pasta de mídia `/var/lib/zaphub/midia`, certificado `certificado-zaphub.crt` e instalador `instalar-certificado-zaphub.bat`.

### Segurança
- O servidor chama o `ffmpeg` pelo caminho completo, procurado só em pastas fixas do sistema (`/usr/bin`, `/usr/local/bin`, `/bin`), nunca pelo PATH. Instalações com o ffmpeg em outro lugar informam o caminho em `FFMPEG_PATH` (veja [docs/CONFIGURACAO.md](docs/CONFIGURACAO.md)).

---

## 2.0.0 — 10/11/2026

Primeira versão pública do ZapHub.

### Novidades
- Página inicial pública, tela de login e painel inicial novos (saudação, sessões, números do dia, atalhos e saúde do sistema para o Super Administrador).
- **Privacidade (LGPD):** aceite versionado dos Termos de Uso e da Política de Privacidade, "Meus dados" (baixar os próprios dados e excluir a conta), registro de pedidos de titulares, busca, exportação e exclusão dos dados de um contato, e retenção configurável de mensagens, mídias e logs com limpeza diária.
- **Manutenção pelo painel:** atualizar o sistema, reiniciar, ver logs, ver o que ocupa o disco e limpar, e mudar a pasta das mídias movendo os arquivos.
- **Conversas:** zoom e giro nas fotos, vídeo que pula para qualquer ponto, encaminhar mensagens (com o aviso "Encaminhada"), prévia de links, busca de conversas em contatos e mensagens, medidor de volume e trava contra áudio mudo na mensagem de voz.
- Documentação completa: instalação do zero, configuração, uso, LGPD, segurança e API.

### Segurança
- Mídias entregues só a quem tem acesso à conversa, conferido no banco; nenhum outro arquivo da pasta é servido.
- IP do cliente vem da conexão (e do proxy só com `TRUST_PROXY=true`), para que limites e registros não possam ser enganados.
- Verificação em duas etapas: trocar exige a senha (e o código atual), e um código não vale duas vezes; a pré-checagem do login conta no bloqueio de tentativas.
- Editar ou apagar uma mensagem guardada exige ser o autor; regras de resposta automática com expressão regular limitadas; limites de tamanho e de espaço em disco para mídia recebida.
- Nenhuma telemetria: o ZapHub não envia dados a terceiros.
- Verificação automática antes de cada versão: tipos, testes (inclusive com banco real), build, `npm audit`, gitleaks e SonarCloud. O atualizador só instala versões aprovadas e volta sozinho se a nova não responder.

Detalhes das proteções: [docs/SEGURANCA.md](docs/SEGURANCA.md).

### Licença
- Código sob a GNU AGPL-3.0. Avisos de terceiros em [CREDITOS.md](CREDITOS.md).
