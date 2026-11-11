"use client";

// minha versao: reprodutor de audio proprio (não o <audio controls> genérico do navegador).
// Play/pause, barra de "ondinha" clicável para pular, tempo decorrido/total, velocidade (1x/1.5x/2x) e baixar.
// Carrega o arquivo só quando aperta play (preload none). Segue o tema: compacto, âmbar no destaque.
import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, Download } from "lucide-react";
import { cn } from "@/lib/utils";

function mmss(seg: number) {
    if (!isFinite(seg) || seg < 0) seg = 0;
    const m = Math.floor(seg / 60);
    const s = Math.floor(seg % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
}

// barras fixas da "ondinha" (visual; o áudio é mono curto, não vale decodificar de verdade por mensagem)
const ALTURAS = [8, 13, 20, 28, 18, 24, 32, 22, 14, 26, 30, 16, 22, 12, 18, 28, 20, 10, 24, 14, 19, 27, 11, 21, 15, 23, 9, 17, 25, 13];

export function ReprodutorAudio({ src, fromMe, keyId, onBaixar }: { src: string; fromMe?: boolean; keyId: string; onBaixar: () => void }) {
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [tocando, setTocando] = useState(false);
    const [atual, setAtual] = useState(0);
    const [dur, setDur] = useState(0);
    const [carregando, setCarregando] = useState(false);
    const [vel, setVel] = useState(1);

    useEffect(() => {
        const a = audioRef.current;
        if (!a) return;
        const onTime = () => setAtual(a.currentTime);
        const onDur = () => { if (isFinite(a.duration)) setDur(a.duration); };
        const onFim = () => { setTocando(false); setAtual(0); a.currentTime = 0; };
        const onPlay = () => setTocando(true);
        const onPause = () => setTocando(false);
        const onWaiting = () => setCarregando(true);
        const onPlaying = () => setCarregando(false);
        a.addEventListener("timeupdate", onTime);
        a.addEventListener("durationchange", onDur);
        a.addEventListener("loadedmetadata", onDur);
        a.addEventListener("ended", onFim);
        a.addEventListener("play", onPlay);
        a.addEventListener("pause", onPause);
        a.addEventListener("waiting", onWaiting);
        a.addEventListener("playing", onPlaying);
        return () => {
            a.removeEventListener("timeupdate", onTime);
            a.removeEventListener("durationchange", onDur);
            a.removeEventListener("loadedmetadata", onDur);
            a.removeEventListener("ended", onFim);
            a.removeEventListener("play", onPlay);
            a.removeEventListener("pause", onPause);
            a.removeEventListener("waiting", onWaiting);
            a.removeEventListener("playing", onPlaying);
        };
    }, []);

    const alternar = () => {
        const a = audioRef.current;
        if (!a) return;
        if (a.paused) { setCarregando(true); a.play().catch(() => setCarregando(false)); }
        else a.pause();
    };

    const trocarVel = () => {
        const nova = vel === 1 ? 1.5 : vel === 1.5 ? 2 : 1;
        setVel(nova);
        if (audioRef.current) audioRef.current.playbackRate = nova;
    };

    const pular = (e: React.MouseEvent<HTMLDivElement>) => {
        const a = audioRef.current;
        if (!a || !dur) return;
        const r = e.currentTarget.getBoundingClientRect();
        const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
        a.currentTime = frac * dur;
        setAtual(a.currentTime);
    };

    const progresso = dur ? atual / dur : 0;
    const corBarra = fromMe ? "bg-primary-foreground/40" : "bg-muted-foreground/30";
    const corBarraAtiva = fromMe ? "bg-primary-foreground" : "bg-primary";

    return (
        <div className={cn("flex items-center gap-2 mb-1.5 rounded-xl px-2 py-1.5 min-w-[220px] max-w-[280px]", fromMe ? "bg-black/5 dark:bg-white/10" : "bg-muted/50")}>
            <audio ref={audioRef} src={src} preload="none" />
            <button type="button" onClick={alternar} title={tocando ? "Pausar" : "Tocar"}
                className={cn("h-9 w-9 shrink-0 rounded-full flex items-center justify-center cursor-pointer transition-colors", fromMe ? "bg-primary-foreground/20 hover:bg-primary-foreground/30 text-primary-foreground" : "bg-primary/15 hover:bg-primary/25 text-primary")}>
                {carregando && !tocando
                    ? <span className="h-4 w-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                    : tocando ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-[1px]" />}
            </button>

            <div className="flex-1 min-w-0">
                {/* ondinha clicável */}
                <div className="flex items-center gap-[2px] h-6 cursor-pointer" onClick={pular} title="Clique para pular">
                    {ALTURAS.map((h, i) => {
                        const ativa = i / ALTURAS.length <= progresso;
                        return <span key={i} className={cn("w-[3px] rounded-full transition-colors", ativa ? corBarraAtiva : corBarra)} style={{ height: `${h}px` }} />;
                    })}
                </div>
                <div className={cn("flex items-center justify-between mt-0.5 text-[10px] tabular-nums", fromMe ? "text-primary-foreground/70" : "text-muted-foreground")}>
                    <span>{mmss(tocando || atual ? atual : dur)}</span>
                    <button type="button" onClick={trocarVel} className="font-semibold hover:underline cursor-pointer" title="Velocidade">{vel}x</button>
                </div>
            </div>

            <button type="button" onClick={onBaixar} title="Baixar"
                className={cn("h-7 w-7 shrink-0 rounded-full flex items-center justify-center cursor-pointer", fromMe ? "text-primary-foreground/70 hover:text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                <Download className="h-3.5 w-3.5" />
            </button>
        </div>
    );
}
