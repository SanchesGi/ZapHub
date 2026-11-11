"use client";

// minha versao: o proprio usuario troca a sua senha (confere a atual, exige senha forte).
import { useState } from "react";
import { KeyRound, Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export function TrocarSenhaDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
    const [atual, setAtual] = useState("");
    const [nova, setNova] = useState("");
    const [conf, setConf] = useState("");
    const [ver, setVer] = useState(false);
    const [enviando, setEnviando] = useState(false);

    const limpar = () => { setAtual(""); setNova(""); setConf(""); setVer(false); };

    const salvar = async () => {
        if (nova.length < 4) { toast.error("A nova senha precisa ter pelo menos 4 caracteres."); return; }
        if (nova !== conf) { toast.error("A confirmação não bate com a nova senha."); return; }
        setEnviando(true);
        try {
            const r = await fetch("/api/me/senha", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ atual, nova }),
            });
            const d = await r.json().catch(() => ({}));
            if (!r.ok || d?.status === false) throw new Error(d?.message || "Não consegui trocar a senha");
            toast.success("Senha alterada com sucesso.");
            limpar();
            onOpenChange(false);
        } catch (e: any) {
            toast.error(e?.message || "Falha ao trocar a senha");
        } finally {
            setEnviando(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(v) => { if (!v) limpar(); onOpenChange(v); }}>
            <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-primary" /> Trocar minha senha</DialogTitle>
                    <DialogDescription>Confirme a senha atual e escolha uma nova (mínimo 4 caracteres).</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                    <div className="space-y-1">
                        <Label className="text-xs">Senha atual</Label>
                        <Input type={ver ? "text" : "password"} value={atual} onChange={(e) => setAtual(e.target.value)} autoFocus />
                    </div>
                    <div className="space-y-1">
                        <Label className="text-xs">Nova senha</Label>
                        <div className="relative">
                            <Input type={ver ? "text" : "password"} value={nova} onChange={(e) => setNova(e.target.value)} className="pr-9" />
                            <button type="button" onClick={() => setVer((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" title={ver ? "Ocultar" : "Mostrar"}>
                                {ver ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                        </div>
                    </div>
                    <div className="space-y-1">
                        <Label className="text-xs">Repita a nova senha</Label>
                        <Input type={ver ? "text" : "password"} value={conf} onChange={(e) => setConf(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") salvar(); }} />
                    </div>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                    <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={enviando}>Cancelar</Button>
                    <Button onClick={salvar} disabled={enviando || !atual || !nova || !conf}>
                        {enviando ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <KeyRound className="h-4 w-4 mr-1.5" />} Salvar
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
