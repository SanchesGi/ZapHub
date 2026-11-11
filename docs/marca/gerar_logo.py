"""Gera a marca do ZapHub ("Z com nucleo") a partir da geometria, sem depender de fonte instalada.

Construcao (tela de 256, centro em 128,128, simetria de 180 graus):
  - Z de tres tracos com diagonal em 45 graus exatos e quinas vivas.
  - A diagonal e interrompida por um nucleo redondo no centro; o corte das pontas e concentrico
    ao nucleo, entao o vao em volta dele e constante.
  - Corte pequeno (<= 24 px): traco, nucleo e vao maiores, para o nucleo sobreviver em 16 px.

O nome vem de mestres/zaphub-nome.svg (JetBrains Mono ExtraBold em contornos, licenca OFL).

Uso: python docs/marca/gerar_logo.py [--app]
  --app tambem grava os icones em src/app/ e public/. PNG e ICO precisam de: pip install resvg_py
"""
import io
import math
import os
import re
import struct
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(BASE))
GRAFITE, AMBAR, AMBAR_ESC = "#0D0E10", "#F4A935", "#A8650A"


def metade_z(traco, topo, canto, inicio, nucleo, vao):
    """Metade de cima do Z: barra + diagonal ate o corte concentrico ao nucleo."""
    h = traco / 2
    alto, baixo = topo, topo + traco
    centro_y = topo + h
    soma = canto + centro_y                 # a diagonal do centro e x + y = 256
    if abs(soma - 256) > 1e-6:
        raise ValueError("a diagonal precisa passar pelo centro")
    n = h * math.sqrt(2)                    # deslocamento em x + y das bordas da diagonal
    ponta = 256 + n - alto                  # x da quina viva na borda de cima
    canto_int = 256 - n - baixo             # x da quina interna na borda de baixo
    r = nucleo + vao
    ao_longo = math.sqrt(r * r - h * h) / math.sqrt(2)
    fora = (128 + h / math.sqrt(2) + ao_longo, 128 + h / math.sqrt(2) - ao_longo)
    dentro = (128 - h / math.sqrt(2) + ao_longo, 128 - h / math.sqrt(2) - ao_longo)
    pontos = dict(alto=alto, baixo=baixo, ponta=ponta, canto_int=canto_int, inicio=inicio,
                  fora=fora, dentro=dentro, r=r)
    return pontos


def caminho(p):
    return (f"M{p['inicio']:.1f} {p['alto']:.1f}H{p['ponta']:.1f}"
            f"L{p['fora'][0]:.1f} {p['fora'][1]:.1f}"
            f"A{p['r']:.1f} {p['r']:.1f} 0 0 0 {p['dentro'][0]:.1f} {p['dentro'][1]:.1f}"
            f"L{p['canto_int']:.1f} {p['baixo']:.1f}H{p['inicio']:.1f}Z")


def girado(p):
    g = lambda x, y: (256 - x, 256 - y)
    fx, fy = g(*p["fora"])
    dx, dy = g(*p["dentro"])
    return (f"M{256 - p['inicio']:.1f} {256 - p['alto']:.1f}H{256 - p['ponta']:.1f}"
            f"L{fx:.1f} {fy:.1f}"
            f"A{p['r']:.1f} {p['r']:.1f} 0 0 0 {dx:.1f} {dy:.1f}"
            f"L{256 - p['canto_int']:.1f} {256 - p['baixo']:.1f}H{256 - p['inicio']:.1f}Z")


def corpo(traco, topo, canto, inicio, nucleo, vao):
    p = metade_z(traco, topo, canto, inicio, nucleo, vao)
    return f'<path d="{caminho(p)}"/><path d="{girado(p)}"/><circle cx="128" cy="128" r="{nucleo}"/>', p


NORMAL, P_NORMAL = corpo(traco=28, topo=40, canto=202, inicio=22, nucleo=22, vao=20)
PEQUENO, P_PEQUENO = corpo(traco=40, topo=40, canto=196, inicio=14, nucleo=28, vao=22)

nome_svg = open(os.path.join(BASE, "mestres", "zaphub-nome.svg"), encoding="utf-8").read()
NOME_D = re.search(r' d="([^"]+)"', nome_svg).group(1)
NOME_L, NOME_A = 479.5, 132.1
TITULO = '<title>ZapHub</title>'


def svg(viewbox, miolo, cor):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{viewbox}" role="img" aria-label="ZapHub">'
            f'{TITULO}<g fill="{cor}">{miolo}</g></svg>')


def caixa(p):
    x0 = 256 - p["ponta"]
    return f"{x0:.1f} {p['alto']:.1f} {p['ponta'] - x0:.1f} {256 - 2 * p['alto']:.1f}"


def nome(escala, x, y):
    return f'<path transform="translate({x} {y}) scale({escala})" d="{NOME_D}"/>'


# (viewBox, miolo) de cada assinatura
ESC_H = 1.16
X_H = 272
FORMAS = {
    "simbolo": (caixa(P_NORMAL), NORMAL),
    "simbolo-pequeno": (caixa(P_PEQUENO), PEQUENO),
    "nome": (f"0 0 {NOME_L} {NOME_A}", nome(1, 0, 0)),
    "horizontal": (f"20 36 {X_H + NOME_L * ESC_H - 20:.1f} 192",
                   NORMAL + nome(ESC_H, X_H, 70)),
    "empilhado": (f"0 36 {NOME_L * 0.6:.1f} 284",
                  f'<g transform="translate({(NOME_L * 0.6 - 256) / 2:.1f} 0)">{NORMAL}</g>' + nome(0.6, 0, 238)),
}


def ladrilho(miolo, escala, raio=56, margem=0.96, cor=AMBAR):
    """Marca centrada sobre o grafite. margem < 1 deixa folga para o canto arredondado."""
    t = (256 - 256 * escala) / 2
    m = (256 - 256 * margem) / 2
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">{TITULO}'
            f'<g transform="translate({m:.2f} {m:.2f}) scale({margem})">'
            f'<rect width="256" height="256" rx="{raio}" fill="{GRAFITE}"/>'
            f'<g fill="{cor}" transform="translate({t:.2f} {t:.2f}) scale({escala})">{miolo}</g></g></svg>')


def grava(caminho_rel, texto):
    alvo = os.path.join(BASE, caminho_rel)
    os.makedirs(os.path.dirname(alvo), exist_ok=True)
    with open(alvo, "w", encoding="utf-8", newline="\n") as f:
        f.write(texto)


def gerar_svgs():
    for chave, (vb, miolo) in FORMAS.items():
        if chave != "nome":   # o nome e a fonte de tudo: nao se reescreve
            grava(f"mestres/zaphub-{chave}.svg", svg(vb, miolo, "#111111"))
        if chave == "simbolo-pequeno":
            continue
        for sufixo, cor in (("black", "#000000"), ("white", "#FFFFFF"),
                            ("mono-f4a935", AMBAR), ("mono-a8650a", AMBAR_ESC)):
            grava(f"variantes/zaphub-{chave}-{sufixo}.svg", svg(vb, miolo, cor))
    grava("mestres/zaphub-favicon-ladrilho.svg", ladrilho(PEQUENO, 0.8, raio=48))
    grava("variantes/zaphub-simbolo-favicon.svg", ladrilho(PEQUENO, 0.8, raio=48))
    grava("variantes/zaphub-simbolo-app-icon.svg", ladrilho(NORMAL, 0.82))
    grava("variantes/zaphub-simbolo-square.svg",
          f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img" aria-label="ZapHub">'
          f'{TITULO}<g fill="#111111">{NORMAL}</g></svg>')


def png(texto, largura):
    try:
        import resvg_py
    except ImportError:
        sys.exit("Falta o renderizador: pip install resvg_py")
    return bytes(resvg_py.svg_to_bytes(svg_string=texto, width=largura))


def ico(tamanhos, texto):
    imagens = [png(texto, t) for t in tamanhos]
    saida = io.BytesIO()
    saida.write(struct.pack("<HHH", 0, 1, len(imagens)))
    pos = 6 + 16 * len(imagens)
    for t, dado in zip(tamanhos, imagens):
        saida.write(struct.pack("<BBBBHHII", t % 256, t % 256, 0, 0, 1, 32, len(dado), pos))
        pos += len(dado)
    for dado in imagens:
        saida.write(dado)
    return saida.getvalue()


def bin_grava(alvo, dado):
    os.makedirs(os.path.dirname(alvo), exist_ok=True)
    with open(alvo, "wb") as f:
        f.write(dado)


def gerar_pngs():
    pasta = os.path.join(BASE, "png")
    bin_grava(os.path.join(pasta, "zaphub-simbolo-app-icon-512.png"), png(ladrilho(NORMAL, 0.82), 512))
    for chave, cor, sufixo in (("horizontal", AMBAR, "mono-f4a935"), ("horizontal", AMBAR_ESC, "mono-a8650a"),
                               ("empilhado", AMBAR, "mono-f4a935")):
        vb, miolo = FORMAS[chave]
        bin_grava(os.path.join(pasta, f"zaphub-{chave}-{sufixo}-1200.png"), png(svg(vb, miolo, cor), 1200))


def gerar_app():
    app = os.path.join(RAIZ, "src", "app")
    pub = os.path.join(RAIZ, "public")
    favicon = ladrilho(PEQUENO, 0.8, raio=48)
    icone = ladrilho(NORMAL, 0.82)
    # sangrado: sem canto e com a marca dentro da area segura (80 %) do icone mascaravel
    sangrado = ladrilho(NORMAL, 0.56, raio=0, margem=1)
    with open(os.path.join(app, "icon.svg"), "w", encoding="utf-8", newline="\n") as f:
        f.write(favicon)
    bin_grava(os.path.join(app, "favicon.ico"), ico([16, 32, 48], favicon))
    bin_grava(os.path.join(app, "apple-icon.png"), png(ladrilho(NORMAL, 0.68, raio=0, margem=1), 180))
    bin_grava(os.path.join(pub, "icon-192.png"), png(icone, 192))
    bin_grava(os.path.join(pub, "icon-512.png"), png(icone, 512))
    bin_grava(os.path.join(pub, "maskable-512.png"), png(sangrado, 512))


if __name__ == "__main__":
    gerar_svgs()
    gerar_pngs()
    if "--app" in sys.argv:
        gerar_app()
    print("normal:", caminho(P_NORMAL), "| caixa", caixa(P_NORMAL))
    print("pequeno:", caminho(P_PEQUENO), "| caixa", caixa(P_PEQUENO))
    print("giro normal:", girado(P_NORMAL))
    print("giro pequeno:", girado(P_PEQUENO))
