import test from "node:test";
import assert from "node:assert/strict";
import { primeiroLink, lerMetas, previaDoWhatsApp } from "../previa-link";

test("primeiroLink acha o link e tira a pontuacao do fim", () => {
    assert.equal(primeiroLink("veja https://exemplo.com.br/a?b=1."), "https://exemplo.com.br/a?b=1");
    assert.equal(primeiroLink("(https://exemplo.com/x)"), "https://exemplo.com/x");
    assert.equal(primeiroLink("wiki https://pt.wikipedia.org/wiki/Rio_(cidade) ok"), "https://pt.wikipedia.org/wiki/Rio_(cidade)");
    assert.equal(primeiroLink("site www.exemplo.com, ok"), "https://www.exemplo.com/");
    assert.equal(primeiroLink("sem link aqui"), null);
    assert.equal(primeiroLink("javascript:alert(1)"), null);
    assert.equal(primeiroLink(null), null);
});

test("lerMetas le og:, decodifica entidades e resolve imagem relativa", () => {
    const html = `<html><head>
        <title>Titulo da aba</title>
        <meta property="og:title" content="Loja &amp; Cia &#8211; Ofertas">
        <meta name='description' content='Descricao "boa"'>
        <meta property="og:image" content="/img/capa.png">
        <meta property="og:site_name" content="Loja">
    </head></html>`;
    const m = lerMetas(html, "https://loja.exemplo/produto/1");
    assert.equal(m.titulo, "Loja & Cia – Ofertas");
    assert.equal(m.descricao, 'Descricao "boa"');
    assert.equal(m.site, "Loja");
    assert.equal(m.imagem, "https://loja.exemplo/img/capa.png");
});

test("lerMetas acha og:title no fundo do <head> (pagina grande como a do YouTube)", () => {
    const html = "<html><head>" + "<script>var x=1;</script>".repeat(40_000) + '<meta property="og:title" content="Video longe"></head><body></body></html>';
    assert.ok(html.indexOf("og:title") > 800_000);
    assert.equal(lerMetas(html, "https://www.youtube.com/watch?v=x").titulo, "Video longe");
});

test("lerMetas usa o <title> quando nao ha og:title e aguenta HTML enorme", () => {
    const m = lerMetas("<title>So o titulo</title>" + "<div>".repeat(200_000), "https://x.exemplo");
    assert.equal(m.titulo, "So o titulo");
    assert.equal(m.imagem, null);
});

test("previaDoWhatsApp aproveita a previa recebida e ignora mensagem sem titulo", () => {
    const p = previaDoWhatsApp({ text: "olha https://x.exemplo", matchedText: "https://x.exemplo", title: "X", description: "Desc", jpegThumbnail: Buffer.from([0xff, 0xd8, 0xff]) });
    assert.equal(p?.url, "https://x.exemplo");
    assert.equal(p?.titulo, "X");
    assert.equal(p?.site, "x.exemplo");
    assert.ok(p?.miniatura?.startsWith("data:image/jpeg;base64,"));
    assert.equal(previaDoWhatsApp({ text: "oi", matchedText: "https://x.exemplo" }), null);
    // cartao apontando para outro site que nao o do texto: descartado
    assert.equal(previaDoWhatsApp({ text: "entre em https://banco.exemplo", matchedText: "https://banco.exemplo", canonicalUrl: "https://golpe.exemplo/login", title: "Banco" }), null);
    assert.equal(previaDoWhatsApp(null), null);
});
