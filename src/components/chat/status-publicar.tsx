"use client";

// minha versao: publicar status (so quem gerencia a sessao): texto com cor de fundo, ou foto/video com legenda.
import { useEffect, useMemo, useRef, useState } from "react";
import { ImageIcon, Loader2, Type } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { publicarStatus } from "@/app/dashboard/chat/status-actions";
import {
    CORES_FUNDO_STATUS, COR_FUNDO_PADRAO, LEGENDA_STATUS_MAX, MIMES_IMAGEM_STATUS, MIMES_VIDEO_STATUS, TEXTO_STATUS_MAX, validarPublicacao,
} from "@/lib/status-puro";

interface Props {
    sessionId: string;
    destinatarios: number | null;
    onFechar: () => void;
    onPublicado: () => void;
}

const ACEITA = [...MIMES_IMAGEM_STATUS, ...MIMES_VIDEO_STATUS].join(",");

export function StatusPublicar({ sessionId, destinatarios, onFechar, onPublicado }: Props) {
    const [modo, setModo] = useState<"texto" | "midia">("texto");
    const [texto, setTexto] = useState("");
    const [fundo, setFundo] = useState(COR_FUNDO_PADRAO);
    const [arquivo, setArquivo] = useState<File | null>(null);
    const [legenda, setLegenda] = useState("");
    const [enviando, setEnviando] = useState(false);
    const entrada = useRef<HTMLInputElement | null>(null);

    // pre-visualizacao do arquivo escolhido (o endereco temporario e liberado ao trocar/fechar)
    const previa = useMemo(() => (arquivo ? URL.createObjectURL(arquivo) : null), [arquivo]);
    useEffect(() => () => { if (previa) URL.revokeObjectURL(previa); }, [previa]);

    const ehVideo = !!arquivo && arquivo.type.startsWith("video/");
    const validacao = validarPublicacao(modo === "texto"
        ? { tipo: "TEXT", texto, fundo }
        : { tipo: ehVideo ? "VIDEO" : "IMAGE", legenda, arquivo: arquivo ? { mimetype: arquivo.type, tamanho: arquivo.size } : null });

    const publicar = async () => {
        if (!validacao.ok || enviando) return;
        setEnviando(true);
        try {
            const f = new FormData();
            f.set("sessionId", sessionId);
            f.set("tipo", validacao.dados.tipo);
            if (validacao.dados.tipo === "TEXT") {
                f.set("texto", validacao.dados.texto);
                if (validacao.dados.fundo) f.set("fundo", validacao.dados.fundo);
            } else if (arquivo) {
                if (validacao.dados.texto) f.set("legenda", validacao.dados.texto);
                f.set("file", arquivo);
            }
            const r = await publicarStatus(f);
            if (!r.success) { toast.error(r.error); return; }
            toast.success(`Status publicado para ${r.enviadoPara} contato${r.enviadoPara === 1 ? "" : "s"}${r.cortado ? ` (limite de ${r.enviadoPara})` : ""}`);
            onPublicado();
        } catch {
            toast.error("Não consegui publicar o status");
        } finally {
            setEnviando(false);
        }
    };

    return (
        <Dialog open onOpenChange={(v) => { if (!v && !enviando) onFechar(); }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Publicar status</DialogTitle>
                    <DialogDescription>
                        {destinatarios === null ? "Será enviado aos contatos que conversaram com você nos últimos 30 dias." : `Será enviado a até ${destinatarios} contato${destinatarios === 1 ? "" : "s"} que conversaram com você nos últimos 30 dias.`} Some em 24 horas.
                    </DialogDescription>
                </DialogHeader>

                <div role="tablist" aria-label="Tipo de status" className="flex gap-1 rounded-lg bg-muted/50 p-0.5">
                    {([["texto", "Texto", Type], ["midia", "Foto ou vídeo", ImageIcon]] as const).map(([valor, rotulo, Icone]) => (
                        <button key={valor} type="button" role="tab" aria-selected={modo === valor} onClick={() => setModo(valor)}
                            className={cn("flex h-8 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors",
                                modo === valor ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                            <Icone className="h-3.5 w-3.5" />{rotulo}
                        </button>
                    ))}
                </div>

                {modo === "texto" ? (
                    <div className="space-y-2">
                        <div className="flex h-44 items-center justify-center rounded-lg p-3" style={{ backgroundColor: fundo }}>
                            <Textarea value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={TEXTO_STATUS_MAX} placeholder="Escreva o status"
                                aria-label="Texto do status"
                                className="h-full resize-none border-0 bg-transparent text-center text-lg font-semibold text-white shadow-none placeholder:text-white/60 focus-visible:ring-0 dark:bg-transparent" />
                        </div>
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Cor de fundo">
                                {CORES_FUNDO_STATUS.map((cor) => (
                                    <button key={cor} type="button" role="radio" aria-checked={fundo === cor} aria-label={`Cor ${cor}`} onClick={() => setFundo(cor)}
                                        className={cn("h-6 w-6 cursor-pointer rounded-full border-2 transition-transform", fundo === cor ? "scale-110 border-foreground" : "border-transparent")}
                                        style={{ backgroundColor: cor }} />
                                ))}
                            </div>
                            <span className="text-[11px] tabular-nums text-muted-foreground">{texto.length}/{TEXTO_STATUS_MAX}</span>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-2">
                        <input ref={entrada} type="file" accept={ACEITA} className="sr-only" aria-label="Escolher foto ou vídeo"
                            onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
                        {previa && arquivo ? (
                            <div className="flex h-44 items-center justify-center overflow-hidden rounded-lg bg-black">
                                {ehVideo
                                    ? <video src={previa} controls className="max-h-full max-w-full" />
                                    // eslint-disable-next-line @next/next/no-img-element
                                    : <img src={previa} alt="Pré-visualização" className="max-h-full max-w-full object-contain" />}
                            </div>
                        ) : (
                            <button type="button" onClick={() => entrada.current?.click()}
                                className="flex h-44 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-sm text-muted-foreground hover:bg-muted/40">
                                <ImageIcon className="h-6 w-6" />Escolher foto ou vídeo
                            </button>
                        )}
                        {arquivo && <Button type="button" variant="ghost" size="sm" onClick={() => entrada.current?.click()}>Trocar arquivo</Button>}
                        <Textarea value={legenda} onChange={(e) => setLegenda(e.target.value)} maxLength={LEGENDA_STATUS_MAX} placeholder="Legenda (opcional)" aria-label="Legenda" className="min-h-16" />
                    </div>
                )}

                {!validacao.ok && (texto || arquivo) && <p className="text-xs text-destructive" role="alert">{validacao.erro}</p>}

                <DialogFooter>
                    <Button type="button" variant="ghost" onClick={onFechar} disabled={enviando}>Cancelar</Button>
                    <Button type="button" onClick={() => { void publicar(); }} disabled={!validacao.ok || enviando}>
                        {enviando ? <><Loader2 className="h-4 w-4 animate-spin" />Publicando…</> : "Publicar"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
