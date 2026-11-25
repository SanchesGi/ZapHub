"use client";

// minha versao: painel de emojis e figurinhas do compositor. Duas abas: "Emojis" (TODOS os emojis do emojibase-data em portugues,
// por categoria, busca sem acento, tom de pele da conta e recentes no localStorage; os dados so sao baixados ao abrir o painel)
// e "Figurinhas" (a colecao do atendente: clicar envia na hora para a conversa aberta).
// Identidade propria do ZapHub (ambar): sem imitar o seletor do WhatsApp.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { Clock, Loader2, Plus, Search, Smile, Sticker as StickerIcon, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { exigirSucesso } from "@/lib/resultado-acao";
import {
    CHAVE_RECENTES, TONS_DE_PELE, adicionarRecente, buscarEmojis, lerRecentes, montarLinhas, serializarRecentes, variantePorTom,
    type CategoriaEmoji, type LinhaPainel, type TomDePele,
} from "@/lib/emojis";
import { carregarCategoriasEmoji } from "@/lib/emojis-carregar";
import { carregarTomDePele, useTomDePele } from "@/lib/tom-de-pele";
import { enviarFigurinha, listarFigurinhas, removerFigurinha } from "@/app/dashboard/chat/figurinhas-actions";

type Aba = "emojis" | "figurinhas";
type FigurinhaDaGrade = { id: string; animada: boolean };

const COLUNAS = 9;
const ALTURA_LISTA = 256; // = h-64

function lerRecentesGuardados(): string[] {
    try { return lerRecentes(window.localStorage.getItem(CHAVE_RECENTES)); } catch { return []; }
}
function guardarRecentes(lista: string[]) {
    try { window.localStorage.setItem(CHAVE_RECENTES, serializarRecentes(lista)); } catch { /* sem armazenamento: so nao lembra */ }
}

type Props = {
    sessionId: string;
    jid: string;
    /** insere o emoji no campo de texto (na posicao do cursor, mantendo o foco) */
    onEmoji: (emoji: string) => void;
    /** uma figurinha foi enviada (a conversa recarrega e toca o som) */
    onFigurinhaEnviada: () => void;
};

export function PainelEmoji({ sessionId, jid, onEmoji, onFigurinhaEnviada }: Readonly<Props>) {
    const [aberto, setAberto] = useState(false);
    const [aba, setAba] = useState<Aba>("emojis");
    const [busca, setBusca] = useState("");
    const [recentes, setRecentes] = useState<string[]>([]); // fotografia de quando o painel abriu (nao muda a grade a cada clique)
    const [categorias, setCategorias] = useState<CategoriaEmoji[] | null>(null);
    const [erroDados, setErroDados] = useState(false);

    // o tom de pele vem da conta: busca ja ao montar o compositor, para o painel e as reacoes abrirem certos
    useEffect(() => { carregarTomDePele().catch(() => {}); }, []);

    const carregarEmojis = useCallback(() => {
        setErroDados(false);
        carregarCategoriasEmoji().then(setCategorias).catch(() => setErroDados(true));
    }, []);

    const escolherEmoji = (emoji: string) => {
        onEmoji(emoji);
        guardarRecentes(adicionarRecente(lerRecentesGuardados(), emoji));
    };

    const aoMudarAberto = (v: boolean) => {
        setAberto(v);
        if (v) {
            setRecentes(lerRecentesGuardados());
            if (!categorias) carregarEmojis();
        } else setBusca("");
    };

    return (
        <Popover open={aberto} onOpenChange={aoMudarAberto}>
            <PopoverTrigger asChild>
                <Button type="button" variant="ghost" size="icon" title="Emojis e figurinhas" aria-label="Emojis e figurinhas"
                    // aquece os dados quando o mouse chega no botao, antes do clique
                    onPointerEnter={() => { if (!categorias) carregarEmojis(); }}
                    className={cn("h-9 w-9 rounded-full shrink-0", aberto ? "text-primary bg-primary/15" : "text-muted-foreground hover:text-foreground")}>
                    <Smile className="h-4.5 w-4.5" />
                </Button>
            </PopoverTrigger>
            <PopoverContent data-painel-emoji side="top" align="start" className="w-[22rem] max-w-[calc(100vw-1.5rem)] p-0 overflow-hidden"
                // o foco fica no campo de texto: abrir o painel nao o rouba, e focar o campo nao fecha o painel
                onOpenAutoFocus={(e) => e.preventDefault()}
                onFocusOutside={(e) => e.preventDefault()}>
                <div className="flex border-b border-border/50" role="tablist">
                    {([["emojis", "Emojis", Smile], ["figurinhas", "Figurinhas", StickerIcon]] as const).map(([id, rotulo, Icone]) => (
                        <button key={id} type="button" role="tab" aria-selected={aba === id}
                            onClick={() => setAba(id)}
                            className={cn("flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium border-b-2 transition-colors",
                                aba === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
                            <Icone className="h-3.5 w-3.5" /> {rotulo}
                        </button>
                    ))}
                </div>
                {aba === "emojis"
                    ? <AbaEmojis categorias={categorias} erroDados={erroDados} tentarDeNovo={carregarEmojis}
                        busca={busca} setBusca={setBusca} recentes={recentes} escolher={escolherEmoji} />
                    : <AbaFigurinhas sessionId={sessionId} jid={jid} aoEnviar={() => { setAberto(false); onFigurinhaEnviada(); }} />}
            </PopoverContent>
        </Popover>
    );
}

// ---------------- aba Emojis ----------------

function BotaoEmoji({ emoji, rotulo, aoClicar }: Readonly<{ emoji: string; rotulo?: string; aoClicar: (e: string) => void }>) {
    return (
        <button type="button" title={rotulo || undefined} onMouseDown={(e) => e.preventDefault()} onClick={() => aoClicar(emoji)}
            className="h-9 w-full flex items-center justify-center rounded-md text-xl leading-none hover:bg-primary/15 focus-visible:bg-primary/15 focus-visible:outline-none">
            {emoji}
        </button>
    );
}

function SeletorTom({ tom, aoEscolher }: Readonly<{ tom: TomDePele; aoEscolher: (t: TomDePele) => void }>) {
    return (
        <div className="flex items-center gap-1.5 px-2 pb-1.5" role="radiogroup" aria-label="Tom de pele dos emojis">
            <span className="text-[10px] text-muted-foreground mr-0.5">Tom de pele</span>
            {TONS_DE_PELE.map((t) => (
                <button key={t.valor} type="button" role="radio" aria-checked={tom === t.valor} title={t.nome} aria-label={t.nome}
                    onMouseDown={(e) => e.preventDefault()} onClick={() => aoEscolher(t.valor)} style={{ background: t.cor }}
                    className={cn("h-5 w-5 rounded-full border border-black/15 transition-transform hover:scale-110",
                        tom === t.valor && "ring-2 ring-primary ring-offset-1 ring-offset-popover")} />
            ))}
        </div>
    );
}

type PropsAbaEmojis = {
    categorias: CategoriaEmoji[] | null; erroDados: boolean; tentarDeNovo: () => void;
    busca: string; setBusca: (v: string) => void; recentes: string[]; escolher: (e: string) => void;
};

function AbaEmojis({ categorias, erroDados, tentarDeNovo, busca, setBusca, recentes, escolher }: Readonly<PropsAbaEmojis>) {
    const [tom, definirTom] = useTomDePele();
    const [escolhendoTom, setEscolhendoTom] = useState(false);
    const [ativa, setAtiva] = useState("");
    const listaRef = useRef<VirtuosoHandle>(null);

    const { linhas, indices } = useMemo(
        () => (categorias ? montarLinhas(categorias, recentes, tom, COLUNAS) : { linhas: [] as LinhaPainel[], indices: {} as Record<string, number> }),
        [categorias, recentes, tom],
    );
    const achados = useMemo(() => (categorias && busca.trim() ? buscarEmojis(busca, categorias) : null), [categorias, busca]);

    const irPara = (id: string) => listaRef.current?.scrollToIndex({ index: indices[id] ?? 0, align: "start" });
    const trocarTom = (valor: TomDePele) => {
        definirTom(valor)
            .then((ok) => { if (!ok) toast.error("Não consegui salvar o tom de pele na sua conta"); })
            .catch(() => toast.error("Não consegui salvar o tom de pele na sua conta"));
    };
    const corDoTom = TONS_DE_PELE.find((t) => t.valor === tom)?.cor ?? TONS_DE_PELE[0].cor;

    return (
        <div>
            <div className="p-2 pb-1 flex items-center gap-1.5">
                <div className="relative flex-1">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar emoji (ex.: coração, risada)"
                        aria-label="Buscar emoji"
                        className="w-full h-8 rounded-lg border border-border/50 bg-background pl-7 pr-2 text-xs focus:outline-none focus:border-primary/60" />
                </div>
                <button type="button" title="Tom de pele dos emojis" aria-label="Tom de pele dos emojis" aria-expanded={escolhendoTom}
                    onMouseDown={(e) => e.preventDefault()} onClick={() => setEscolhendoTom((v) => !v)}
                    className={cn("h-8 w-8 shrink-0 flex items-center justify-center rounded-lg border border-border/50 hover:bg-primary/15", escolhendoTom && "bg-primary/15 border-primary/50")}>
                    <span className="h-4 w-4 rounded-full border border-black/15" style={{ background: corDoTom }} />
                </button>
            </div>
            {escolhendoTom && <SeletorTom tom={tom} aoEscolher={trocarTom} />}
            {categorias && !achados && (
                <div className="flex items-center gap-0.5 px-2 pb-1 overflow-x-auto">
                    {recentes.length > 0 && (
                        <button type="button" title="Recentes" onClick={() => irPara("recentes")}
                            className={cn("h-7 w-7 shrink-0 flex items-center justify-center rounded-md text-muted-foreground hover:bg-primary/15", ativa === "recentes" && "bg-primary/20 text-foreground")}><Clock className="h-4 w-4" /></button>
                    )}
                    {categorias.map((c) => (
                        <button key={c.id} type="button" title={c.nome} onClick={() => irPara(c.id)}
                            className={cn("h-7 w-7 shrink-0 flex items-center justify-center rounded-md text-base hover:bg-primary/15", ativa === c.id && "bg-primary/20")}>{c.icone}</button>
                    ))}
                </div>
            )}
            <div style={{ height: ALTURA_LISTA }}>
                {erroDados && (
                    <div className="py-10 px-4 text-center text-xs text-destructive">
                        Não consegui carregar os emojis.{" "}
                        <button type="button" onClick={tentarDeNovo} className="font-semibold underline underline-offset-2">Tentar de novo</button>
                    </div>
                )}
                {!erroDados && !categorias && (
                    <p className="py-10 flex items-center justify-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando emojis...</p>
                )}
                {categorias && achados && achados.length > 0 && (
                    <div className="h-full overflow-y-auto px-1.5 pb-2 styled-scrollbar">
                        <div className="grid grid-cols-9">
                            {achados.map((i) => <BotaoEmoji key={i.emoji} emoji={variantePorTom(i, tom)} rotulo={i.rotulo} aoClicar={escolher} />)}
                        </div>
                    </div>
                )}
                {categorias && achados && achados.length === 0 && (
                    <p className="py-8 text-center text-xs text-muted-foreground">Nenhum emoji para &quot;{busca.trim()}&quot;.</p>
                )}
                {categorias && !achados && (
                    <Virtuoso ref={listaRef} style={{ height: ALTURA_LISTA }} className="styled-scrollbar" data={linhas}
                        increaseViewportBy={240}
                        computeItemKey={(i, l) => (l.tipo === "titulo" ? `t-${l.id}` : `l-${i}`)}
                        rangeChanged={(r) => setAtiva(linhas[r.startIndex]?.id ?? "")}
                        itemContent={(_, l) => (l.tipo === "titulo"
                            ? <h4 className="px-2.5 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{l.nome}</h4>
                            : <div className="grid grid-cols-9 px-1.5">{l.itens.map((i) => <BotaoEmoji key={i.emoji} emoji={i.emoji} rotulo={i.rotulo} aoClicar={escolher} />)}</div>)} />
                )}
            </div>
        </div>
    );
}

// ---------------- aba Figurinhas ----------------

function AbaFigurinhas({ sessionId, jid, aoEnviar }: Readonly<{ sessionId: string; jid: string; aoEnviar: () => void }>) {
    const [lista, setLista] = useState<FigurinhaDaGrade[] | null>(null);
    const [erro, setErro] = useState<string | null>(null);
    const [removendo, setRemovendo] = useState<string | null>(null); // figurinha com o pedido de remover aberto
    const [ocupada, setOcupada] = useState(false);
    const [criando, setCriando] = useState(false);
    const arquivoRef = useRef<HTMLInputElement>(null);

    const carregar = useCallback(() => listarFigurinhas()
        .then((r) => {
            if (r.success) { setLista(r.itens); setErro(null); } else setErro(r.error);
        })
        .catch((e: any) => setErro(e?.message || "Não consegui carregar as figurinhas.")), []);
    useEffect(() => { void carregar(); }, [carregar]);

    const enviar = async (id: string) => {
        if (ocupada) return;
        setOcupada(true);
        try {
            exigirSucesso(await enviarFigurinha(sessionId, jid, id));
            aoEnviar();
        } catch (e: any) {
            toast.error(e?.message || "Não consegui enviar a figurinha");
        } finally {
            setOcupada(false);
        }
    };

    const remover = async (id: string) => {
        try {
            exigirSucesso(await removerFigurinha(id));
            setLista((atual) => (atual ? atual.filter((f) => f.id !== id) : atual));
            toast.success("Removida das suas figurinhas");
        } catch (e: any) {
            toast.error(e?.message || "Não consegui remover");
        } finally {
            setRemovendo(null);
        }
    };

    // opcao secundaria: reaproveita a rota que cria a figurinha (webp 512 px) a partir de uma imagem; enviar=0 so cria e guarda na colecao
    const criar = async (arquivo: File | undefined) => {
        if (!arquivo) return;
        setCriando(true);
        try {
            const fd = new FormData();
            fd.append("file", arquivo);
            fd.append("salvar", "1");
            fd.append("enviar", "0");
            const r = await fetch(`/api/messages/${sessionId}/${encodeURIComponent(jid)}/sticker`, { method: "POST", body: fd });
            const d = await r.json().catch(() => ({}));
            if (!r.ok || d?.status === false) throw new Error(d?.message || "Falha ao criar a figurinha");
            toast.success(d?.nova === false ? "Essa figurinha já estava nas suas figurinhas" : "Figurinha criada e adicionada às suas figurinhas");
            await carregar();
        } catch (e: any) {
            toast.error(e?.message || "Falha ao criar a figurinha");
        } finally {
            setCriando(false);
            if (arquivoRef.current) arquivoRef.current.value = "";
        }
    };

    return (
        <div className="p-2">
            <input ref={arquivoRef} type="file" accept="image/*" className="hidden" onChange={(e) => { void criar(e.target.files?.[0]); }} />
            <div className="flex items-center justify-between pb-1.5">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Minhas figurinhas{lista ? ` (${lista.length})` : ""}</span>
                <Button type="button" size="sm" variant="ghost" className="h-6 gap-1 px-1.5 text-[11px] font-normal text-muted-foreground hover:text-foreground"
                    title="Cria uma figurinha a partir de uma imagem do seu computador"
                    disabled={criando} onClick={() => arquivoRef.current?.click()}>
                    {criando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Criar de uma imagem
                </Button>
            </div>
            <div className="h-64 overflow-y-auto styled-scrollbar">
                {erro && <p className="py-8 text-center text-xs text-destructive">{erro}</p>}
                {!erro && !lista && <p className="py-8 text-center text-xs text-muted-foreground">Carregando...</p>}
                {!erro && lista?.length === 0 && (
                    <p className="py-8 px-4 text-center text-xs text-muted-foreground">
                        Você ainda não tem figurinhas. Na conversa, clique na estrela sobre uma figurinha recebida (ou use o botão direito &gt; Adicionar às figurinhas) para guardá-la aqui.
                    </p>
                )}
                {!erro && lista && lista.length > 0 && (
                    <div className="grid grid-cols-4 gap-1.5">
                        {lista.map((f) => (
                            <div key={f.id} className="relative group/fig aspect-square">
                                <button type="button" disabled={ocupada} onClick={() => { void enviar(f.id); }}
                                    onContextMenu={(e) => { e.preventDefault(); setRemovendo(f.id); }}
                                    title="Enviar esta figurinha (botão direito para remover)"
                                    className="h-full w-full rounded-lg p-1 hover:bg-primary/15 focus-visible:bg-primary/15 focus-visible:outline-none disabled:opacity-50">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={`/api/figurinhas/${f.id}`} alt="Figurinha" loading="lazy" className="h-full w-full object-contain" />
                                </button>
                                <button type="button" title="Remover das minhas figurinhas" aria-label="Remover das minhas figurinhas"
                                    onClick={() => setRemovendo(f.id)}
                                    className="absolute top-0 right-0 h-5 w-5 rounded-full bg-background/90 border border-border/60 text-muted-foreground opacity-0 group-hover/fig:opacity-100 focus-visible:opacity-100 flex items-center justify-center hover:text-destructive">
                                    <Trash2 className="h-3 w-3" />
                                </button>
                                {removendo === f.id && (
                                    <div className="absolute inset-0 z-10 rounded-lg bg-background/95 border border-border flex flex-col items-center justify-center gap-1 p-1 text-center">
                                        <button type="button" onClick={() => { void remover(f.id); }}
                                            className="text-[10px] leading-tight font-medium text-destructive hover:underline">Remover das minhas figurinhas</button>
                                        <button type="button" onClick={() => setRemovendo(null)} className="text-[10px] text-muted-foreground hover:underline">Cancelar</button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
