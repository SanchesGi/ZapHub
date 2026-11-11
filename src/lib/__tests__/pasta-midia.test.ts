import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { validarCaminho, nomeDeMidiaValido, nomeDoMediaUrl, prepararPasta, ehPastaDeMidia, PASTA_PADRAO } from "../pasta-midia";

test("ehPastaDeMidia so aceita a padrao ou pasta marcada", async () => {
    assert.equal(await ehPastaDeMidia(PASTA_PADRAO), true);
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "wa-marca-"));
    try {
        assert.equal(await ehPastaDeMidia(base), false, "pasta de outro programa");
        await prepararPasta(base);
        assert.equal(await ehPastaDeMidia(base), true);
    } finally {
        await fs.rm(base, { recursive: true, force: true });
    }
});

test("validarCaminho aceita pasta de dados fora do app", () => {
    const r = validarCaminho("/var/lib/zaphub/midia/");
    assert.deepEqual(r, { ok: true, pasta: "/var/lib/zaphub/midia" });
    assert.equal(validarCaminho("/mnt/dados/midia").ok, true);
});

test("validarCaminho aceita voltar para a pasta padrao", () => {
    assert.deepEqual(validarCaminho(PASTA_PADRAO), { ok: true, pasta: PASTA_PADRAO });
});

test("validarCaminho recusa pastas do sistema, do app e caminhos com truques", () => {
    for (const ruim of [
        "", "/", "/var", "/etc/wa", "/etc", "/root/midia", "/proc/self", "/usr/local/midia", "/var/log/wa",
        "/var/lib/mysql/x", "relativo/midia", "/var/lib/../etc/x", "/var/lib/./x", "/var/lib/wa;rm -rf /",
        "/var/lib/zap hub", "/var/lib/$(id)", "/var/lib/`id`", "C:\\dados", "/var/lib/" + "a".repeat(300),
        process.cwd(), path.join(process.cwd(), "data"), path.dirname(process.cwd()),
    ]) {
        assert.equal(validarCaminho(ruim).ok, false, ruim);
    }
});

test("nomeDeMidiaValido so aceita <sessao>-<mensagem>.<ext>", () => {
    assert.equal(nomeDeMidiaValido("vendas-1-3EB0ABC123.jpg"), true);
    assert.equal(nomeDeMidiaValido("s-ABC.ogg"), true);
    for (const ruim of [".env", "..", "a.jpg", "-x.jpg", "a-b", "a-b.", "a/b-c.jpg", "a-b.jpg/..", "a-..jpg", "a-b.jpeg123456789", "x".repeat(300) + "-a.jpg", ".zaphub-midia"]) {
        assert.equal(nomeDeMidiaValido(ruim), false, ruim);
    }
});

test("nomeDoMediaUrl extrai o nome so do formato /api/media/<nome>", () => {
    assert.equal(nomeDoMediaUrl("/api/media/vendas-ABC.jpg"), "vendas-ABC.jpg");
    assert.equal(nomeDoMediaUrl("/api/media/vendas-ABC.jpg?x=1"), null);
    assert.equal(nomeDoMediaUrl("/api/media/..%2F.env"), null);
    assert.equal(nomeDoMediaUrl("data/media/vendas-ABC.jpg"), null);
    assert.equal(nomeDoMediaUrl(null), null);
});

test("prepararPasta aceita pasta vazia, grava a marca e recusa pasta com outros arquivos", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "wa-midia-"));
    try {
        const vazia = path.join(base, "nova", "midia");
        assert.deepEqual(await prepararPasta(vazia), { ok: true });
        await fs.access(path.join(vazia, ".zaphub-midia"));

        // ja marcada: aceita de novo mesmo com midias dentro
        await fs.writeFile(path.join(vazia, "s-ABC.jpg"), "x");
        assert.deepEqual(await prepararPasta(vazia), { ok: true });

        const alheia = path.join(base, "alheia");
        await fs.mkdir(alheia);
        await fs.writeFile(path.join(alheia, "senhas.txt"), "x");
        const r = await prepararPasta(alheia);
        assert.equal(r.ok, false);
    } finally {
        await fs.rm(base, { recursive: true, force: true });
    }
});

