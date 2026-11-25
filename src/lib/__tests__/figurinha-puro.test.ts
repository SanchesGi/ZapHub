import test from "node:test";
import assert from "node:assert/strict";
import {
    MAX_BYTES_FIGURINHA, MAX_FIGURINHAS_POR_USUARIO, ehWebp, ehWebpAnimado, hashDe, hashDoArquivo, hashValido,
    nomeArquivoFigurinha, ordenarFigurinhas, validarFigurinha,
} from "../figurinha-puro";

/** webp minimo de mentira: so o cabecalho RIFF/WEBP (e VP8X com a flag de animacao, se pedido) */
function webp(opcoes: { animado?: boolean; tamanho?: number } = {}): Buffer {
    const b = Buffer.alloc(opcoes.tamanho ?? 64, 0);
    b.write("RIFF", 0, "ascii");
    b.writeUInt32LE(b.length - 8, 4);
    b.write("WEBP", 8, "ascii");
    b.write("VP8X", 12, "ascii");
    b.writeUInt32LE(10, 16);
    b[20] = opcoes.animado ? 0x02 : 0x00;
    return b;
}

test("so e webp quem tem o cabecalho RIFF....WEBP", () => {
    assert.equal(ehWebp(webp()), true);
    assert.equal(ehWebp(Buffer.from("isto nao e um webp, e texto comprido")), false);
    assert.equal(ehWebp(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])), false);
    assert.equal(ehWebp(Buffer.alloc(0)), false);
    assert.equal(ehWebp(Buffer.from("RIFF")), false);
});

test("webp animado e o que tem o bit de animacao no VP8X", () => {
    assert.equal(ehWebpAnimado(webp({ animado: true })), true);
    assert.equal(ehWebpAnimado(webp({ animado: false })), false);
    assert.equal(ehWebpAnimado(Buffer.from("nada a ver com webp, so texto")), false);
});

test("nome do arquivo vem do hash sha256 e nada mais", () => {
    const hash = hashDe(webp());
    assert.equal(hashValido(hash), true);
    assert.equal(nomeArquivoFigurinha(hash), `figurinhas/${hash}.webp`);
    assert.equal(nomeArquivoFigurinha("../../etc/passwd"), null);
    assert.equal(nomeArquivoFigurinha(hash.toUpperCase()), null);
    assert.equal(nomeArquivoFigurinha(hash.slice(1)), null);
});

test("o hash e estavel e muda com o conteudo", () => {
    assert.equal(hashDe(webp()), hashDe(webp()));
    assert.notEqual(hashDe(webp()), hashDe(webp({ animado: true })));
});

test("hashDoArquivo recusa caminho que foge da pasta", () => {
    const hash = hashDe(webp());
    assert.equal(hashDoArquivo(`figurinhas/${hash}.webp`), hash);
    assert.equal(hashDoArquivo(`figurinhas/../${hash}.webp`), null);
    assert.equal(hashDoArquivo(`outra/${hash}.webp`), null);
    assert.equal(hashDoArquivo(`figurinhas/${hash}.png`), null);
    assert.equal(hashDoArquivo(`/figurinhas/${hash}.webp`), null);
    assert.equal(hashDoArquivo(null), null);
});

test("validar: aceita um webp pequeno e devolve hash, nome e se e animada", () => {
    const dados = webp({ animado: true });
    const v = validarFigurinha(dados, 0);
    assert.ok(v.ok);
    if (v.ok) {
        assert.equal(v.hash, hashDe(dados));
        assert.equal(v.arquivo, `figurinhas/${v.hash}.webp`);
        assert.equal(v.animada, true);
        assert.equal(v.bytes, dados.length);
    }
});

test("validar: recusa vazio, formato errado e acima de 1 MB", () => {
    assert.equal(validarFigurinha(Buffer.alloc(0), 0).ok, false);
    assert.equal(validarFigurinha(Buffer.from("conteudo qualquer que nao e webp, longo o bastante"), 0).ok, false);
    const grande = validarFigurinha(webp({ tamanho: MAX_BYTES_FIGURINHA + 1 }), 0);
    assert.equal(grande.ok, false);
    if (!grande.ok) assert.match(grande.erro, /1 MB/);
    assert.equal(validarFigurinha(webp({ tamanho: MAX_BYTES_FIGURINHA }), 0).ok, true);
});

test("validar: 300 por usuario; a que ele ja tem continua valendo no limite", () => {
    const dados = webp();
    const cheio = validarFigurinha(dados, MAX_FIGURINHAS_POR_USUARIO);
    assert.equal(cheio.ok, false);
    if (!cheio.ok) assert.match(cheio.erro, /300/);
    assert.equal(validarFigurinha(dados, MAX_FIGURINHAS_POR_USUARIO - 1).ok, true);
    assert.equal(validarFigurinha(dados, MAX_FIGURINHAS_POR_USUARIO, (h) => h === hashDe(dados)).ok, true);
});

test("ordenar: usadas por ultimo primeiro, depois as nunca usadas da mais nova para a mais antiga", () => {
    const lista = [
        { id: "nunca-velha", criadaEm: "2026-01-01T00:00:00Z", usadaEm: null },
        { id: "usada-antes", criadaEm: "2026-01-02T00:00:00Z", usadaEm: "2026-03-01T00:00:00Z" },
        { id: "nunca-nova", criadaEm: "2026-02-01T00:00:00Z", usadaEm: null },
        { id: "usada-agora", criadaEm: "2026-01-03T00:00:00Z", usadaEm: new Date("2026-04-01T00:00:00Z") },
    ];
    assert.deepEqual(ordenarFigurinhas(lista).map((f) => f.id), ["usada-agora", "usada-antes", "nunca-nova", "nunca-velha"]);
    assert.equal(lista[0].id, "nunca-velha"); // nao muda a lista original
});
