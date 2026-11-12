import test from "node:test";
import assert from "node:assert/strict";
import { CHAVES_MIDIA, prepararMidiaSegura } from "../midia-segura";

test("o filtro conhece todas as chaves de midia do Baileys instalado", async () => {
    const { MEDIA_KEYS } = await import("@whiskeysockets/baileys");
    const faltam = (MEDIA_KEYS as string[]).filter((k) => !CHAVES_MIDIA.has(k));
    assert.deepEqual(faltam, [], "atualize CHAVES_MIDIA em src/lib/midia-segura.ts");
});

test("chave de midia rara com arquivo local e recusada (nao vai crua ao Baileys)", async () => {
    const buscar = async () => { throw new Error("SSRF Prevention: protocolo nao permitido"); };
    await assert.rejects(prepararMidiaSegura({ "biz-cover-photo": { url: "/dev/zero" } }, buscar));
    await assert.rejects(prepararMidiaSegura({ "thumbnail-link": { stream: {} } }, buscar), /não permitida/);
});
