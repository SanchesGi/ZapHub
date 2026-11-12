# Atualizações do ZapHub

O ZapHub recebe correções e melhorias com frequência. Cada versão publicada aparece aqui, da mais nova para a mais antiga, com o que mudou para quem usa e para quem instala.

Como atualizar uma instalação: **Manutenção > Sistema > Atualizar agora**, no painel (veja [docs/INSTALACAO.md](docs/INSTALACAO.md#12-atualizar)).

Encontrou um erro? Abra uma issue. Falha de segurança: **não abra issue pública**; siga [.github/SECURITY.md](.github/SECURITY.md).

O número da versão segue o padrão `MAIOR.MENOR.CORREÇÃO`: a última parte sobe em correções, a do meio em recursos novos e a primeira em mudanças que exigem cuidado ao atualizar.

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
