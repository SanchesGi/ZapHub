"use client";

// minha versao: "Info da mensagem". Mensagem enviada: Enviada / Entregue / Lida com horario; em GRUPO, a lista de
// quem recebeu e de quem leu (nome ou telefone + hora). Os dados vem de infoDaMensagem (recibos gravados no servidor).
import { useEffect, useState } from "react";
import { Check, CheckCheck, Send } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { infoDaMensagem } from "@/app/dashboard/chat/actions";
import type { InfoDaMensagem, PessoaInfo } from "@/modules/whatsapp/info-mensagem";
import { formatarTelefone } from "./chat-info-panel";

type Props = {
    sessionId: string;
    mensagem: { keyId: string; fromMe: boolean; timestamp: string; status: string } | null;
    onFechar: () => void;
};

const hora = (ms: number | null) => (ms ? new Date(ms).toLocaleString([], { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : null);

function nomeDaPessoa(p: PessoaInfo): string {
    return p.nome || (p.telefone ? formatarTelefone(p.telefone) : "") || "Número oculto";
}

function Linha({ icone, titulo, em, ok }: Readonly<{ icone: React.ReactNode; titulo: string; em: number | null; ok: boolean }>) {
    return (
        <div className="flex items-center justify-between gap-3 text-sm">
            <span className={ok ? "flex items-center gap-2" : "flex items-center gap-2 text-muted-foreground"}>{icone}{titulo}</span>
            <span className="text-xs text-muted-foreground tabular-nums">{ok ? (hora(em) || "") : "—"}</span>
        </div>
    );
}

function ListaPessoas({ titulo, pessoas }: Readonly<{ titulo: string; pessoas: PessoaInfo[] }>) {
    if (!pessoas.length) return null;
    return (
        <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">{titulo} ({pessoas.length})</p>
            <ul className="max-h-40 overflow-y-auto styled-scrollbar space-y-1">
                {pessoas.map((p) => (
                    <li key={p.jid} className="flex items-center justify-between gap-3 text-sm">
                        <span className="truncate">{nomeDaPessoa(p)}</span>
                        <span className="text-xs text-muted-foreground tabular-nums shrink-0">{hora(p.em)}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

export function InfoMensagemDialog({ sessionId, mensagem, onFechar }: Readonly<Props>) {
    const [info, setInfo] = useState<InfoDaMensagem | null>(null);
    const [erro, setErro] = useState<string | null>(null);
    const keyId = mensagem?.keyId || null;

    useEffect(() => {
        if (!keyId) return;
        let ativo = true;
        setInfo(null); setErro(null);
        infoDaMensagem(sessionId, keyId)
            .then((r) => { if (!ativo) return; if (r.success) setInfo(r.info); else setErro(r.error); })
            .catch(() => { if (ativo) setErro("Não consegui carregar a info da mensagem"); });
        return () => { ativo = false; };
    }, [sessionId, keyId]);

    return (
        <Dialog open={!!mensagem} onOpenChange={(aberto) => { if (!aberto) onFechar(); }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Info da mensagem</DialogTitle>
                </DialogHeader>
                {mensagem && !mensagem.fromMe && (
                    <p className="text-sm text-muted-foreground">Recebida em {hora(new Date(mensagem.timestamp).getTime())}</p>
                )}
                {erro && <p className="text-sm text-destructive">{erro}</p>}
                {mensagem?.fromMe && !info && !erro && <p className="text-sm text-muted-foreground">Carregando…</p>}
                {info && info.fromMe && (
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Linha icone={<Send className="h-3.5 w-3.5" />} titulo="Enviada" em={info.enviadaEm} ok />
                            <Linha icone={<Check className="h-3.5 w-3.5" />} titulo={info.grupo ? "Entregue (a alguém)" : "Entregue"} em={info.entregueEm} ok={info.entregue} />
                            <Linha icone={<CheckCheck className="h-3.5 w-3.5 text-primary" />} titulo={info.grupo ? "Lida (por alguém)" : "Lida"} em={info.lidaEm} ok={info.lida} />
                        </div>
                        {info.grupo && (
                            <div className="space-y-3">
                                {info.totalParticipantes !== null && (
                                    <p className="text-xs text-muted-foreground">
                                        {info.lidaPor.length} de {info.totalParticipantes} leram
                                    </p>
                                )}
                                <ListaPessoas titulo="Lida por" pessoas={info.lidaPor} />
                                <ListaPessoas titulo="Entregue a" pessoas={info.entreguePara} />
                                {!info.lidaPor.length && !info.entreguePara.length && (
                                    <p className="text-xs text-muted-foreground">
                                        Ainda sem recibos dos participantes. Só aparecem os recibos recebidos depois desta versão e de quem deixou a confirmação de leitura ligada.
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
