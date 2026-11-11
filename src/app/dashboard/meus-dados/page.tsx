"use client";

// minha versao: Meus dados (LGPD, art. 18) — o proprio usuario baixa os seus dados e exclui a propria conta.
import { useState } from "react";
import { signOut } from "next-auth/react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Download, Loader2, Trash2, UserRoundCog } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export default function MeusDadosPage() {
    const t = useTranslations("lgpd.myData");
    const [baixando, setBaixando] = useState(false);
    const [aberto, setAberto] = useState(false);
    const [senha, setSenha] = useState("");
    const [confirmacao, setConfirmacao] = useState("");
    const [excluindo, setExcluindo] = useState(false);
    const [erro, setErro] = useState<string | null>(null);

    const baixar = async () => {
        setBaixando(true);
        try {
            const r = await fetch("/api/me/dados");
            if (!r.ok) throw new Error();
            const blob = await r.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "meus-dados-zaphub.json";
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            toast.success(t("downloaded"));
        } catch {
            toast.error(t("downloadError"));
        } finally {
            setBaixando(false);
        }
    };

    const fechar = (v: boolean) => {
        if (excluindo) return;
        setAberto(v);
        if (!v) { setSenha(""); setConfirmacao(""); setErro(null); }
    };

    const excluir = async () => {
        setExcluindo(true);
        setErro(null);
        try {
            const r = await fetch("/api/me/conta", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ senha, confirmacao }),
            });
            const d = await r.json().catch(() => ({}));
            if (!r.ok || d?.status === false) {
                const codigo = d?.error ?? d?.message;
                if (codigo === "senha_incorreta") setErro(t("wrongPassword"));
                else if (codigo === "ultimo_admin") setErro(t("lastAdmin"));
                else setErro(d?.message || t("deleteError"));
                setExcluindo(false);
                return;
            }
            await signOut({ callbackUrl: "/auth/login" });
        } catch {
            setErro(t("deleteError"));
            setExcluindo(false);
        }
    };

    return (
        <div className="max-w-3xl mx-auto space-y-6 p-4 md:p-6">
            <header>
                <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                    <UserRoundCog className="h-6 w-6 text-primary" aria-hidden="true" /> {t("title")}
                </h1>
                <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
            </header>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">{t("downloadTitle")}</CardTitle>
                    <CardDescription>{t("downloadText")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <Button onClick={baixar} disabled={baixando}>
                        {baixando ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> {t("downloading")}</> : <><Download className="h-4 w-4 mr-2" /> {t("download")}</>}
                    </Button>
                    <p className="text-xs text-muted-foreground">{t("contactsNote")}</p>
                </CardContent>
            </Card>

            <Card className="border-destructive/40">
                <CardHeader>
                    <CardTitle className="text-base text-destructive">{t("deleteTitle")}</CardTitle>
                    <CardDescription>{t("deleteText")}</CardDescription>
                </CardHeader>
                <CardContent>
                    <Button variant="destructive" onClick={() => setAberto(true)}>
                        <Trash2 className="h-4 w-4 mr-2" /> {t("delete")}
                    </Button>
                </CardContent>
            </Card>

            <Dialog open={aberto} onOpenChange={fechar}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{t("dialogTitle")}</DialogTitle>
                        <DialogDescription>{t("dialogText")}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div className="space-y-1">
                            <Label htmlFor="excluir-senha" className="text-xs">{t("password")}</Label>
                            <Input id="excluir-senha" type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} autoFocus />
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="excluir-confirmacao" className="text-xs">{t("confirmLabel")}</Label>
                            <Input id="excluir-confirmacao" autoComplete="off" value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} placeholder={t("confirmWord")} />
                        </div>
                        {erro && <p className="text-sm text-destructive" role="alert">{erro}</p>}
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => fechar(false)} disabled={excluindo}>{t("cancel")}</Button>
                        <Button variant="destructive" onClick={excluir} disabled={excluindo || !senha || confirmacao !== t("confirmWord")}>
                            {excluindo ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> {t("deleting")}</> : t("confirm")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
