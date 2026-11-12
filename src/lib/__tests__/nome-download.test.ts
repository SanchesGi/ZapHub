import test from "node:test";
import assert from "node:assert/strict";
import { nomeParaDownload, limparNomeArquivo, extensaoDaMidia } from "../nome-download";

const ts = new Date(2026, 10, 11, 10, 15, 30); // 11/11/2026 10:15:30 no fuso local

test("documento baixa com o nome original", () => {
    assert.equal(nomeParaDownload({ type: "DOCUMENT", content: "Relatorio incidentes 2026-10.xlsx", mediaUrl: "/api/media/s-3EB0.xlsx", timestamp: ts }), "Relatorio incidentes 2026-10.xlsx");
});

test("documento sem extensao no nome ganha a do arquivo guardado", () => {
    assert.equal(nomeParaDownload({ type: "DOCUMENT", content: "contrato", mediaUrl: "/api/media/s-3EB0.pdf", timestamp: ts }), "contrato.pdf");
});

test("documento sem nome usa tipo e data", () => {
    assert.equal(nomeParaDownload({ type: "DOCUMENT", content: "", mediaUrl: "/api/media/s-3EB0.pdf", timestamp: ts }), "documento 2026-11-11 10-15-30.pdf");
});

test("foto, video e audio usam tipo, data e a extensao real", () => {
    assert.equal(nomeParaDownload({ type: "IMAGE", mediaUrl: "/api/media/s-1.png", timestamp: ts }), "foto 2026-11-11 10-15-30.png");
    assert.equal(nomeParaDownload({ type: "VIDEO", mediaUrl: "/api/media/s-1.mp4", timestamp: ts.toISOString() }), "video 2026-11-11 10-15-30.mp4");
    assert.equal(nomeParaDownload({ type: "AUDIO", mediaUrl: "/api/media/s-1.ogg", timestamp: ts.getTime() }), "audio 2026-11-11 10-15-30.ogg");
});

test("nome perigoso e limpo: sem pastas, sem caracteres proibidos, sem comecar com ponto", () => {
    assert.equal(limparNomeArquivo("../../etc/passwd"), "passwd");
    assert.equal(limparNomeArquivo("C:\\Users\\x\\nota<1>?.txt"), "nota1.txt");
    assert.equal(limparNomeArquivo(".bashrc"), "bashrc");
    assert.equal(limparNomeArquivo("a\u0000b\u001fc.pdf"), "abc.pdf");
    assert.equal(limparNomeArquivo("arquivo. . "), "arquivo");
    const longo = limparNomeArquivo("x".repeat(300) + ".pdf");
    assert.equal(longo.length, 150);
    assert.ok(longo.endsWith(".pdf"));
});

test("documento com nome que vira vazio depois de limpo usa tipo e data", () => {
    assert.equal(nomeParaDownload({ type: "DOCUMENT", content: '???', mediaUrl: "/api/media/s-1.pdf", timestamp: ts }), "documento 2026-11-11 10-15-30.pdf");
});

test("extensao so do fim do caminho", () => {
    assert.equal(extensaoDaMidia("/api/media/s-ABC.JPEG?x=1"), ".jpeg");
    assert.equal(extensaoDaMidia("/api/media/s-ABC"), "");
    assert.equal(extensaoDaMidia(null), "");
});

test("caracteres que invertem o texto sao removidos (nome disfarcado)", () => {
    assert.equal(limparNomeArquivo("fatura\u202Efdp.exe"), "faturafdp.exe");
    assert.equal(limparNomeArquivo("a\u2066b\u2069c\u200F.pdf"), "abc.pdf");
});
