"use client";

// minha versao: trilha de auditoria de ACESSO (login, 2FA, usuarios, papeis, senha). Apenas SUPERADMIN.
import { useEffect, useState, useCallback } from "react";
import { ShieldCheck, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Log = {
  id: string; quando: string; tipo: string;
  usuarioEmail: string | null; alvo: string | null; ip: string | null; detalhe: string | null;
};

const TIPOS: Record<string, { rotulo: string; cor: string }> = {
  LOGIN_OK: { rotulo: "Login OK", cor: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  LOGIN_FALHA: { rotulo: "Login falhou", cor: "bg-red-500/10 text-red-700 dark:text-red-400" },
  LOGIN_2FA_FALHA: { rotulo: "2FA falhou", cor: "bg-red-500/10 text-red-700 dark:text-red-400" },
  LOGOUT: { rotulo: "Logout", cor: "bg-muted text-muted-foreground" },
  "2FA_ATIVADO": { rotulo: "2FA ativado", cor: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  "2FA_DESATIVADO": { rotulo: "2FA desativado", cor: "bg-amber-500/15 text-amber-800 dark:text-amber-400" },
  USUARIO_CRIADO: { rotulo: "Usuário criado", cor: "bg-primary/15 text-foreground" },
  USUARIO_REMOVIDO: { rotulo: "Usuário removido", cor: "bg-red-500/10 text-red-700 dark:text-red-400" },
  PAPEL_ALTERADO: { rotulo: "Papel alterado", cor: "bg-amber-500/15 text-amber-800 dark:text-amber-400" },
  SENHA_TROCADA: { rotulo: "Senha trocada", cor: "bg-primary/15 text-foreground" },
  SESSAO_COMPARTILHADA: { rotulo: "Sessão compartilhada", cor: "bg-primary/15 text-foreground" },
  MANUTENCAO: { rotulo: "Manutenção", cor: "bg-muted text-foreground" },
  TERMOS_ACEITOS: { rotulo: "Termos aceitos", cor: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  CONTA_EXCLUIDA: { rotulo: "Conta excluída", cor: "bg-red-500/10 text-red-700 dark:text-red-400" },
  LGPD: { rotulo: "LGPD", cor: "bg-primary/15 text-foreground" },
};

export default function SegurancaPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [tipo, setTipo] = useState("");
  const [busca, setBusca] = useState("");

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ limit: "100" });
      if (tipo) p.set("tipo", tipo);
      if (busca.trim()) p.set("busca", busca.trim());
      const r = await fetch(`/api/logs-acesso?${p}`);
      const d = await r.json();
      if (d?.status) { setLogs(d.data || []); setTotal(d.meta?.total || 0); }
      else { setLogs([]); setTotal(0); }
    } catch { setLogs([]); }
    finally { setLoading(false); }
  }, [tipo, busca]);

  useEffect(() => { const t = setTimeout(carregar, 250); return () => clearTimeout(t); }, [carregar]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 sm:h-6 sm:w-6 text-primary" /> Auditoria de acesso
          </h1>
          <p className="text-sm text-muted-foreground">Login, 2FA, usuários, papéis e senha — {total} registro{total === 1 ? "" : "s"}.</p>
        </div>
        <Button variant="outline" size="sm" onClick={carregar} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? "animate-spin" : ""}`} /> Atualizar
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por e-mail, alvo, IP…" value={busca} onChange={(e) => setBusca(e.target.value)} className="pl-8" />
        </div>
        <select
          value={tipo} onChange={(e) => setTipo(e.target.value)}
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm dark:bg-input/30"
        >
          <option value="">Todos os tipos</option>
          {Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v.rotulo}</option>)}
        </select>
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="text-left font-medium px-3 py-2 whitespace-nowrap">Quando</th>
                <th className="text-left font-medium px-3 py-2">Evento</th>
                <th className="text-left font-medium px-3 py-2">Usuário</th>
                <th className="text-left font-medium px-3 py-2">Alvo / detalhe</th>
                <th className="text-left font-medium px-3 py-2 whitespace-nowrap">IP</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 && !loading && (
                <tr><td colSpan={5} className="text-center text-muted-foreground py-8">Nenhum registro.</td></tr>
              )}
              {logs.map((l) => {
                const info = TIPOS[l.tipo] || { rotulo: l.tipo, cor: "bg-muted text-muted-foreground" };
                return (
                  <tr key={l.id} className="border-t border-border/50 hover:bg-muted/20">
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground text-xs">{new Date(l.quando).toLocaleString("pt-BR")}</td>
                    <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${info.cor}`}>{info.rotulo}</span></td>
                    <td className="px-3 py-2 break-all">{l.usuarioEmail || <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-3 py-2 break-all text-muted-foreground text-xs">{[l.alvo, l.detalhe].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap font-mono text-xs text-muted-foreground">{l.ip || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {total > logs.length && (
        <p className="text-xs text-muted-foreground text-center">Mostrando os {logs.length} mais recentes de {total}. Use a busca/filtro para refinar.</p>
      )}
    </div>
  );
}
