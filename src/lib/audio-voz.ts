// minha versao: converte o audio gravado no navegador (webm/opus) para OGG/Opus, que e o formato
// que o WhatsApp mostra como MENSAGEM DE VOZ de verdade (PTT, com a ondinha e o play).
// - codec Opus, mono, 48 kHz, ~48 kbps (perto do que o proprio WhatsApp usa). Acima disso (antes 160k) o app do
//   Android recusava tocar ("ha algo errado com o arquivo de audio"), mesmo o arquivo tocando no navegador;
// - tempos zerados no inicio (-avoid_negative_ts make_zero): a gravacao do navegador (webm) comeca com tempo
//   negativo e o player do celular rejeita o ogg que herda isso; sem metadados do arquivo de origem;
// - onda do audio (waveform, 64 valores 0..100) calculada aqui, como o WhatsApp mostra na mensagem de voz;
// - corte de grave (handling/rumble) e supressao de ruido leve (afftdn) somada a do navegador;
// - execFile com lista de argumentos e timeout (nunca exec com string) — padrao da nota de seguranca.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile, readFile, unlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { logger } from "./logger";

const BITRATE = process.env.VOICE_OPUS_BITRATE || "48k"; // voz mono: 48k soa bem e o Android aceita
const DENOISE = process.env.VOICE_DENOISE !== "false";    // supressao de ruido extra no servidor (liga por padrao)
const TIMEOUT_MS = 30_000;

// ffmpeg por caminho completo, nunca pelo PATH (um "ffmpeg" falso numa pasta do PATH seria executado no lugar).
// FFMPEG_PATH (absoluto) escolhe outro; senao, as pastas fixas do sistema.
const CANDIDATOS_FFMPEG = ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/bin/ffmpeg"];
let ffmpegCache: string | undefined;
export function caminhoFfmpeg(): string {
    if (ffmpegCache) return ffmpegCache;
    const doEnv = process.env.FFMPEG_PATH;
    if (doEnv && path.isAbsolute(doEnv) && existsSync(doEnv)) return (ffmpegCache = doEnv);
    ffmpegCache = CANDIDATOS_FFMPEG.find((c) => existsSync(c)) || CANDIDATOS_FFMPEG[0];
    return ffmpegCache;
}

function ffmpeg(args: string[]): Promise<{ stderr: string }> {
    return new Promise((resolve, reject) => {
        execFile(caminhoFfmpeg(), args, { timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (erro, _stdout, stderr) => {
            if (erro) reject(Object.assign(erro, { stderr }));
            else resolve({ stderr: stderr || "" });
        });
    });
}

/** PCM 16 bits mono (8 kHz) do arquivo, para calcular a onda */
function pcmDoArquivo(arquivo: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        execFile(caminhoFfmpeg(), ["-v", "error", "-i", arquivo, "-ac", "1", "-ar", "8000", "-f", "s16le", "pipe:1"],
            { timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, encoding: "buffer" },
            (erro, stdout) => (erro ? reject(erro) : resolve(stdout as Buffer)));
    });
}

/**
 * onda da mensagem de voz: 64 valores de 0 a 100 (media do volume de cada pedaco, o maior vira 100).
 * Mesmo calculo do Baileys (getAudioWaveform), feito aqui porque o Baileys so calcula quando ele mesmo mede a duracao.
 */
export function ondaDoPcm(pcm: Buffer, pedacos = 64): Uint8Array {
    const total = Math.floor(pcm.length / 2);
    const tam = Math.floor(total / pedacos);
    const medias: number[] = [];
    for (let i = 0; i < pedacos; i++) {
        let soma = 0;
        for (let j = 0; j < tam; j++) soma += Math.abs(pcm.readInt16LE((i * tam + j) * 2)) / 32768;
        medias.push(tam ? soma / tam : 0);
    }
    const maior = Math.max(...medias);
    return Uint8Array.from(medias.map((m) => (maior > 0 ? Math.floor((m / maior) * 100) : 0)));
}

/** segundos a partir do "Duration: 00:00:03.45" do ffmpeg (fallback; o cliente manda o tempo real) */
function duracaoDoLog(stderr: string): number | undefined {
    const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
    if (!m) return undefined;
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

export async function paraVozOpus(entrada: Buffer): Promise<{ buffer: Buffer; seconds?: number; waveform?: Uint8Array }> {
    const dir = path.join(tmpdir(), "wa-voz");
    await mkdir(dir, { recursive: true });
    const id = crypto.randomBytes(8).toString("hex");
    const inPath = path.join(dir, `in_${id}`);
    const outPath = path.join(dir, `out_${id}.ogg`);

    try {
        await writeFile(inPath, entrada);
        const filtro = DENOISE ? "highpass=f=80,afftdn=nf=-20" : "highpass=f=80";
        const { stderr } = await ffmpeg([
            "-y", "-i", inPath,
            "-vn", "-map_metadata", "-1",
            "-ac", "1", "-ar", "48000",
            "-af", filtro,
            "-c:a", "libopus", "-b:a", BITRATE, "-vbr", "on", "-compression_level", "10", "-application", "voip",
            "-avoid_negative_ts", "make_zero",
            "-f", "ogg", outPath,
        ]);
        const buffer = await readFile(outPath);
        if (!buffer.length) throw new Error("saida vazia do ffmpeg");
        let waveform: Uint8Array | undefined;
        try {
            waveform = ondaDoPcm(await pcmDoArquivo(outPath));
        } catch {
            waveform = undefined; // sem onda a mensagem continua valendo
        }
        return { buffer, seconds: duracaoDoLog(stderr), waveform };
    } catch (e: any) {
        logger.error("Voz", `Falha ao converter audio de voz: ${e?.message || e}`);
        throw new Error("Não consegui preparar o áudio (ffmpeg). Confira se o ffmpeg está instalado na VM.");
    } finally {
        unlink(inPath).catch(() => {});
        unlink(outPath).catch(() => {});
    }
}
