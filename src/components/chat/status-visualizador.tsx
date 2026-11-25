"use client";

// minha versao: visualizador de status (stories) do ZapHub. Um contato por vez: texto com cor de fundo, foto ou video,
// com barras de tempo ambar, avancar/voltar e campo para responder.
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Pause, Play, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { responderStatus } from "@/app/dashboard/chat/status-actions";
import { COR_FUNDO_PADRAO, tempoDeExibicaoMs, tempoRelativo, type GrupoStatusDTO } from "@/lib/status-puro";

const PASSO_MS = 50;

function tamanhoDoTexto(texto: string): string {
    if (texto.length > 400) return "text-base";
    if (texto.length > 160) return "text-xl";
    if (texto.length > 60) return "text-2xl";
    return "text-3xl";
}

interface Props {
    sessionId: string;
    grupo: GrupoStatusDTO;
    indiceInicial: number;
    onFechar: () => void;
    /** avisa que este status foi visto (o painel grava por usuario) */
    onVisto: (id: string) => void;
}

export function StatusVisualizador({ sessionId, grupo, indiceInicial, onFechar, onVisto }: Props) {
    const total = grupo.itens.length;
    const [indice, setIndice] = useState(Math.min(Math.max(indiceInicial, 0), Math.max(total - 1, 0)));
    const [decorrido, setDecorrido] = useState(0);
    const [pausadoPeloUsuario, setPausadoPeloUsuario] = useState(false);
    const [respondendo, setRespondendo] = useState(false); // campo de resposta em foco: segura o tempo
    const [resposta, setResposta] = useState("");
    const [enviando, setEnviando] = useState(false);
    const [duracaoVideo, setDuracaoVideo] = useState<number | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const vistos = useRef(new Set<string>());

    const item = grupo.itens[indice];
    const semMidia = !!item && item.tipo !== "TEXT" && !item.midiaUrl;
    const duracao = item ? (item.tipo === "VIDEO" ? tempoDeExibicaoMs("VIDEO", null, duracaoVideo) : item.duracaoMs) : 1;
    const parado = pausadoPeloUsuario || respondendo || semMidia || enviando;

    const avancar = useCallback(() => {
        if (indice >= total - 1) { onFechar(); return; }
        setIndice(indice + 1);
    }, [indice, total, onFechar]);
    const voltar = useCallback(() => {
        if (indice > 0) setIndice(indice - 1);
        else setDecorrido(0);
    }, [indice]);

    // trocou de status: recomeca o tempo
    useEffect(() => { setDecorrido(0); setDuracaoVideo(null); }, [indice]);

    // marca como visto quando o status aparece (uma vez por status)
    useEffect(() => {
        if (!item || item.visto || vistos.current.has(item.id)) return;
        vistos.current.add(item.id);
        onVisto(item.id);
    }, [item, onVisto]);

    // relogio da barra (video usa o proprio tempo do video)
    useEffect(() => {
        if (!item || parado || item.tipo === "VIDEO") return;
        const t = setInterval(() => setDecorrido((d) => d + PASSO_MS), PASSO_MS);
        return () => clearInterval(t);
    }, [item, parado]);
    useEffect(() => {
        if (item && item.tipo !== "VIDEO" && decorrido >= duracao) avancar();
    }, [decorrido, duracao, item, avancar]);

    // video: segue o play/pausa
    useEffect(() => {
        const v = videoRef.current;
        if (!v) return;
        if (parado) v.pause(); else v.play().catch(() => { /* o navegador pode exigir um clique antes de tocar */ });
    }, [parado, item?.id]);

    // setas do teclado (Esc fecha pelo proprio dialogo)
    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if (respondendo) return;
            if (e.key === "ArrowRight") avancar();
            else if (e.key === "ArrowLeft") voltar();
            else if (e.key === " ") { e.preventDefault(); setPausadoPeloUsuario((p) => !p); }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [avancar, voltar, respondendo]);

    const enviarResposta = async () => {
        const texto = resposta.trim();
        if (!texto || !item || enviando) return;
        setEnviando(true);
        try {
            const r = await responderStatus(sessionId, item.id, texto);
            if (!r.success) { toast.error(r.error); return; }
            setResposta("");
            toast.success("Resposta enviada na conversa");
        } catch {
            toast.error("Não consegui enviar a resposta");
        } finally {
            setEnviando(false);
        }
    };

    if (!item) return null;
    const progresso = (i: number): number => {
        if (i < indice) return 1;
        if (i > indice) return 0;
        return Math.min(1, decorrido / duracao);
    };

    return (
        <Dialog open onOpenChange={(v) => { if (!v) onFechar(); }}>
            <DialogContent
                showCloseButton={false}
                className="flex h-[min(94vh,48rem)] w-[min(96vw,26rem)] max-w-none flex-col gap-0 overflow-hidden border-0 bg-neutral-950 p-0 text-white sm:max-w-none"
            >
                <DialogTitle className="sr-only">Status de {grupo.nome}</DialogTitle>
                <DialogDescription className="sr-only">Use as setas para avançar ou voltar entre os status.</DialogDescription>

                {/* barras de tempo (ambar) */}
                <div className="flex gap-1 px-3 pt-3" aria-hidden>
                    {grupo.itens.map((it, i) => (
                        <div key={it.id} className="h-1 flex-1 overflow-hidden rounded-full bg-white/25">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${progresso(i) * 100}%` }} />
                        </div>
                    ))}
                </div>

                {/* cabecalho */}
                <div className="flex items-center gap-2 px-3 py-2">
                    <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{grupo.nome}</p>
                        <p className="text-[11px] text-white/60">{tempoRelativo(item.criadoEm)} · {indice + 1} de {total}</p>
                    </div>
                    <Button variant="ghost" size="icon-sm" className="text-white hover:bg-white/10 hover:text-white" onClick={() => setPausadoPeloUsuario((p) => !p)}
                        aria-label={pausadoPeloUsuario ? "Continuar" : "Pausar"} title={pausadoPeloUsuario ? "Continuar" : "Pausar"}>
                        {pausadoPeloUsuario ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                    </Button>
                    <Button variant="ghost" size="icon-sm" className="text-white hover:bg-white/10 hover:text-white" onClick={onFechar} aria-label="Fechar" title="Fechar">
                        <X className="h-4 w-4" />
                    </Button>
                </div>

                {/* conteudo */}
                <div className="relative flex min-h-0 flex-1 items-center justify-center">
                    {item.tipo === "TEXT" && (
                        <div className="flex h-full w-full items-center justify-center px-6" style={{ backgroundColor: item.fundo || COR_FUNDO_PADRAO }}>
                            <p className={cn("max-h-full overflow-y-auto text-center font-semibold [overflow-wrap:anywhere] whitespace-pre-wrap", tamanhoDoTexto(item.texto || ""))}>
                                {item.texto}
                            </p>
                        </div>
                    )}
                    {item.tipo === "IMAGE" && item.midiaUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.midiaUrl} alt={item.texto || `Status de ${grupo.nome}`} className="max-h-full max-w-full object-contain" />
                    )}
                    {item.tipo === "VIDEO" && item.midiaUrl && (
                        <video
                            ref={videoRef}
                            key={item.id}
                            src={item.midiaUrl}
                            className="max-h-full max-w-full object-contain"
                            playsInline
                            autoPlay
                            onLoadedMetadata={(e) => setDuracaoVideo(Math.round((e.currentTarget.duration || 0) * 1000) || null)}
                            onTimeUpdate={(e) => setDecorrido(Math.round(e.currentTarget.currentTime * 1000))}
                            onEnded={avancar}
                        />
                    )}
                    {semMidia && (
                        <div className="flex flex-col items-center gap-2 px-6 text-center text-sm text-white/70">
                            {item.midiaFalhou ? (
                                <p>Não foi possível baixar este {item.tipo === "VIDEO" ? "vídeo" : "foto"}. Ele pode ter expirado no WhatsApp.</p>
                            ) : (
                                <><Loader2 className="h-5 w-5 animate-spin" /><p>Baixando a mídia…</p></>
                            )}
                        </div>
                    )}
                    {item.tipo !== "TEXT" && item.texto && !semMidia && (
                        <p className="absolute inset-x-0 bottom-0 max-h-[40%] overflow-y-auto bg-gradient-to-t from-black/80 to-transparent px-4 pb-3 pt-8 text-center text-sm [overflow-wrap:anywhere] whitespace-pre-wrap">
                            {item.texto}
                        </p>
                    )}

                    {/* toque nas laterais: voltar / avancar */}
                    <button type="button" aria-label="Status anterior" onClick={voltar}
                        className="absolute inset-y-0 left-0 flex w-1/4 cursor-pointer items-center justify-start pl-1 opacity-0 transition-opacity hover:opacity-100 focus-visible:opacity-100">
                        <span className="rounded-full bg-black/40 p-1"><ChevronLeft className="h-5 w-5" /></span>
                    </button>
                    <button type="button" aria-label="Próximo status" onClick={avancar}
                        className="absolute inset-y-0 right-0 flex w-1/4 cursor-pointer items-center justify-end pr-1 opacity-0 transition-opacity hover:opacity-100 focus-visible:opacity-100">
                        <span className="rounded-full bg-black/40 p-1"><ChevronRight className="h-5 w-5" /></span>
                    </button>
                </div>

                {/* responder (so status de outras pessoas) */}
                {!item.fromMe && (
                    <form className="flex items-center gap-2 border-t border-white/10 p-3"
                        onSubmit={(e) => { e.preventDefault(); void enviarResposta(); }}>
                        <input
                            value={resposta}
                            onChange={(e) => setResposta(e.target.value)}
                            onFocus={() => setRespondendo(true)}
                            onBlur={() => setRespondendo(false)}
                            maxLength={4096}
                            placeholder={`Responder a ${grupo.nome}`}
                            aria-label="Responder ao status"
                            className="h-9 min-w-0 flex-1 rounded-lg border border-white/15 bg-white/10 px-3 text-sm text-white outline-none placeholder:text-white/50 focus:border-primary"
                        />
                        <Button type="submit" size="icon-sm" disabled={!resposta.trim() || enviando} aria-label="Enviar resposta" title="Enviar resposta">
                            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        </Button>
                    </form>
                )}
            </DialogContent>
        </Dialog>
    );
}
