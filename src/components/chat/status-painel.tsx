"use client";

// minha versao: tela de status (stories) do ZapHub: "Meu status", novos e vistos. Cada contato abre o visualizador.
import { useCallback, useEffect, useState } from "react";
import { Plus, Sparkles } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { marcarStatusVistos } from "@/app/dashboard/chat/status-actions";
import { tempoRelativo, type GrupoStatusDTO, type ListaStatusDTO } from "@/lib/status-puro";
import { StatusVisualizador } from "./status-visualizador";
import { StatusPublicar } from "./status-publicar";

interface Props {
    sessionId: string;
    aberto: boolean;
    onAbertoChange: (v: boolean) => void;
    dados: ListaStatusDTO | null;
    carregando: boolean;
    /** o servidor marcou como visto: a lista local acompanha sem recarregar */
    onVisto: (id: string) => void;
    onRecarregar: () => void;
}

function LinhaGrupo({ grupo, titulo, onAbrir }: { grupo: GrupoStatusDTO; titulo?: string; onAbrir: () => void }) {
    const novo = grupo.naoVistos > 0;
    const nome = titulo || grupo.nome;
    return (
        <button type="button" onClick={onAbrir}
            className={cn("flex w-full cursor-pointer items-center gap-3 border-l-[3px] px-3 py-2.5 text-left transition-colors hover:bg-muted/60", novo ? "border-primary" : "border-transparent")}>
            <Avatar className="h-10 w-10">
                {grupo.fotoUrl ? <AvatarImage src={grupo.fotoUrl} alt="" /> : null}
                <AvatarFallback className="bg-primary/15 text-sm font-semibold text-primary">{(nome[0] || "?").toUpperCase()}</AvatarFallback>
            </Avatar>
            <span className="min-w-0 flex-1">
                <span className={cn("block truncate text-sm", novo ? "font-semibold" : "font-medium")}>{nome}</span>
                <span className="block text-[11px] text-muted-foreground">
                    {grupo.total} status · {tempoRelativo(grupo.ultimoEm)}
                </span>
            </span>
            {novo && (
                <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
                    {grupo.naoVistos}
                </span>
            )}
        </button>
    );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
    return (
        <section aria-label={titulo}>
            <h3 className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{titulo}</h3>
            {children}
        </section>
    );
}

export function StatusPainel({ sessionId, aberto, onAbertoChange, dados, carregando, onVisto, onRecarregar }: Props) {
    const [vendo, setVendo] = useState<{ jid: string; meu: boolean; indice: number } | null>(null);
    const [publicando, setPublicando] = useState(false);

    const grupoAberto = vendo ? (vendo.meu ? dados?.meus : dados?.contatos.find((g) => g.jid === vendo.jid)) ?? null : null;

    // o contato aberto sumiu da lista (status vencido ou apagado): volta para a lista em vez de ficar sem tela
    useEffect(() => {
        if (vendo && dados && !grupoAberto) setVendo(null);
    }, [vendo, dados, grupoAberto]);

    const abrir = (g: GrupoStatusDTO, meu: boolean) => {
        const primeiroNovo = g.itens.findIndex((i) => !i.visto);
        setVendo({ jid: g.jid, meu, indice: primeiroNovo >= 0 ? primeiroNovo : 0 });
    };

    const aoVer = useCallback((id: string) => {
        onVisto(id);
        marcarStatusVistos(sessionId, [id]).catch(() => { /* o proximo carregamento da lista corrige */ });
    }, [sessionId, onVisto]);

    const novos = dados?.contatos.filter((g) => g.naoVistos > 0) ?? [];
    const jaVistos = dados?.contatos.filter((g) => g.naoVistos === 0) ?? [];
    const vazio = !!dados && !dados.meus && dados.contatos.length === 0;

    return (
        <>
            <Dialog open={aberto && !vendo && !publicando} onOpenChange={onAbertoChange}>
                <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-md">
                    <DialogHeader className="border-b border-border/40 px-4 py-3">
                        <DialogTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4 text-primary" />Status</DialogTitle>
                        <DialogDescription className="text-xs">Publicações de texto, foto e vídeo que somem em 24 horas.</DialogDescription>
                    </DialogHeader>

                    <div className="min-h-0 flex-1 overflow-y-auto styled-scrollbar pb-3">
                        {carregando && !dados ? (
                            <div className="space-y-3 p-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
                        ) : (
                            <>
                                {dados?.podePublicar && (
                                    <Secao titulo="Meu status">
                                        {dados.meus && <LinhaGrupo grupo={dados.meus} titulo="Meu status" onAbrir={() => abrir(dados.meus!, true)} />}
                                        <div className="px-3 py-1.5">
                                            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setPublicando(true)}>
                                                <Plus className="h-4 w-4" />Publicar status
                                            </Button>
                                        </div>
                                    </Secao>
                                )}
                                {!dados?.podePublicar && dados?.meus && (
                                    <Secao titulo="Meu status"><LinhaGrupo grupo={dados.meus} titulo="Meu status" onAbrir={() => abrir(dados.meus!, true)} /></Secao>
                                )}
                                {novos.length > 0 && <Secao titulo="Novos">{novos.map((g) => <LinhaGrupo key={g.jid} grupo={g} onAbrir={() => abrir(g, false)} />)}</Secao>}
                                {jaVistos.length > 0 && <Secao titulo="Vistos">{jaVistos.map((g) => <LinhaGrupo key={g.jid} grupo={g} onAbrir={() => abrir(g, false)} />)}</Secao>}
                                {vazio && (
                                    <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                                        Nenhum status no momento. Os status dos seus contatos aparecem aqui assim que forem publicados.
                                    </p>
                                )}
                            </>
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            {vendo && grupoAberto && (
                <StatusVisualizador
                    sessionId={sessionId}
                    grupo={grupoAberto}
                    indiceInicial={vendo.indice}
                    onFechar={() => setVendo(null)}
                    onVisto={aoVer}
                />
            )}

            {publicando && dados?.podePublicar && (
                <StatusPublicar
                    sessionId={sessionId}
                    destinatarios={dados.destinatarios}
                    onFechar={() => setPublicando(false)}
                    onPublicado={() => { setPublicando(false); onRecarregar(); }}
                />
            )}
        </>
    );
}
