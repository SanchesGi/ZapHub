"use client";

// minha versao: editar mensagem de texto enviada (o WhatsApp deixa ate 15 minutos depois de enviar).
// Abrir com key={keyId} no pai: o texto inicial vem da mensagem a cada nova edicao.
import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { editarMensagem } from "@/app/dashboard/chat/actions";
import { TAMANHO_MAX_EDICAO } from "@/lib/editar-mensagem";

type Props = {
    sessionId: string;
    jid: string;
    mensagem: { keyId: string; content: string | null } | null;
    onFechar: () => void;
};

export function EditarMensagemDialog({ sessionId, jid, mensagem, onFechar }: Readonly<Props>) {
    const [texto, setTexto] = useState(mensagem?.content || "");
    const [salvando, setSalvando] = useState(false);

    const salvar = async () => {
        if (!mensagem || salvando) return;
        const novo = texto.trim();
        if (!novo) return;
        if (novo === (mensagem.content || "").trim()) {
            onFechar();
            return;
        }
        setSalvando(true);
        try {
            const r = await editarMensagem(sessionId, mensagem.keyId, novo, jid);
            if (!r.success) throw new Error("error" in r ? r.error : "Não consegui editar a mensagem");
            toast.success("Mensagem editada");
            onFechar();
        } catch (e: unknown) {
            toast.error(e instanceof Error && e.message ? e.message : "Não consegui editar a mensagem");
        } finally {
            setSalvando(false);
        }
    };

    return (
        <Dialog open={!!mensagem} onOpenChange={(aberto) => { if (!aberto && !salvando) onFechar(); }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Editar mensagem</DialogTitle>
                </DialogHeader>
                <p className="text-xs text-muted-foreground">
                    O WhatsApp deixa editar até 15 minutos depois de enviar. Quem recebeu vê a mensagem nova, marcada como editada.
                </p>
                <Textarea
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    maxLength={TAMANHO_MAX_EDICAO}
                    rows={4}
                    autoFocus
                    disabled={salvando}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            void salvar();
                        }
                    }}
                />
                <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={onFechar} disabled={salvando}>Cancelar</Button>
                    <Button onClick={() => void salvar()} disabled={salvando || !texto.trim()}>{salvando ? "Salvando…" : "Salvar"}</Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
