import test from "node:test";
import assert from "node:assert/strict";
import { ondaDoPcm } from "../audio-voz";

function pcm(valores: number[]): Buffer {
    const b = Buffer.alloc(valores.length * 2);
    valores.forEach((v, i) => b.writeInt16LE(v, i * 2));
    return b;
}

test("onda tem 64 valores entre 0 e 100 e o mais alto vira 100", () => {
    const amostras: number[] = [];
    for (let i = 0; i < 64 * 100; i++) amostras.push(i < 32 * 100 ? 1000 : 8000);
    const onda = ondaDoPcm(pcm(amostras));
    assert.equal(onda.length, 64);
    assert.equal(Math.max(...onda), 100);
    assert.equal(onda[0], 12);   // 1000/8000
    assert.equal(onda[63], 100);
    assert.ok(onda.every((v) => v >= 0 && v <= 100));
});

test("silencio ou audio curto demais nao quebra (onda zerada)", () => {
    assert.deepEqual([...ondaDoPcm(pcm(new Array(640).fill(0)))], new Array(64).fill(0));
    assert.deepEqual([...ondaDoPcm(pcm([5, -5]))], new Array(64).fill(0));
    assert.equal(ondaDoPcm(Buffer.alloc(0)).length, 64);
});

test("amostras negativas contam pelo volume (valor absoluto)", () => {
    const onda = ondaDoPcm(pcm(new Array(64 * 10).fill(-16000)));
    assert.ok(onda.every((v) => v === 100));
});
