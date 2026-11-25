"use client";

// minha versao: botao "Status" no topo da lista de conversas (com a contagem de status novos) e a tela de status.
// Os status moram em src/components/chat/status-*.tsx e na tabela Story; nada disto entra na lista de conversas.
import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { listarStatus } from "@/app/dashboard/chat/status-actions";
import type { GrupoStatusDTO, ListaStatusDTO } from "@/lib/status-puro";
import { useSocket } from "./socket-context";
import { StatusPainel } from "./status-painel";

const ESPERA_RECARGA_MS = 600;

/** marca um status como visto na lista local (so a copia da tela; o servidor grava por usuario) */
function comoVisto(dados: ListaStatusDTO, id: string): ListaStatusDTO {
    const atualiza = (g: GrupoStatusDTO): GrupoStatusDTO => {
        if (!g.itens.some((i) => i.id === id && !i.visto)) return g;
        const itens = g.itens.map((i) => (i.id === id ? { ...i, visto: true } : i));
        return { ...g, itens, naoVistos: itens.filter((i) => !i.visto).length };
    };
    const contatos = dados.contatos.map(atualiza);
    return {
        ...dados,
        meus: dados.meus ? atualiza(dados.meus) : null,
        contatos,
        totalNaoVistos: contatos.reduce((n, g) => n + g.naoVistos, 0),
    };
}

export function StatusBotao({ sessionId }: { sessionId: string }) {
    const { getSocket } = useSocket();
    const [aberto, setAberto] = useState(false);
    const [dados, setDados] = useState<ListaStatusDTO | null>(null);
    const [carregando, setCarregando] = useState(true);
    const pedido = useRef(0);
    const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

    const carregar = useCallback(async () => {
        const meu = ++pedido.current;
        try {
            const r = await listarStatus(sessionId);
            if (meu === pedido.current && r.success) setDados(r.dados);
        } catch {
            /* sem rede agora: a proxima chegada de status ou a reconexao recarrega */
        } finally {
            if (meu === pedido.current) setCarregando(false);
        }
    }, [sessionId]);

    // outra sessao: zera e carrega a dela
    useEffect(() => {
        setDados(null);
        setCarregando(true);
        void carregar();
    }, [carregar]);

    // tempo real: status novo (ou apagado) nesta sessao -> recarrega, agrupando rajadas num so pedido
    useEffect(() => {
        const socket = getSocket();
        if (!socket) return;
        const recarregarLogo = () => {
            if (temporizador.current) clearTimeout(temporizador.current);
            temporizador.current = setTimeout(() => { void carregar(); }, ESPERA_RECARGA_MS);
        };
        const aoMudar = (d: { sessionKey?: string }) => { if (d?.sessionKey === sessionId) recarregarLogo(); };
        socket.on("status.update", aoMudar);
        socket.on("connect", recarregarLogo); // o tempo real caiu e voltou: pode ter perdido algo
        return () => {
            socket.off("status.update", aoMudar);
            socket.off("connect", recarregarLogo);
            if (temporizador.current) clearTimeout(temporizador.current);
        };
    }, [getSocket, sessionId, carregar]);

    // ao abrir, atualiza (os status vencem com o tempo)
    useEffect(() => { if (aberto) void carregar(); }, [aberto, carregar]);

    const novos = dados?.totalNaoVistos ?? 0;
    return (
        <>
            <Button variant="ghost" size="icon" className="relative h-8 w-8 rounded-lg" onClick={() => setAberto(true)}
                title={novos > 0 ? `Status (${novos} novo${novos === 1 ? "" : "s"})` : "Status"} aria-label={novos > 0 ? `Status, ${novos} novos` : "Status"}>
                <Sparkles className="h-4 w-4" />
                {novos > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground">
                        {novos > 99 ? "99+" : novos}
                    </span>
                )}
            </Button>
            {aberto && (
                <StatusPainel
                    sessionId={sessionId}
                    aberto={aberto}
                    onAbertoChange={setAberto}
                    dados={dados}
                    carregando={carregando}
                    onVisto={(id) => setDados((d) => (d ? comoVisto(d, id) : d))}
                    onRecarregar={() => { void carregar(); }}
                />
            )}
        </>
    );
}
