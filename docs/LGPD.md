# ZapHub e a LGPD: guia para quem instala

Este guia é para a organização que instala e usa o ZapHub. Ele explica que dados o sistema trata, quais recursos ajudam a cumprir a Lei Geral de Proteção de Dados (Lei 13.709/2018) e o que fica por conta da organização.

> **Este texto não é aconselhamento jurídico.** Ele descreve o software. As decisões sobre bases legais, prazos e textos devem ser tomadas com a sua assessoria jurídica.

## Quem é o controlador

O ZapHub é instalado e operado pela **própria organização**, no servidor dela. Por isso:

- a **organização que instala é a controladora** dos dados pessoais tratados ali: ela decide as finalidades, quem acessa, por quanto tempo guarda;
- o autor do software **não tem acesso** à sua instalação nem aos seus dados. O ZapHub não envia dados para fora do servidor, a não ser os que você configurar (por exemplo, webhooks) e a própria comunicação com o WhatsApp;
- se uma empresa instala e opera o ZapHub **para outra**, ela tende a atuar como operadora, e o contrato entre as duas deve dizer isso.

## Que dados o sistema trata

| Categoria | Exemplos | Onde fica |
| :--- | :--- | :--- |
| Usuários do painel | nome, e-mail, senha (só o hash), papel, chave de API, 2FA, aceites dos termos | banco |
| Log de acesso | logins (com IP), falhas, 2FA, criação e remoção de usuários, troca de papel e senha | banco |
| Contatos do WhatsApp | nome, número, foto, identificadores do WhatsApp | banco |
| Mensagens | texto, data, remetente, reações, mensagens apagadas (auditoria) | banco |
| Mídias | fotos, áudios, vídeos, documentos, figurinhas | disco (pasta de mídia) |
| Grupos | nome, participantes, administradores | banco |
| Organização e automação | etiquetas, agendamentos, disparos e seus destinatários, respostas automáticas | banco |
| Integrações | webhooks e o registro das entregas | banco |
| Credenciais das sessões do WhatsApp | chaves de pareamento | banco, cifradas (AES-256-GCM) |
| Pedidos de titulares | quem pediu, tipo, descrição, resposta | banco |

Mensagens e contatos podem conter **dados sensíveis** (saúde, religião, etc.) quando o próprio cliente os envia. Trate o conjunto todo com cuidado.

## Recursos de LGPD do sistema

### Aceite dos Termos de Uso e da Política de Privacidade

- Termos de Uso (`/terms`) e Política de Privacidade (`/privacy`) formam **um aceite só**, com uma versão (definida em `src/lib/termos.ts`, `VERSAO_TERMOS`).
- No cadastro, a caixa "Li e aceito os Termos de Uso e a Política de Privacidade" é obrigatória.
- No primeiro acesso (e sempre que a versão mudar), o usuário é levado à tela `/aceite` e só usa o painel depois de aceitar. Enquanto isso, as páginas do painel redirecionam para o aceite e a API responde `403` com `termos_pendentes`. Integrações por **chave de API** não são bloqueadas.
- Cada aceite é registrado com versão, data e hora, IP e navegador, e entra no log de acesso.
- Mudou o texto? Mude a versão: todos aceitam de novo no próximo acesso.

### Meus dados (todo usuário)

Em **Meus dados** (`/dashboard/meus-dados`), cada usuário pode:

- **baixar os próprios dados** num arquivo JSON (`meus-dados-zaphub.json`): conta (sem senha, sem a chave de API completa e sem o segredo do 2FA), aceites, o próprio log de acesso, sessões de que é dono, notificações e a quantidade de mensagens enviadas por ele;
- **excluir a própria conta**, confirmando a senha e digitando `EXCLUIR`. A exclusão desconecta as sessões do WhatsApp de que ele é dono, apaga os dados delas (inclusive as mídias) e fica registrada no log de acesso. O último Super Administrador não pode se excluir.

### Privacidade (Super Administrador)

Em **Privacidade** (`/dashboard/privacidade`):

- **Pedidos de titulares**: registre os pedidos que chegam dos contatos (acesso, correção, exclusão, oposição, outro), com descrição, e acompanhe o status (aberto, concluído, recusado) e a resposta dada.
- **Buscar um titular** pelo telefone (com ou sem 55 e o nono dígito): mostra, em todas as sessões, quantos contatos, mensagens, mídias, registros de auditoria e grupos existem sobre aquela pessoa.
- **Exportar** os dados do titular em JSON (contatos, mensagens com texto e data, lista de mídias), para responder a um pedido de acesso.
- **Apagar** os dados do titular, digitando `APAGAR`: mensagens e os arquivos de mídia delas, contatos, estado e etiquetas das conversas, auditoria daquela conversa, participações em disparos e agendamentos pendentes para ele. A ação fica registrada. Nada é enviado ao WhatsApp: a conversa continua no celular e no WhatsApp da pessoa.
- **Retenção**: prazos em dias (mínimo 30), ou vazio para guardar para sempre, para:
  - **mensagens** (apaga as mensagens mais antigas e os arquivos de mídia delas);
  - **mídias** (apaga os arquivos mais antigos; a mensagem fica, sem o arquivo);
  - **logs** (log de acesso, auditoria, entregas de webhook, disparos e notificações).
  
  A limpeza roda **todo dia às 03:00** no fuso do sistema, e pode ser executada na hora. A tela mostra a última execução e o resultado.

### Auditoria e log de acesso

- **Auditoria** (Super Administrador e Supervisor): mensagens apagadas, com o conteúdo, a conversa, quem apagou e por onde.
- **Auditoria de acesso** (Super Administrador): logins, falhas de login e de 2FA, logout, ativação e desativação do 2FA, criação e remoção de usuários, troca de papel e de senha, compartilhamento de sessões, manutenção e aceites dos termos.

### Segurança

- Senhas com hash (bcrypt); credenciais do WhatsApp cifradas no banco.
- 2FA (TOTP) para o Super Administrador; limite de tentativas de login e de cadastro.
- Papéis com acesso mínimo: nas sessões compartilhadas com ela, a Equipe só usa as conversas (não vê QR Code, webhooks nem configurações).
- HTTPS próprio ou por proxy reverso; Content-Security-Policy e cabeçalhos de segurança.

## Atenção: o histórico do WhatsApp pode voltar

O ZapHub guarda uma **cópia** do que passa pelo WhatsApp. Apagar dados no ZapHub (pela exclusão de titular ou pela retenção) **não apaga nada no WhatsApp**. Quando uma sessão é conectada de novo (novo QR Code ou código de pareamento), o WhatsApp pode reenviar o histórico recente das conversas, e mensagens apagadas podem voltar a aparecer. Depois de reconectar uma sessão, confira os pedidos de exclusão já atendidos e repita a exclusão se for preciso.

## Checklist da organização

- [ ] **Indicar o encarregado** (DPO) ou responsável por dados pessoais e divulgar o contato dele.
- [ ] **Adaptar os textos de `/terms` e `/privacy`** à sua organização, com a sua assessoria jurídica: nome da organização, contato do encarregado, finalidades, bases legais, compartilhamentos, prazos. Os textos ficam em `src/app/terms/page.tsx` e `src/app/privacy/page.tsx`; ao mudar, altere `VERSAO_TERMOS` e `VIGENCIA_TERMOS` em `src/lib/termos.ts` para todos aceitarem de novo. Mantenha essas mudanças num fork seu (mudanças locais podem travar a atualização; veja [INSTALACAO.md](INSTALACAO.md#12-atualizar)).
- [ ] **Definir os prazos de retenção** de mensagens, mídias e logs e configurá-los em Privacidade.
- [ ] **Definir a base legal** para falar com clientes pelo WhatsApp (execução de contrato, legítimo interesse, consentimento) e registrar a decisão.
- [ ] **Disparos e mensagens em massa**: só para quem tem relação com a organização ou autorizou o contato; ofereça uma forma simples de sair (opt-out) e respeite os pedidos. O ZapHub não tem uma lista de opt-out automática: controle quem recebe os disparos.
- [ ] **Informar os clientes** de que o atendimento é registrado num sistema da organização (por exemplo, na primeira mensagem ou no site).
- [ ] **Atender pedidos de titulares** pela tela Privacidade e responder dentro do prazo legal.
- [ ] **Segurança**: HTTPS, 2FA no Super Administrador, cadastro público desligado, firewall restrito a quem precisa, sistema atualizado, senhas fortes.
- [ ] **Backups** cifrados e com acesso restrito, com prazo de guarda definido. Lembre que um backup antigo restaurado traz de volta dados já excluídos.
- [ ] **Contratos**: com quem opera o servidor (provedor, empresa de TI) e com destinos de webhooks que recebem dados pessoais.
- [ ] **Incidentes**: tenha um plano para avaliar e comunicar incidentes de segurança à ANPD e aos titulares, quando exigido.
- [ ] **Treinar os atendentes** sobre o uso adequado dos dados das conversas.

## Uso não oficial do WhatsApp

O ZapHub se conecta ao WhatsApp por uma biblioteca não oficial (Baileys). Isso não é uma questão de LGPD, mas é um risco do serviço: o WhatsApp pode restringir números. Respeite os termos do WhatsApp e evite envios para quem não pediu.
