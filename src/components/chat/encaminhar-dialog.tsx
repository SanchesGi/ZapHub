"use client";

// minha versao: encaminhar uma mensagem para ate 5 conversas. Busca em todas as conversas (mesma busca da lista)
// e envia com a marca "Encaminhada", como o WhatsApp.
import { useEffect, useState } from "react";
import { Forward, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { getChatsStatus, encaminharMensagem } from "@/app/dashboard/chat/actions";
import { formatarTelefone } from "./chat-info-panel";

const MAX = 5;
type Conversa = { jid: string; name?: string | null; notify?: string | null };

export function EncaminharDialog({ sessionId, keyId, resumo, onFechar }: Readonly<{
    sessionId: string;
    keyId: string | null;
    resumo: string;
    onFechar: () => void;
}>) {
    const aberto = !!keyId;
    const [busca, setBusca] = useState("");
    const [lista, setLista] = useState<Conversa[]>([]);
    const [carregando, setCarregando] = useState(false);
    const [escolhidas, setEscolhidas] = useState<Map<string, string>>(new Map());
    const [enviando, setEnviando] = useState(false);

    useEffect(() => { if (aberto) { setBusca(""); setEscolhidas(new Map()); } }, [aberto]);

    useEffect(() => {
        if (!aberto) return;
        let vivo = true;
        const t = setTimeout(() => {
            setCarregando(true);
            getChatsStatus(sessionId, 30, undefined, busca.trim() || undefined, "all")
                .then((r: any) => { if (vivo) setLista(Array.isArray(r) ? r : []); })
                .catch(() => { if (vivo) setLista([]); })
                .finally(() => { if (vivo) setCarregando(false); });
        }, 250);
        return () => { vivo = false; clearTimeout(t); };
    }, [aberto, busca, sessionId]);

    const nomeDe = (c: Conversa) => c.name || c.notify || formatarTelefone(c.jid.split("@")[0]) || c.jid.split("@")[0];

    const alternar = (c: Conversa) => {
        setEscolhidas((atual) => {
            const novo = new Map(atual);
            if (novo.has(c.jid)) novo.delete(c.jid);
            else if (novo.size < MAX) novo.set(c.jid, nomeDe(c));
            else toast.info(`No máximo ${MAX} conversas por vez`);
            return novo;
        });
    };

    const enviar = async () => {
        if (!keyId || !escolhidas.size) return;
        setEnviando(true);
        try {
            const r: any = await encaminharMensagem(sessionId, keyId, [...escolhidas.keys()]);
            if (!r?.success) throw new Error(r?.error || "Falha ao encaminhar");
            if (r.falhas?.length) {
                const nomes = r.falhas.map((f: any) => escolhidas.get(f.jid) || f.jid).join(", ");
                toast.warning(`Encaminhada para ${r.enviados}; falhou para ${nomes}: ${r.falhas[0]?.erro || ""}`);
            } else {
                toast.success(r.enviados === 1 ? "Mensagem encaminhada" : `Mensagem encaminhada para ${r.enviados} conversas`);
            }
            onFechar();
        } catch (e: any) {
            toast.error(e?.message || "Falha ao encaminhar");
        } finally {
            setEnviando(false);
        }
    };

    return (
        <Dialog open={aberto} onOpenChange={(v) => { if (!v) onFechar(); }}>
            <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
                <DialogHeader className="px-5 pt-5 pb-3">
                    <DialogTitle className="flex items-center gap-2"><Forward className="h-5 w-5 text-primary" /> Encaminhar mensagem</DialogTitle>
                    <DialogDescription className="line-clamp-2 [overflow-wrap:anywhere]">{resumo}</DialogDescription>
                </DialogHeader>
                <div className="px-5 pb-2">
                    <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input autoFocus placeholder="Buscar conversa por nome ou número" value={busca} onChange={(e) => setBusca(e.target.value)} className="pl-8 h-9" />
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1.5">{escolhidas.size} de {MAX} escolhida(s)</p>
                </div>
                <div className="max-h-[45vh] min-h-[180px] overflow-y-auto px-2 pb-2 styled-scrollbar">
                    {carregando && lista.length === 0 && <div className="py-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
                    {!carregando && lista.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma conversa encontrada.</p>}
                    {lista.map((c) => {
                        const marcada = escolhidas.has(c.jid);
                        return (
                            <button key={c.jid} type="button" onClick={() => alternar(c)}
                                className={cn("w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left cursor-pointer hover:bg-muted/60", marcada && "bg-primary/10")}>
                                <Checkbox checked={marcada} className="pointer-events-none" />
                                <span className="min-w-0">
                                    <span className="block text-sm truncate">{nomeDe(c)}</span>
                                    <span className="block text-[11px] text-muted-foreground truncate">{c.jid.endsWith("@g.us") ? "Grupo" : formatarTelefone(c.jid.split("@")[0])}</span>
                                </span>
                            </button>
                        );
                    })}
                </div>
                <div className="flex justify-end gap-2 px-5 py-3 border-t border-border/50">
                    <Button variant="outline" onClick={onFechar} disabled={enviando}>Cancelar</Button>
                    <Button onClick={enviar} disabled={enviando || !escolhidas.size}>
                        {enviando ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Forward className="h-4 w-4 mr-1.5" />} Encaminhar
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
