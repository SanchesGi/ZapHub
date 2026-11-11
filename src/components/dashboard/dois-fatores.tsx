"use client";

// minha versao: configuracao do 2FA (TOTP). Aparece SO para SUPERADMIN.
// Ativar: gera QR -> admin escaneia no app (Google Authenticator/Authy) -> digita um codigo -> ativa.
// Desativar: pede a senha atual.
import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, ShieldOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

export function DoisFatores({ collapsed = false }: { collapsed?: boolean }) {
  const [podeUsar, setPodeUsar] = useState(false);
  const [ativo, setAtivo] = useState(false);
  const [open, setOpen] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [segredo, setSegredo] = useState<string>("");
  const [codigo, setCodigo] = useState("");
  const [senha, setSenha] = useState("");
  const [prova, setProva] = useState(""); // minha versao: comprova o segredo gerado; o /enable exige

  const carregarStatus = useCallback(async () => {
    try {
      const r = await fetch("/api/me/2fa");
      const d = await r.json();
      if (d?.status) { setPodeUsar(!!d.data.podeUsar); setAtivo(!!d.data.ativo); }
    } catch { /* ignora */ }
  }, []);

  useEffect(() => { carregarStatus(); }, [carregarStatus]);

  const abrir = () => {
    setCodigo(""); setSenha(""); setQr(null); setSegredo(""); setProva("");
    setOpen(true);
  };

  // minha versao: gerar o QR exige a senha atual (nada e gravado ate o codigo ser confirmado)
  const gerarQr = async () => {
    setCarregando(true);
    try {
      const r = await fetch("/api/me/2fa/setup", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senha }),
      });
      const d = await r.json();
      if (d?.status) { setQr(d.data.qr); setSegredo(d.data.segredo); setProva(d.data.prova); setSenha(""); }
      else toast.error(d?.message || "Falha ao preparar o 2FA");
    } catch { toast.error("Falha ao preparar o 2FA"); }
    finally { setCarregando(false); }
  };

  const ativar = async () => {
    setCarregando(true);
    try {
      const r = await fetch("/api/me/2fa/enable", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo: codigo.replace(/\s/g, "") }),
      });
      const d = await r.json();
      if (d?.status) { toast.success(d.message || "2FA ativado"); setAtivo(true); setOpen(false); }
      else toast.error(d?.message || "Código inválido");
    } catch { toast.error("Falha ao ativar"); }
    finally { setCarregando(false); }
  };

  const desativar = async () => {
    setCarregando(true);
    try {
      const r = await fetch("/api/me/2fa/disable", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senha }),
      });
      const d = await r.json();
      if (d?.status) { toast.success(d.message || "2FA desativado"); setAtivo(false); setOpen(false); }
      else toast.error(d?.message || "Senha incorreta");
    } catch { toast.error("Falha ao desativar"); }
    finally { setCarregando(false); }
  };

  if (!podeUsar) return null;

  return (
    <>
      {collapsed ? (
        <button
          onClick={abrir}
          aria-label="Autenticação 2FA" title={ativo ? "2FA ativo" : "Ativar 2FA"}
          className={`p-2 rounded-lg transition-colors ${ativo ? "text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10" : "text-muted-foreground hover:text-primary hover:bg-primary/10"}`}
        >
          {ativo ? <ShieldCheck size={16} /> : <ShieldOff size={16} />}
        </button>
      ) : (
        <Button
          variant="outline" size="sm"
          className="w-full flex items-center justify-center gap-2 text-xs h-8 rounded-lg border-border/40 hover:bg-primary/10 hover:text-primary hover:border-primary/30 transition-colors mb-1.5"
          onClick={abrir}
        >
          {ativo ? <ShieldCheck size={14} className="text-emerald-600 dark:text-emerald-400" /> : <ShieldOff size={14} />}
          {ativo ? "2FA ativo" : "Ativar 2FA"}
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" /> Autenticação em duas etapas
            </DialogTitle>
            <DialogDescription>
              {ativo ? "O 2FA está ativo. Para desligar, confirme sua senha." : "Proteja sua conta de administrador com um app autenticador."}
            </DialogDescription>
          </DialogHeader>

          {!ativo ? (
            !qr ? (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Sua senha atual</Label>
                  <Input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="••••••••" />
                </div>
                <Button className="w-full" onClick={gerarQr} disabled={carregando || !senha}>
                  {carregando ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-1.5" />}
                  Gerar QR
                </Button>
              </div>
            ) : (
            <div className="space-y-4">
              <ol className="text-sm text-muted-foreground list-decimal pl-5 space-y-1">
                <li>Instale um app autenticador (Google Authenticator, Authy, Microsoft Authenticator).</li>
                <li>Escaneie o QR abaixo (ou digite o código manual).</li>
                <li>Digite o código de 6 dígitos que o app mostrar e clique em Ativar.</li>
              </ol>
              <div className="flex flex-col items-center gap-2">
                {carregando && !qr ? (
                  <Loader2 className="h-8 w-8 animate-spin text-primary my-6" />
                ) : qr ? (
                  <img src={qr} alt="QR do 2FA" className="rounded-lg border border-border/60 bg-white p-1" width={200} height={200} />
                ) : null}
                {segredo && (
                  <div className="text-center">
                    <p className="text-[11px] text-muted-foreground">Não consegue escanear? Código manual:</p>
                    <code className="text-xs font-mono bg-muted px-2 py-1 rounded select-all break-all">{segredo}</code>
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Código do app (6 dígitos)</Label>
                <Input inputMode="numeric" maxLength={6} placeholder="000000" value={codigo}
                  onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))}
                  className="tracking-[0.3em] text-center" />
              </div>
              <Button className="w-full" onClick={ativar} disabled={carregando || codigo.replace(/\s/g, "").length !== 6}>
                {carregando ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-1.5" />}
                Ativar 2FA
              </Button>
            </div>
            )
          ) : (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Sua senha atual</Label>
                <Input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="••••••••" />
              </div>
              <Button variant="destructive" className="w-full" onClick={desativar} disabled={carregando || !senha}>
                {carregando ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <ShieldOff className="h-4 w-4 mr-1.5" />}
                Desativar 2FA
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
