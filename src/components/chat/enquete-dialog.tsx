"use client";

// minha versao: criar uma ENQUETE (pergunta, 2 a 12 opcoes, "permitir varias respostas") e enviar na conversa.
// As regras ficam em lib/enquete (as mesmas que o servidor confere).
import { useState } from "react";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { enviarEnquete } from "@/app/dashboard/chat/actions";
import { MAX_OPCAO, MAX_OPCOES, MAX_PERGUNTA, MIN_OPCOES, validarEnquete } from "@/lib/enquete";

type Props = {
    open: boolean;
    onOpenChange: (aberto: boolean) => void;
    sessionId: string;
    jid: string;
    onEnviada?: () => void;
};

const OPCOES_INICIAIS = ["", ""];

export function EnqueteDialog({ open, onOpenChange, sessionId, jid, onEnviada }: Readonly<Props>) {
    const [pergunta, setPergunta] = useState("");
    const [opcoes, setOpcoes] = useState<string[]>(OPCOES_INICIAIS);
    const [multipla, setMultipla] = useState(false);
    const [enviando, setEnviando] = useState(false);

    const validacao = validarEnquete({ pergunta, opcoes, multipla });

    const limpar = () => { setPergunta(""); setOpcoes(OPCOES_INICIAIS); setMultipla(false); };
    const mudarOpcao = (i: number, v: string) => setOpcoes((atual) => atual.map((o, k) => (k === i ? v : o)));
    const tirarOpcao = (i: number) => setOpcoes((atual) => (atual.length > MIN_OPCOES ? atual.filter((_, k) => k !== i) : atual));
    const incluirOpcao = () => setOpcoes((atual) => (atual.length < MAX_OPCOES ? [...atual, ""] : atual));

    const enviar = async () => {
        if (enviando || !validacao.ok) return;
        setEnviando(true);
        try {
            const r = await enviarEnquete(sessionId, jid, { pergunta, opcoes, multipla });
            if (!r.success) throw new Error("error" in r ? r.error : "Não consegui enviar a enquete");
            toast.success("Enquete enviada");
            limpar();
            onOpenChange(false);
            onEnviada?.();
        } catch (e: unknown) {
            toast.error(e instanceof Error && e.message ? e.message : "Não consegui enviar a enquete");
        } finally {
            setEnviando(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(aberto) => { if (!enviando) onOpenChange(aberto); }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Nova enquete</DialogTitle>
                </DialogHeader>

                <div className="space-y-1.5">
                    <label htmlFor="enquete-pergunta" className="text-xs font-medium text-muted-foreground">Pergunta</label>
                    <Input id="enquete-pergunta" value={pergunta} maxLength={MAX_PERGUNTA} autoFocus disabled={enviando}
                        placeholder="Faça uma pergunta" onChange={(e) => setPergunta(e.target.value)} />
                </div>

                <div className="space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Opções ({MIN_OPCOES} a {MAX_OPCOES})</span>
                    <div className="space-y-2 max-h-64 overflow-y-auto pr-1 styled-scrollbar">
                        {opcoes.map((o, i) => (
                            <div key={i} className="flex items-center gap-1.5">
                                <Input value={o} maxLength={MAX_OPCAO} disabled={enviando} placeholder={`Opção ${i + 1}`}
                                    aria-label={`Opção ${i + 1}`} onChange={(e) => mudarOpcao(i, e.target.value)} />
                                <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" title="Tirar opção"
                                    disabled={enviando || opcoes.length <= MIN_OPCOES} onClick={() => tirarOpcao(i)}>
                                    <X className="h-3.5 w-3.5" />
                                </Button>
                            </div>
                        ))}
                    </div>
                    <Button type="button" variant="ghost" size="sm" className="gap-1.5 text-xs text-primary"
                        disabled={enviando || opcoes.length >= MAX_OPCOES} onClick={incluirOpcao}>
                        <Plus className="h-3.5 w-3.5" /> Adicionar opção
                    </Button>
                </div>

                <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={multipla} onCheckedChange={(v) => setMultipla(v === true)} disabled={enviando} />
                    Permitir várias respostas
                </label>

                {!validacao.ok && (pergunta.trim() || opcoes.some((o) => o.trim())) && (
                    <p className="text-xs text-muted-foreground">{validacao.erro}</p>
                )}

                <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={enviando}>Cancelar</Button>
                    <Button onClick={() => void enviar()} disabled={enviando || !validacao.ok}>{enviando ? "Enviando…" : "Enviar enquete"}</Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
