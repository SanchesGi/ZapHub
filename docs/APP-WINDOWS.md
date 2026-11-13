# ZapHub para Windows

Programa nativo para Windows que se conecta ao servidor ZapHub da sua empresa. Faz o que a tela de conversas do painel faz, sem abrir o navegador.

## O que é

O **ZapHub para Windows** (escrito em Rust, com interface Slint) é um cliente do seu servidor ZapHub. Ele não acessa o WhatsApp sozinho: tudo passa pelo servidor, com o seu login e as suas permissões.

## Requisitos

- Windows 10 ou 11, 64 bits.
- Servidor ZapHub **2.4.0 ou mais novo** (é nele que ficam as rotas que o programa usa).
- O endereço `https` do servidor e uma conta de usuário do painel.

## Como instalar

Baixe o instalador (`.exe`) na página de versões do projeto: https://github.com/SanchesGi/ZapHub. Ao abrir, escolha uma das duas formas:

- **Para todos os usuários do computador:** precisa de administrador. O Windows pede a confirmação.
- **Só para o usuário atual:** não precisa de administrador.

O instalador mostra os termos de uso, grava um registro em `instalacao.log` e, no fim, abre a página do projeto.

## Primeiro acesso

1. Digite o endereço do servidor, começando com `https://`.
2. O programa mostra a **impressão digital** do certificado do servidor. Confira com o administrador do ZapHub, por um canal confiável, se ela é a mesma. Só confirme se for igual. Depois disso, o programa só conversa com o servidor que tiver esse certificado; se ele mudar, você é avisado.
3. Entre com seu e-mail e senha. Se a sua conta usa verificação em duas etapas (2FA), informe o código.
4. Leia e aceite os termos de uso.

## Recursos

- Sessões, conversas e mensagens em tempo real.
- Envio de texto, arquivos e mensagens de voz; nova conversa.
- Fotos e áudios dentro da conversa; fotos de perfil.
- Ações na mensagem: responder, reagir, encaminhar, apagar e buscar.
- Menu da conversa: arquivar, silenciar, fixar e marcar como não lida.
- Painel de informações do contato ou grupo.
- Notificações do Windows e ícone na bandeja.
- Iniciar com o Windows (opcional).
- Tela de configurações.

## Privacidade: o que fica no seu computador

- O endereço do servidor e a impressão digital confirmada.
- A sessão de login, guardada com a proteção do Windows (DPAPI): só o seu usuário do Windows consegue abri-la.
- As configurações do programa e o registro da instalação.

As mensagens e as mídias ficam no servidor da sua empresa. O programa não envia dados para nenhum outro lugar.

## Aviso do SmartScreen e assinatura digital

O instalador **não tem assinatura digital** (certificado de assinatura de código, que é pago). Por isso:

- O Windows SmartScreen pode mostrar **"O Windows protegeu o computador"**. Clique em **Mais informações** e depois em **Executar assim mesmo**.
- Alguns antivírus podem dar um alerta genérico para arquivos sem assinatura.

Para ter certeza de que o arquivo é o publicado, compare o SHA-256. Cada versão publica o valor do instalador. No PowerShell:

```powershell
Get-FileHash .\ZapHub-2.5.0-instalador.exe -Algorithm SHA256
```

O valor mostrado deve ser igual ao publicado. Se for diferente, não instale e avise pelas issues do projeto.

## Como desinstalar

Abra **Configurações > Aplicativos > Aplicativos instalados**, procure **ZapHub** e escolha **Desinstalar**. Para apagar também a sessão guardada, saia da conta no programa antes de desinstalar.

## Como compilar do código

Precisa de [Rust](https://rustup.rs) (instalado pelo `rustup`) e do [NSIS 3](https://nsis.sourceforge.io). Na raiz do projeto:

```powershell
powershell -ExecutionPolicy Bypass -File desktop\gerar-instalador.ps1
```

O script compila o programa e gera o instalador a partir de `desktop/instalador/zaphub.nsi`.

## Suporte

Dúvidas e erros: abra uma issue em https://github.com/SanchesGi/ZapHub. Falha de segurança: **não abra issue pública**; siga [.github/SECURITY.md](../.github/SECURITY.md).
