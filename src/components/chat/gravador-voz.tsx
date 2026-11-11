"use client";

// minha versao: grava mensagem de voz pelo microfone (como no WhatsApp).
// - supressao de ruido + cancelamento de eco + ganho automatico (o mesmo processamento WebRTC que o Messenger usa);
// - grava em Opus (webm/opus) na maior taxa que o navegador aceita; o servidor converte para ogg/opus (ver lib/audio-voz).
// - toque no microfone para gravar; durante a gravacao: lixeira (cancela) e seta (envia). Cancela com Esc.
// - medidor de volume ao vivo e trava contra audio mudo: se o microfone so entregou silencio (mudo no Windows,
//   dispositivo errado, outro programa segurando o microfone), nao envia e avisa. Antes o audio chegava mudo.
import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Send, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// pico abaixo disso na gravacao inteira = silencio (~ -54 dBFS; um microfone ligado sempre capta mais que isso)
const LIMIAR_SILENCIO = 0.002;

function mmss(seg: number) {
    const m = Math.floor(seg / 60);
    const s = seg % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
}

// escolhe o melhor tipo que ESTE navegador grava (Opus de preferencia)
function melhorMime(): string | undefined {
    if (typeof MediaRecorder === "undefined") return undefined;
    const tipos = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm", "audio/mp4"];
    return tipos.find((t) => { try { return MediaRecorder.isTypeSupported(t); } catch { return false; } });
}

export function GravadorVoz({ onEnviar, disabled }: { onEnviar: (file: File, segundos: number) => Promise<void> | void; disabled?: boolean }) {
    const [gravando, setGravando] = useState(false);
    const [enviando, setEnviando] = useState(false);
    const [segundos, setSegundos] = useState(0);

    const recRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const cancelarRef = useRef(false);
    const segRef = useRef(0);
    // medidor de volume
    const [nivel, setNivel] = useState(0);
    const ctxRef = useRef<AudioContext | null>(null);
    const rafRef = useRef<number | null>(null);
    const picoRef = useRef(0);

    const pararMedidor = useCallback(() => {
        if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
        ctxRef.current?.close().catch(() => {});
        ctxRef.current = null;
        setNivel(0);
    }, []);

    /** le o volume do microfone ~10x por segundo: mostra o medidor e guarda o maior pico da gravacao */
    const iniciarMedidor = useCallback((stream: MediaStream) => {
        try {
            const ctx = new AudioContext();
            const analisador = ctx.createAnalyser();
            analisador.fftSize = 2048;
            ctx.createMediaStreamSource(stream).connect(analisador);
            ctxRef.current = ctx;
            const dados = new Float32Array(analisador.fftSize);
            let ultimo = 0;
            const ler = (t: number) => {
                analisador.getFloatTimeDomainData(dados);
                let pico = 0;
                for (const v of dados) { const a = Math.abs(v); if (a > pico) pico = a; }
                if (pico > picoRef.current) picoRef.current = pico;
                if (t - ultimo > 100) { ultimo = t; setNivel(pico); }
                rafRef.current = requestAnimationFrame(ler);
            };
            rafRef.current = requestAnimationFrame(ler);
        } catch {
            picoRef.current = 1; // sem Web Audio: nao da para medir, entao nao bloqueia o envio
        }
    }, []);

    const pararTudo = useCallback(() => {
        pararMedidor();
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        recRef.current = null;
        setGravando(false);
    }, [pararMedidor]);

    useEffect(() => () => pararTudo(), [pararTudo]); // limpa se o componente sair no meio da gravacao

    const iniciar = useCallback(async () => {
        if (disabled || gravando || enviando) return;
        if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
            // fora de HTTPS o navegador nem expoe o microfone (e nao mostra o pedido de permissao)
            toast.error(window.isSecureContext === false
                ? "O microfone só funciona em conexão segura. Abra o painel pelo endereço https://."
                : "Este navegador não dá acesso ao microfone.");
            return;
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,   // supressao de ruido (WebRTC) — igual ao Messenger
                    autoGainControl: true,
                    channelCount: 1,
                    sampleRate: 48000,
                } as MediaTrackConstraints,
            });
            streamRef.current = stream;
            const mimeType = melhorMime();
            const rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 128000 });
            recRef.current = rec;
            chunksRef.current = [];
            cancelarRef.current = false;
            segRef.current = 0;
            picoRef.current = 0;
            setSegundos(0);
            iniciarMedidor(stream);

            rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
            rec.onstop = async () => {
                const tipo = rec.mimeType || mimeType || "audio/webm";
                const blob = new Blob(chunksRef.current, { type: tipo });
                const dur = segRef.current;
                const pico = picoRef.current;
                pararTudo();
                if (cancelarRef.current) return;              // cancelado: nao envia
                if (!blob.size || dur < 1) { toast.info("Gravação muito curta."); return; }
                if (pico < LIMIAR_SILENCIO) {
                    toast.error("O microfone não captou som, então o áudio não foi enviado. Confira se ele não está mudo, se é o microfone certo no navegador (ícone de câmera/microfone na barra de endereço) e se outro programa não está usando.", { duration: 10000 });
                    return;
                }
                const ext = tipo.includes("ogg") ? "ogg" : tipo.includes("mp4") ? "m4a" : "webm";
                const file = new File([blob], `voz-${Date.now()}.${ext}`, { type: tipo });
                try {
                    setEnviando(true);
                    await onEnviar(file, dur);
                } catch (e: any) {
                    toast.error(e?.message || "Não consegui enviar o áudio.");
                } finally {
                    setEnviando(false);
                }
            };

            rec.start();
            setGravando(true);
            timerRef.current = setInterval(() => {
                segRef.current += 1;
                setSegundos(segRef.current);
                if (segRef.current >= 600) finalizar(false); // trava de seguranca: 10 min
            }, 1000);
        } catch (e: any) {
            pararTudo();
            if (e?.name === "NotAllowedError") toast.error("Permissão do microfone negada. Libere o microfone para este site.");
            else if (e?.name === "NotFoundError") toast.error("Nenhum microfone encontrado neste computador.");
            else toast.error("Não consegui acessar o microfone.");
        }
    }, [disabled, gravando, enviando, onEnviar, pararTudo, iniciarMedidor]);

    const finalizar = useCallback((cancelar: boolean) => {
        cancelarRef.current = cancelar;
        const rec = recRef.current;
        if (rec && rec.state !== "inactive") rec.stop();  // dispara o onstop (envia ou descarta)
        else pararTudo();
    }, [pararTudo]);

    // Esc cancela
    useEffect(() => {
        if (!gravando) return;
        const h = (e: KeyboardEvent) => { if (e.key === "Escape") finalizar(true); };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [gravando, finalizar]);

    if (enviando) {
        return (
            <Button type="button" size="icon" className="h-9 w-9 rounded-full shrink-0" disabled>
                <Loader2 className="h-4 w-4 animate-spin" />
            </Button>
        );
    }

    if (!gravando) {
        return (
            <Button type="button" variant="ghost" size="icon" onClick={iniciar} disabled={disabled}
                className="h-9 w-9 rounded-full shrink-0 text-muted-foreground hover:text-foreground" title="Gravar mensagem de voz">
                <Mic className="h-4 w-4" />
            </Button>
        );
    }

    return (
        <div className="flex items-center gap-1.5 shrink-0">
            <button type="button" onClick={() => finalizar(true)} title="Cancelar (Esc)"
                className="h-9 w-9 rounded-full flex items-center justify-center text-muted-foreground hover:text-destructive cursor-pointer">
                <Trash2 className="h-4 w-4" />
            </button>
            <span className="flex items-center gap-1.5 px-1 text-xs font-medium text-destructive tabular-nums">
                <span className="h-2 w-2 rounded-full bg-destructive animate-pulse" />
                {mmss(segundos)}
            </span>
            {/* minha versao: medidor de volume (barras apagadas = o microfone nao esta captando) */}
            <span className="flex items-end gap-0.5 h-4" title={nivel < LIMIAR_SILENCIO ? "Sem som no microfone" : "Captando som"} aria-label="Volume do microfone">
                {[0.004, 0.02, 0.06, 0.15, 0.35].map((l, i) => (
                    <span key={l} className={cn("w-1 rounded-sm transition-colors", nivel >= l ? "bg-primary" : "bg-muted-foreground/25")}
                        style={{ height: `${(i + 1) * 20}%` }} />
                ))}
            </span>
            <Button type="button" size="icon" onClick={() => finalizar(false)}
                className="h-9 w-9 rounded-full shrink-0" title="Enviar áudio">
                <Send className="h-4 w-4" />
            </Button>
        </div>
    );
}
