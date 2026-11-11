"use client";

// minha versao: reprodutor de video proprio (no lugar do <video controls> generico do navegador).
// Mesmo estilo do reprodutor-audio.tsx: ambar no destaque, cores pelo tema.
// Controles: tocar/pausar (botao central e clique no video), barra de progresso com busca e area de buffer,
// tempo, mudo e volume, velocidade (1x/1,5x/2x), picture-in-picture e tela cheia.
// A tela cheia usa o CONTEINER (assim os controles continuam sendo estes); no iOS, que so deixa o <video>
// entrar em tela cheia, cai no webkitEnterFullscreen.
// Economia: preload="none" (nada e baixado antes do clique). O carregamento adiado fica no LazyVideo, que so monta isto
// quando a mensagem aparece na tela.
import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, PictureInPicture2, RotateCcw, Download } from "lucide-react";
import { cn } from "@/lib/utils";

function mmss(seg: number) {
    if (!isFinite(seg) || seg < 0) seg = 0;
    const m = Math.floor(seg / 60);
    const s = Math.floor(seg % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
}

const VELOCIDADES = [1, 1.5, 2];
const rotuloVel = (v: number) => `${String(v).replace(".", ",")}x`;
const SUMIR_MS = 2500;
const PASSO_SEG = 5;

// minha versao: so um video toca por vez; ao iniciar um, o anterior pausa
let videoTocando: HTMLVideoElement | null = null;

type ElFull = HTMLElement & { webkitRequestFullscreen?: () => void };
type DocFull = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
type VideoIOS = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

const btnCls = "h-8 w-8 shrink-0 rounded-full flex items-center justify-center text-white/90 hover:text-white hover:bg-white/15 cursor-pointer transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary";

export function ReprodutorVideo({ src, onBaixar }: { src: string; onBaixar?: () => void }) {
    const boxRef = useRef<HTMLDivElement | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const barraRef = useRef<HTMLDivElement | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const tocandoRef = useRef(false);
    const arrastandoRef = useRef(false);

    const [tocando, setTocando] = useState(false);
    const [atual, setAtual] = useState(0);
    const [dur, setDur] = useState(0);
    const [buffer, setBuffer] = useState(0);
    const [carregando, setCarregando] = useState(false);
    const [erro, setErro] = useState(false);
    const [mudo, setMudo] = useState(false);
    const [volume, setVolume] = useState(1);
    const [vel, setVel] = useState(1);
    const [cheia, setCheia] = useState(false);
    const [temPip, setTemPip] = useState(false);
    const [visivel, setVisivel] = useState(true);

    tocandoRef.current = tocando;

    const limparTimer = () => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; } };

    // mostra os controles e, se estiver tocando, agenda o sumico
    const mostrar = useCallback(() => {
        setVisivel(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = null;
        if (tocandoRef.current) {
            timerRef.current = setTimeout(() => { if (tocandoRef.current) setVisivel(false); }, SUMIR_MS);
        }
    }, []);

    useEffect(() => {
        const v = videoRef.current;
        if (!v) return;
        const d = document as DocFull;
        setTemPip(!!d.pictureInPictureEnabled && typeof v.requestPictureInPicture === "function");

        const lerBuffer = () => {
            try {
                if (v.buffered.length) setBuffer(v.buffered.end(v.buffered.length - 1));
            } catch { /* sem buffer */ }
        };
        const onTime = () => { if (!arrastandoRef.current) setAtual(v.currentTime); lerBuffer(); };
        const onDur = () => { if (isFinite(v.duration)) setDur(v.duration); };
        const onPlay = () => {
            if (videoTocando && videoTocando !== v) videoTocando.pause();
            videoTocando = v;
            setTocando(true); setErro(false);
        };
        const onPause = () => { setTocando(false); };
        const onFim = () => { setTocando(false); };
        const onWaiting = () => setCarregando(true);
        const onPlaying = () => { setCarregando(false); setErro(false); };
        const onCanPlay = () => setCarregando(false);
        const onErro = () => { setErro(true); setCarregando(false); setTocando(false); };
        const onVol = () => { setMudo(v.muted); setVolume(v.volume); };
        const onRate = () => setVel(v.playbackRate);
        const onFull = () => {
            const el = d.fullscreenElement || d.webkitFullscreenElement;
            setCheia(!!el && el === boxRef.current);
        };
        const evs: [string, () => void][] = [
            ["timeupdate", onTime], ["progress", lerBuffer], ["durationchange", onDur], ["loadedmetadata", onDur],
            ["play", onPlay], ["pause", onPause], ["ended", onFim], ["waiting", onWaiting], ["playing", onPlaying],
            ["canplay", onCanPlay], ["error", onErro], ["volumechange", onVol], ["ratechange", onRate],
        ];
        evs.forEach(([n, f]) => v.addEventListener(n, f));
        document.addEventListener("fullscreenchange", onFull);
        document.addEventListener("webkitfullscreenchange", onFull);
        return () => {
            evs.forEach(([n, f]) => v.removeEventListener(n, f));
            document.removeEventListener("fullscreenchange", onFull);
            document.removeEventListener("webkitfullscreenchange", onFull);
            if (videoTocando === v) videoTocando = null;
            if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
        };
    }, []);

    // controles: ficam sempre visiveis parado/com erro; somem depois de um tempo tocando
    useEffect(() => {
        if (!tocando || erro) { limparTimer(); setVisivel(true); }
        else mostrar();
    }, [tocando, erro, mostrar]);

    const alternar = useCallback(() => {
        const v = videoRef.current;
        if (!v) return;
        if (v.paused || v.ended) {
            setCarregando(true);
            v.play().catch(() => setCarregando(false));
        } else v.pause();
    }, []);

    const tentarDeNovo = () => {
        const v = videoRef.current;
        if (!v) return;
        setErro(false); setCarregando(true);
        v.load();
        v.play().catch(() => setCarregando(false));
    };

    const buscar = useCallback((seg: number) => {
        const v = videoRef.current;
        if (!v || !dur) return;
        v.currentTime = Math.min(dur, Math.max(0, seg));
        setAtual(v.currentTime);
    }, [dur]);

    const buscarPorX = (clientX: number) => {
        const b = barraRef.current;
        if (!b || !dur) return;
        const r = b.getBoundingClientRect();
        buscar(Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * dur);
    };

    const alternarMudo = () => {
        const v = videoRef.current;
        if (!v) return;
        // minha versao: com o volume em zero, tirar o mudo sozinho nao devolvia o som
        if (v.muted || v.volume === 0) {
            if (v.volume === 0) v.volume = 0.5;
            v.muted = false;
        } else {
            v.muted = true;
        }
    };
    const mudarVolume = (x: number) => {
        const v = videoRef.current;
        if (!v) return;
        v.volume = x;
        v.muted = x === 0;
    };
    const trocarVel = () => {
        const v = videoRef.current;
        if (!v) return;
        const i = VELOCIDADES.indexOf(vel);
        v.playbackRate = VELOCIDADES[(i + 1) % VELOCIDADES.length];
    };

    const telaCheia = useCallback(() => {
        const box = boxRef.current as ElFull | null;
        const v = videoRef.current as VideoIOS | null;
        const d = document as DocFull;
        if (!box || !v) return;
        if (d.fullscreenElement || d.webkitFullscreenElement) {
            (d.exitFullscreen?.() ?? d.webkitExitFullscreen?.());
            return;
        }
        if (box.requestFullscreen) box.requestFullscreen().catch(() => {});
        else if (box.webkitRequestFullscreen) box.webkitRequestFullscreen();
        else if (v.webkitEnterFullscreen) v.webkitEnterFullscreen(); // iOS: so o <video> entra em tela cheia
    }, []);

    const pip = async () => {
        const v = videoRef.current;
        if (!v) return;
        try {
            if (document.pictureInPictureElement) await document.exitPictureInPicture();
            else await v.requestPictureInPicture();
        } catch { /* navegador recusou */ }
    };

    // teclado: so com o player focado (o evento borbulha de dentro dele; a caixa de mensagem fica fora)
    const aoTeclar = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const alvo = e.target as HTMLElement;
        const ehBotao = alvo.tagName === "BUTTON";
        const ehCampo = alvo.tagName === "INPUT";
        mostrar();
        switch (e.key) {
            case " ":
            case "k":
                if (ehBotao || ehCampo) return; // espaco no botao focado ja aciona o proprio botao
                e.preventDefault(); alternar(); break;
            case "ArrowRight":
                if (ehCampo) return;
                e.preventDefault(); buscar((videoRef.current?.currentTime ?? 0) + PASSO_SEG); break;
            case "ArrowLeft":
                if (ehCampo) return;
                e.preventDefault(); buscar((videoRef.current?.currentTime ?? 0) - PASSO_SEG); break;
            case "ArrowUp":
                if (ehCampo) return;
                e.preventDefault(); mudarVolume(Math.min(1, (videoRef.current?.volume ?? 1) + 0.1)); break;
            case "ArrowDown":
                if (ehCampo) return;
                e.preventDefault(); mudarVolume(Math.max(0, (videoRef.current?.volume ?? 1) - 0.1)); break;
            case "f":
            case "F":
                e.preventDefault(); telaCheia(); break;
            case "m":
            case "M":
                e.preventDefault(); alternarMudo(); break;
        }
    };

    const frac = dur ? Math.min(1, atual / dur) : 0;
    const fracBuffer = dur ? Math.min(1, buffer / dur) : 0;
    const mostrarControles = visivel || !tocando || erro;
    const mostrarPlayCentral = !tocando && !erro && !carregando;

    return (
        <div
            ref={boxRef}
            tabIndex={0}
            role="group"
            aria-label="Reprodutor de vídeo"
            onKeyDown={aoTeclar}
            onPointerMove={mostrar}
            onPointerDown={mostrar}
            onFocus={mostrar}
            className={cn(
                "relative bg-black overflow-hidden select-none outline-none focus-visible:ring-2 focus-visible:ring-primary",
                cheia ? "w-full h-full rounded-none flex items-center justify-center" : "block w-fit min-w-[300px] max-w-full rounded-xl",
                tocando && !mostrarControles && "cursor-none"
            )}
        >
            <video
                ref={videoRef}
                src={src}
                preload="none"
                playsInline
                onClick={alternar}
                className={cn("block mx-auto cursor-pointer", cheia ? "w-full h-full max-h-none object-contain" : "max-w-full max-h-60")}
            />

            {/* botao grande central */}
            {mostrarPlayCentral && (
                <button type="button" onClick={alternar} aria-label="Reproduzir vídeo"
                    className="absolute inset-0 m-auto h-14 w-14 rounded-full bg-black/55 hover:bg-black/70 text-white flex items-center justify-center cursor-pointer transition-opacity duration-200 motion-reduce:transition-none outline-none focus-visible:ring-2 focus-visible:ring-primary">
                    <Play className="h-7 w-7 translate-x-[1px]" />
                </button>
            )}

            {/* carregando */}
            {carregando && !erro && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center" role="status" aria-label="Carregando vídeo">
                    <span className="h-10 w-10 border-[3px] border-white/30 border-t-white rounded-full animate-spin motion-reduce:animate-none" />
                </div>
            )}

            {/* erro */}
            {erro && (
                <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center gap-2 text-white text-xs p-3 text-center" role="alert">
                    <span>Não foi possível carregar o vídeo.</span>
                    <div className="flex items-center gap-2">
                        <button type="button" onClick={tentarDeNovo}
                            className="inline-flex items-center gap-1.5 rounded-full bg-white/15 hover:bg-white/25 px-3 py-1.5 font-semibold cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary">
                            <RotateCcw className="h-3.5 w-3.5" /> Tentar de novo
                        </button>
                        {onBaixar && (
                            <button type="button" onClick={onBaixar}
                                className="inline-flex items-center gap-1.5 rounded-full bg-white/15 hover:bg-white/25 px-3 py-1.5 font-semibold cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary">
                                <Download className="h-3.5 w-3.5" /> Baixar
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* barra de controles */}
            {!erro && (
                <div
                    className={cn(
                        // minha versao: so os controles recebem clique; o degrade cobria o botao central e impedia o play
                        "@container pointer-events-none absolute inset-x-0 bottom-0 px-2 pb-1.5 pt-6 bg-gradient-to-t from-black/75 to-transparent text-white transition-opacity duration-200 motion-reduce:transition-none",
                        mostrarControles ? "opacity-100 [&>*]:pointer-events-auto" : "opacity-0"
                    )}
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* progresso: busca por clique/arrasto; setas movem 5 s */}
                    <div
                        ref={barraRef}
                        role="slider"
                        tabIndex={0}
                        aria-label="Progresso do vídeo"
                        aria-valuemin={0}
                        aria-valuemax={Math.round(dur)}
                        aria-valuenow={Math.round(atual)}
                        aria-valuetext={`${mmss(atual)} de ${mmss(dur)}`}
                        className="group/barra relative h-4 flex items-center cursor-pointer touch-none outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
                        onPointerDown={(e) => {
                            if (!dur) return;
                            arrastandoRef.current = true;
                            e.currentTarget.setPointerCapture(e.pointerId);
                            buscarPorX(e.clientX);
                        }}
                        onPointerMove={(e) => { if (arrastandoRef.current) buscarPorX(e.clientX); }}
                        onPointerUp={(e) => {
                            arrastandoRef.current = false;
                            if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
                        }}
                        onPointerCancel={() => { arrastandoRef.current = false; }}
                    >
                        <div className="relative h-1 w-full rounded-full bg-white/25 overflow-hidden group-hover/barra:h-1.5 transition-[height] motion-reduce:transition-none">
                            <div className="absolute inset-y-0 left-0 bg-white/35" style={{ width: `${fracBuffer * 100}%` }} />
                            <div className="absolute inset-y-0 left-0 bg-primary" style={{ width: `${frac * 100}%` }} />
                        </div>
                        <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary pointer-events-none" style={{ left: `${frac * 100}%` }} />
                    </div>

                    <div className="flex items-center gap-0.5 mt-0.5">
                        <button type="button" onClick={alternar} aria-label={tocando ? "Pausar" : "Reproduzir"} title={tocando ? "Pausar (espaço)" : "Reproduzir (espaço)"} className={btnCls}>
                            {tocando ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-[1px]" />}
                        </button>
                        <span className="text-[11px] tabular-nums px-1 whitespace-nowrap">{mmss(atual)} / {mmss(dur)}</span>
                        <span className="flex-1" />
                        <button type="button" onClick={alternarMudo} aria-label={mudo || volume === 0 ? "Ativar som" : "Silenciar"} title={mudo ? "Ativar som (m)" : "Silenciar (m)"} className={btnCls}>
                            {mudo || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                        </button>
                        <input
                            type="range" min={0} max={1} step={0.05}
                            value={mudo ? 0 : volume}
                            onChange={(e) => mudarVolume(Number(e.target.value))}
                            aria-label="Volume"
                            className="hidden @[400px]:block w-14 h-1 accent-primary cursor-pointer" /* minha versao: o tamanho vem do player, nao da tela; em video vertical a barra cortava os ultimos botoes */
                        />
                        <button type="button" onClick={trocarVel} aria-label={`Velocidade ${rotuloVel(vel)}`} title="Velocidade"
                            className={cn(btnCls, "w-auto px-2 text-[11px] font-semibold tabular-nums")}>
                            {rotuloVel(vel)}
                        </button>
                        {temPip && (
                            <button type="button" onClick={pip} aria-label="Imagem sobre imagem" title="Imagem sobre imagem" className={btnCls}>
                                <PictureInPicture2 className="h-4 w-4" />
                            </button>
                        )}
                        <button type="button" onClick={telaCheia} aria-label={cheia ? "Sair da tela cheia" : "Tela cheia"} title={cheia ? "Sair da tela cheia (f)" : "Tela cheia (f)"} className={btnCls}>
                            {cheia ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
