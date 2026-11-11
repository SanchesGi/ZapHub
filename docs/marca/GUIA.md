# Marca do ZapHub: guia de uso

## A ideia

O símbolo é um **Z com núcleo**: o Z de Zap tem a diagonal interrompida por um ponto, o Hub. Tudo passa pelo centro antes de seguir. A marca é própria e não usa balão, telefone nem o verde do WhatsApp, e nenhuma tela do produto imita outro aplicativo.

## Arquivos

| Pasta | O que tem |
|---|---|
| `mestres/` | Originais em preto: símbolo, símbolo pequeno, assinatura horizontal, empilhada, só o nome, e o ladrilho do favicon. |
| `variantes/` | Preto, branco, âmbar `#F4A935`, âmbar escuro `#A8650A`, quadrado e ícone de app. |
| `png/` | Ícone do app 512 px e assinaturas em 1200 px. |
| `gerar_logo.py` | Gera tudo de novo a partir da geometria. Com `--app`, grava também os ícones do app (precisa de `pip install resvg_py`). |

No app: `src/components/marca/logo-zaphub.tsx` (`LogoZapHub`, `SimboloZapHub`, `NomeZapHub`) e os ícones em `src/app/` (`favicon.ico`, `icon.svg`, `apple-icon.png`, `manifest.ts`) e `public/` (`icon-192/512`, `maskable-512`).

## Cores

| Nome | HEX | Uso |
|---|---|---|
| Âmbar | `#F4A935` | Marca sobre fundo escuro. Cor principal. |
| Grafite | `#0D0E10` | Fundo do ícone e do favicon. |
| Âmbar escuro | `#A8650A` | Marca sobre fundo claro (o âmbar normal some no branco). |
| Preto / branco | `#000` / `#FFF` | Versões de uma cor (impressão, carimbo, documento). |

Azul e verde não entram na marca.

## Construção

- Diagonal em 45° exatos e quinas vivas nas pontas do Z. Simetria perfeita de 180° em volta do núcleo.
- As pontas da diagonal são cortadas em arco concêntrico ao núcleo, então o vão em volta dele é constante. Não emendar.
- Nome em JetBrains Mono ExtraBold, convertida em contornos (licença OFL, uso em logo permitido).

## Espaço livre e tamanho mínimo

- **x** = espessura da barra do Z. Deixar **2x** livres em volta de qualquer versão.
- Símbolo normal: a partir de **32 px**.
- Abaixo de **24 px** (aba do navegador, ícone na barra recolhida): usar o **corte pequeno** (`zaphub-simbolo-pequeno.svg` / `<SimboloZapHub pequeno />`), que tem traço, núcleo e vão maiores.
- Assinatura horizontal: a partir de **96 px** de largura.

## Fundos

- Escuro: âmbar `#F4A935` ou branco.
- Claro: âmbar escuro `#A8650A` ou preto.
- Sobre foto ou fundo agitado: usar o ícone (ladrilho grafite) em vez da marca solta.

## Não fazer

- Esticar, inclinar ou girar.
- Trocar a cor por verde, azul ou degradê; pôr sombra ou brilho.
- Separar o núcleo do Z, ou trocá-lo por outra forma.
- Colocar o símbolo dentro de balão de conversa.
- Imitar o visual de outro aplicativo.
- Redesenhar o nome com outra fonte ou digitar "ZapHub" como texto ao lado do símbolo: usar os arquivos.
- Usar o símbolo normal em 16 px.

## Movimento

A moldura animada em volta do nome (`.moldura-marca`) não altera o logo: é um elemento à parte, fora do espaço livre. Na animação do login, o Z se desenha traço a traço e o núcleo aparece por último.

## Pendente

- Pesquisa de marca registrada antes de qualquer uso fora da empresa.
