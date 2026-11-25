"use client";

// minha versao: cartoes da tela de Auditoria, em frases simples. Um cartao por mensagem apagada e um por
// conversa apagada pelo celular (com "ver mensagens"). As frases vem de src/lib/auditoria-tela.ts (testado).
import { useCallback, useState } from "react";
import { ChevronDown, ChevronUp, FileText, Image as ImageIcon, Loader2, MessagesSquare, Monitor, Music, Smartphone, User, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
    dataCurta, escritaPor, fraseDaConversa, fraseDoRegistro, horaCurta, linhaDaConversa, type RegistroTela,
} from "@/lib/auditoria-tela";

export type ItemAuditoria = RegistroTela & {
    id: string;
    sessionId: string;
    tipoItem?: "mensagem" | "conversa";
    total?: number; // conversa apagada: quantas mensagens
    tipo: string | null;
    conteudo: string | null;
    mediaUrl: string | null;
    enviadaEm: string | null;
};

const TIPO_ICONE: Record<string, any> = { IMAGE: ImageIcon, VIDEO: Video, AUDIO: Music, DOCUMENT: FileText, STICKER: ImageIcon };
const TIPO_NOME: Record<string, string> = { IMAGE: "Foto", VIDEO: "Vídeo", AUDIO: "Áudio", DOCUMENT: "Documento", STICKER: "Figurinha", LOCATION: "Localização", CONTACT: "Contato" };
const ORIGEM_ICONE: Record<string, any> = { PAINEL: Monitor, CELULAR: Smartphone, CONTATO: User };

type Fuso = { fuso: number };

/** A caixa com a mensagem que foi apagada. */
function CaixaDaMensagem({ r, fuso }: { r: ItemAuditoria } & Fuso) {
    const TipoIcone = r.tipo ? TIPO_ICONE[r.tipo] : null;
    const legenda = [escritaPor(r), r.enviadaEm ? `enviada em ${dataCurta(r.enviadaEm, fuso)} às ${horaCurta(r.enviadaEm, fuso)}` : null].filter(Boolean).join(" · ");
    return (
        <div className={cn("rounded-lg px-3 py-2.5 text-sm border-l-4 min-w-0", r.fromMe ? "border-primary bg-primary/5" : "border-muted-foreground/40 bg-muted/50")}>
            {r.tipo && r.tipo !== "TEXT" && (
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1">
                    {TipoIcone && <TipoIcone className="h-3.5 w-3.5" />}
                    <span>{TIPO_NOME[r.tipo] || r.tipo}</span>
                </div>
            )}
            {r.mediaUrl && r.tipo === "IMAGE" && (
                <a href={r.mediaUrl} target="_blank" rel="noreferrer"><img src={r.mediaUrl} alt="" className="max-h-48 max-w-full rounded-md mb-1.5" /></a>
            )}
            {r.mediaUrl && r.tipo === "AUDIO" && <audio src={r.mediaUrl} controls className="h-8 max-w-full mb-1.5" preload="none" />}
            {r.mediaUrl && !["IMAGE", "AUDIO"].includes(r.tipo || "") && (
                <a href={r.mediaUrl} target="_blank" rel="noreferrer" className="text-primary underline text-xs">abrir o arquivo original</a>
            )}
            <p className="whitespace-pre-wrap break-words">{r.conteudo || (r.mediaUrl ? "" : <span className="italic text-muted-foreground">(sem texto)</span>)}</p>
            <p className="mt-1.5 text-[11px] text-muted-foreground break-words">{legenda}</p>
        </div>
    );
}

function Moldura({ r, fuso, frase, children }: { r: ItemAuditoria; frase: string; children: React.ReactNode } & Fuso) {
    const Icone = r.tipoItem === "conversa" ? MessagesSquare : (ORIGEM_ICONE[r.origem] || Monitor);
    return (
        <article className="rounded-xl border border-border/60 bg-card p-3 sm:p-4 space-y-3">
            <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary" aria-hidden="true">
                    <Icone className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                    <p className="font-semibold leading-snug break-words">{frase}, às {horaCurta(r.criadoEm, fuso)}</p>
                    <p className="text-sm text-muted-foreground break-words">{linhaDaConversa(r)}</p>
                </div>
            </div>
            {children}
        </article>
    );
}

/** Uma mensagem apagada. */
export function CartaoMensagem({ r, fuso }: { r: ItemAuditoria } & Fuso) {
    return (
        <Moldura r={r} fuso={fuso} frase={fraseDoRegistro(r)}>
            <CaixaDaMensagem r={r} fuso={fuso} />
        </Moldura>
    );
}

/** Uma conversa apagada pelo celular: o botao "ver mensagens" mostra as que foram guardadas. */
export function CartaoConversa({ r, fuso }: { r: ItemAuditoria } & Fuso) {
    const [aberto, setAberto] = useState(false);
    const [mensagens, setMensagens] = useState<ItemAuditoria[]>([]);
    const [pagina, setPagina] = useState(0);
    const [temMais, setTemMais] = useState(true);
    const [carregando, setCarregando] = useState(false);
    const [erro, setErro] = useState<string | null>(null);

    const carregarMais = useCallback(async () => {
        setCarregando(true);
        setErro(null);
        try {
            const proxima = pagina + 1;
            const p = new URLSearchParams({ sessionId: r.sessionId, chatJid: r.chatJid, em: r.criadoEm, pagina: String(proxima) });
            const resp = await fetch(`/api/auditoria/conversa?${p}`);
            const d = await resp.json();
            if (!resp.ok) throw new Error(d?.message || "Falha ao carregar");
            setMensagens((antes) => [...antes, ...((d.data || []) as ItemAuditoria[])]);
            setPagina(proxima);
            setTemMais(!!d.meta?.temMais);
        } catch (e: any) {
            setErro(e?.message || "Falha ao carregar");
        } finally {
            setCarregando(false);
        }
    }, [pagina, r.sessionId, r.chatJid, r.criadoEm]);

    const alternar = () => {
        const abrindo = !aberto;
        setAberto(abrindo);
        if (abrindo && pagina === 0 && !carregando) void carregarMais();
    };
    const total = r.total || 0;

    return (
        <Moldura r={r} fuso={fuso} frase={fraseDaConversa(r, total)}>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={alternar} aria-expanded={aberto}>
                {aberto ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                {aberto ? "Esconder mensagens" : `Ver mensagens (${total})`}
            </Button>
            {aberto && (
                <div className="space-y-2">
                    {mensagens.map((m) => <CaixaDaMensagem key={m.id} r={{ ...r, ...m }} fuso={fuso} />)}
                    {carregando && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando...</div>}
                    {erro && <p className="text-sm text-destructive">{erro}</p>}
                    {!carregando && temMais && <Button variant="ghost" size="sm" onClick={() => { void carregarMais(); }}>Mostrar mais mensagens</Button>}
                </div>
            )}
        </Moldura>
    );
}
