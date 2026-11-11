"use client";

// minha versao: Privacidade (LGPD) — so Super Administrador.
//  (a) Pedidos de titulares  (b) Buscar titular por telefone: resumo, exportar e apagar  (c) Retencao dos dados.
// Tudo vem de /api/lgpd/* e /api/system/retencao (contrato em .claude/quadro/principal.md).
import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Download, Loader2, Play, Plus, Search, ShieldUser, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

async function chamar(url: string, init?: RequestInit) {
    const r = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d?.status === false) throw new Error(d?.message || d?.error || "Falhou");
    return d;
}

async function baixarArquivo(url: string, nome: string) {
    const r = await fetch(url);
    if (!r.ok) throw new Error("falhou");
    const blob = await r.blob();
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = u; a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(u);
}

const data = (v?: string | null) => (v ? new Date(v).toLocaleString("pt-BR") : "—");
const soDigitos = (v: string) => v.replace(/\D/g, "");

// select nativo com o mesmo visual dos campos
const SELECT_CLASSE = "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

/* ---------------------------------------------------------------- Pedidos */

type Pedido = {
    id: string; sessionId?: string | null; titular: string; nome?: string | null; tipo: string;
    descricao: string; status: "ABERTO" | "CONCLUIDO" | "RECUSADO"; resposta?: string | null;
    criadoEm: string; concluidoEm?: string | null;
};
const TIPOS = ["ACESSO", "CORRECAO", "EXCLUSAO", "OPOSICAO", "OUTRO"] as const;
const STATUS = { ABERTO: "OPEN", CONCLUIDO: "DONE", RECUSADO: "REFUSED" } as const;

function Pedidos() {
    const t = useTranslations("lgpd.admin");
    const tr = useTranslations("lgpd.admin.requests");
    const [filtro, setFiltro] = useState<"" | Pedido["status"]>("ABERTO");
    const [lista, setLista] = useState<Pedido[] | null>(null);
    const [erro, setErro] = useState(false);

    const [novoAberto, setNovoAberto] = useState(false);
    const [titular, setTitular] = useState("");
    const [nome, setNome] = useState("");
    const [tipo, setTipo] = useState<string>("ACESSO");
    const [descricao, setDescricao] = useState("");
    const [criando, setCriando] = useState(false);

    const [alvo, setAlvo] = useState<{ pedido: Pedido; status: "CONCLUIDO" | "RECUSADO" } | null>(null);
    const [resposta, setResposta] = useState("");
    const [salvando, setSalvando] = useState(false);

    const carregar = useCallback(async () => {
        setErro(false);
        setLista(null);
        try {
            const d = await chamar(`/api/lgpd/pedidos${filtro ? `?status=${filtro}` : ""}`);
            setLista(Array.isArray(d.data) ? d.data : d.data?.pedidos ?? []);
        } catch { setErro(true); }
    }, [filtro]);
    useEffect(() => { carregar(); }, [carregar]);

    const criar = async () => {
        setCriando(true);
        try {
            await chamar("/api/lgpd/pedidos", {
                method: "POST",
                body: JSON.stringify({ titular: soDigitos(titular) || titular.trim(), nome: nome.trim() || undefined, tipo, descricao: descricao.trim() }),
            });
            toast.success(tr("created"));
            setNovoAberto(false); setTitular(""); setNome(""); setTipo("ACESSO"); setDescricao("");
            carregar();
        } catch (e: any) { toast.error(e?.message || tr("createError")); }
        finally { setCriando(false); }
    };

    const encerrar = async () => {
        if (!alvo) return;
        if (alvo.status === "RECUSADO" && !resposta.trim()) { toast.error(tr("answerRequiredRefuse")); return; }
        setSalvando(true);
        try {
            await chamar(`/api/lgpd/pedidos/${encodeURIComponent(alvo.pedido.id)}`, {
                method: "PATCH",
                body: JSON.stringify({ status: alvo.status, resposta: resposta.trim() || undefined }),
            });
            toast.success(tr("updated"));
            setAlvo(null); setResposta("");
            carregar();
        } catch (e: any) { toast.error(e?.message || tr("updateError")); }
        finally { setSalvando(false); }
    };

    const filtros: { v: "" | Pedido["status"]; r: string }[] = [
        { v: "ABERTO", r: tr("filterOpen") }, { v: "CONCLUIDO", r: tr("filterDone") },
        { v: "RECUSADO", r: tr("filterRefused") }, { v: "", r: tr("filterAll") },
    ];

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("tabRequests")}>
                    {filtros.map((f) => (
                        <Button key={f.v || "todos"} size="sm" variant={filtro === f.v ? "default" : "outline"} aria-pressed={filtro === f.v} onClick={() => setFiltro(f.v)}>
                            {f.r}
                        </Button>
                    ))}
                </div>
                <Button size="sm" onClick={() => setNovoAberto(true)}><Plus className="h-4 w-4 mr-1.5" /> {tr("newRequest")}</Button>
            </div>

            {lista === null && !erro && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center" role="status"><Loader2 className="h-4 w-4 animate-spin" /> {t("loading")}</p>
            )}
            {erro && (
                <div className="text-center py-6 space-y-2">
                    <p className="text-sm text-destructive" role="alert">{t("loadError")}</p>
                    <Button size="sm" variant="outline" onClick={carregar}>{t("retry")}</Button>
                </div>
            )}
            {lista && lista.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">{tr("empty")}</p>}

            <ul className="space-y-3">
                {lista?.map((p) => (
                    <li key={p.id} className="rounded-xl border border-border/60 p-4 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                            {/* conteudo vindo de terceiros: sempre como texto */}
                            <span className="font-mono text-sm">{p.titular}</span>
                            {p.nome && <span className="text-sm text-muted-foreground">{p.nome}</span>}
                            <Badge variant="outline">{TIPOS.includes(p.tipo as any) ? tr(`type${p.tipo}` as any) : p.tipo}</Badge>
                            <Badge variant={p.status === "ABERTO" ? "default" : "secondary"}>{tr(`status${STATUS[p.status] ?? "OPEN"}` as any)}</Badge>
                        </div>
                        <p className="text-sm whitespace-pre-wrap break-words">{p.descricao}</p>
                        <p className="text-xs text-muted-foreground">
                            {tr("createdAt", { data: data(p.criadoEm) })}
                            {p.concluidoEm && <> · {tr("closedAt", { data: data(p.concluidoEm) })}</>}
                        </p>
                        {p.resposta && <p className="text-sm rounded-lg bg-muted/50 p-2 whitespace-pre-wrap break-words"><strong>{tr("answer")}:</strong> {p.resposta}</p>}
                        {p.status === "ABERTO" && (
                            <div className="flex gap-2 pt-1">
                                <Button size="sm" onClick={() => { setAlvo({ pedido: p, status: "CONCLUIDO" }); setResposta(""); }}>{tr("conclude")}</Button>
                                <Button size="sm" variant="outline" onClick={() => { setAlvo({ pedido: p, status: "RECUSADO" }); setResposta(""); }}>{tr("refuse")}</Button>
                            </div>
                        )}
                    </li>
                ))}
            </ul>

            <Dialog open={novoAberto} onOpenChange={(v) => !criando && setNovoAberto(v)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader><DialogTitle>{tr("newRequest")}</DialogTitle></DialogHeader>
                    <div className="space-y-3">
                        <div className="space-y-1">
                            <Label htmlFor="ped-titular" className="text-xs">{tr("holder")}</Label>
                            <Input id="ped-titular" inputMode="tel" value={titular} onChange={(e) => setTitular(e.target.value)} autoFocus />
                            <p className="text-[11px] text-muted-foreground">{tr("holderHint")}</p>
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="ped-nome" className="text-xs">{tr("name")}</Label>
                            <Input id="ped-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="ped-tipo" className="text-xs">{tr("type")}</Label>
                            <select id="ped-tipo" className={SELECT_CLASSE} value={tipo} onChange={(e) => setTipo(e.target.value)}>
                                {TIPOS.map((x) => <option key={x} value={x}>{tr(`type${x}` as any)}</option>)}
                            </select>
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="ped-desc" className="text-xs">{tr("description")}</Label>
                            <Textarea id="ped-desc" rows={4} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setNovoAberto(false)} disabled={criando}>{tr("cancel")}</Button>
                        <Button onClick={criar} disabled={criando || !titular.trim() || !descricao.trim()}>
                            {criando ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> {tr("saving")}</> : tr("create")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={!!alvo} onOpenChange={(v) => { if (!v && !salvando) setAlvo(null); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{alvo?.status === "RECUSADO" ? tr("resolveRefuse") : tr("resolveConclude")}</DialogTitle>
                        <DialogDescription className="font-mono">{alvo?.pedido.titular}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-1">
                        <Label htmlFor="ped-resp" className="text-xs">{tr("answer")}</Label>
                        <Textarea id="ped-resp" rows={4} value={resposta} onChange={(e) => setResposta(e.target.value)} autoFocus />
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setAlvo(null)} disabled={salvando}>{tr("cancel")}</Button>
                        <Button onClick={encerrar} disabled={salvando}>
                            {salvando ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> {tr("saving")}</> : tr("confirm")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

/* ---------------------------------------------------------------- Titular */

type Resumo = {
    sessoes?: { sessionId: string; nome?: string }[];
    contatos?: number; mensagens?: number; midias?: number; auditoria?: number;
    gruposEmQueAparece?: number | unknown[];
};
const num = (v: unknown) => (Array.isArray(v) ? v.length : typeof v === "number" ? v : 0);

function Titular() {
    const t = useTranslations("lgpd.admin");
    const th = useTranslations("lgpd.admin.holder");
    const tc = useTranslations("common");
    const [telefone, setTelefone] = useState("");
    const [buscando, setBuscando] = useState(false);
    const [resumo, setResumo] = useState<Resumo | null>(null);
    const [consultado, setConsultado] = useState(""); // telefone que gerou o resumo
    const [exportando, setExportando] = useState(false);
    const [apagarAberto, setApagarAberto] = useState(false);
    const [confirmacao, setConfirmacao] = useState("");
    const [apagando, setApagando] = useState(false);

    const buscar = async () => {
        const tel = soDigitos(telefone);
        if (!tel) return;
        setBuscando(true);
        try {
            const d = await chamar(`/api/lgpd/titular?telefone=${encodeURIComponent(tel)}`);
            setResumo(d.data ?? {});
            setConsultado(tel);
        } catch (e: any) { toast.error(e?.message || th("searchError")); setResumo(null); }
        finally { setBuscando(false); }
    };

    const exportar = async () => {
        setExportando(true);
        try { await baixarArquivo(`/api/lgpd/titular/exportar?telefone=${encodeURIComponent(consultado)}`, `titular-${consultado}.json`); }
        catch { toast.error(th("exportError")); }
        finally { setExportando(false); }
    };

    const apagar = async () => {
        setApagando(true);
        try {
            const d = await chamar("/api/lgpd/titular/apagar", { method: "POST", body: JSON.stringify({ telefone: consultado, confirmacao }) });
            const r = d.data ?? {};
            toast.success(`${th("erased")} ${th("eraseResult", { mensagens: num(r.mensagens), midias: num(r.midias), contatos: num(r.contatos) })}`);
            setApagarAberto(false); setConfirmacao("");
            void buscar();
        } catch (e: any) { toast.error(e?.message || th("eraseError")); }
        finally { setApagando(false); }
    };

    const linhas: [string, number][] = resumo ? [
        [th("contacts"), num(resumo.contatos)], [th("messages"), num(resumo.mensagens)], [th("media"), num(resumo.midias)],
        [th("audit"), num(resumo.auditoria)], [th("groups"), num(resumo.gruposEmQueAparece)],
    ] : [];
    const vazio = resumo ? linhas.every(([, n]) => n === 0) : false;

    return (
        <div className="space-y-4">
            <form className="flex flex-col sm:flex-row gap-2 sm:items-end" onSubmit={(e) => { e.preventDefault(); void buscar(); }}>
                <div className="flex-1 space-y-1">
                    <Label htmlFor="tit-tel" className="text-xs">{th("phone")}</Label>
                    <Input id="tit-tel" inputMode="tel" value={telefone} onChange={(e) => setTelefone(e.target.value)} />
                    <p className="text-[11px] text-muted-foreground">{th("phoneHint")}</p>
                </div>
                <Button type="submit" disabled={buscando || !soDigitos(telefone)}>
                    {buscando ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> {th("searching")}</> : <><Search className="h-4 w-4 mr-2" /> {th("search")}</>}
                </Button>
            </form>

            {resumo && (
                <div className="rounded-xl border border-border/60 p-4 space-y-3">
                    <h3 className="text-sm font-semibold">{th("summary")} <span className="font-mono text-muted-foreground">({consultado})</span></h3>
                    {vazio ? <p className="text-sm text-muted-foreground">{th("nothing")}</p> : (
                        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            {linhas.map(([rot, n]) => (
                                <div key={rot} className="rounded-lg bg-muted/40 p-3">
                                    <dt className="text-xs text-muted-foreground">{rot}</dt>
                                    <dd className="text-xl font-semibold tabular-nums">{n}</dd>
                                </div>
                            ))}
                        </dl>
                    )}
                    {!!resumo.sessoes?.length && (
                        <p className="text-xs text-muted-foreground">{th("sessions")}: {resumo.sessoes.map((s) => s.nome || s.sessionId).join(", ")}</p>
                    )}
                    <div className="flex flex-wrap gap-2 pt-1">
                        <Button variant="outline" onClick={exportar} disabled={exportando || vazio}>
                            {exportando ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> {th("exporting")}</> : <><Download className="h-4 w-4 mr-2" /> {th("export")}</>}
                        </Button>
                        <Button variant="destructive" onClick={() => setApagarAberto(true)} disabled={vazio}>
                            <Trash2 className="h-4 w-4 mr-2" /> {th("erase")}
                        </Button>
                    </div>
                </div>
            )}

            <Dialog open={apagarAberto} onOpenChange={(v) => { if (!apagando) { setApagarAberto(v); if (!v) setConfirmacao(""); } }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{th("eraseTitle")}</DialogTitle>
                        <DialogDescription>{th("eraseText")}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-1">
                        <Label htmlFor="apagar-conf" className="text-xs">{th("eraseConfirmLabel")}</Label>
                        <Input id="apagar-conf" autoComplete="off" value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} placeholder={th("eraseConfirmWord")} autoFocus />
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setApagarAberto(false)} disabled={apagando}>{tc("cancel")}</Button>
                        <Button variant="destructive" onClick={apagar} disabled={apagando || confirmacao !== th("eraseConfirmWord")}>
                            {apagando ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> {th("erasing")}</> : th("eraseConfirm")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

/* ---------------------------------------------------------------- Retencao */

type Retencao = {
    retencaoMensagensDias: number | null; retencaoMidiasDias: number | null; retencaoLogsDias: number | null;
    ultimaExecucao?: string | null; resultado?: unknown;
};
type Campo = { dias: string; sempre: boolean };

function paraCampo(v: number | null | undefined): Campo { return v == null ? { dias: "", sempre: true } : { dias: String(v), sempre: false }; }
function deCampo(c: Campo): number | null | "invalido" {
    if (c.sempre) return null;
    const n = Number(c.dias);
    return Number.isInteger(n) && n >= 30 ? n : "invalido";
}
function textoResultado(r: unknown): string {
    if (r == null) return "";
    if (typeof r === "string") return r;
    try { return JSON.stringify(r, null, 2); } catch { return String(r); }
}

function CampoRetencao({ id, rotulo, dica, valor, onChange }: { id: string; rotulo: string; dica?: string; valor: Campo; onChange: (c: Campo) => void }) {
    const t = useTranslations("lgpd.admin.retention");
    return (
        <div className="space-y-1.5">
            <Label htmlFor={id} className="text-sm">{rotulo}</Label>
            <div className="flex items-center gap-4 flex-wrap">
                <Input id={id} type="number" min={30} step={1} inputMode="numeric" className="w-32" disabled={valor.sempre}
                    value={valor.dias} onChange={(e) => onChange({ ...valor, dias: e.target.value })} />
                <div className="flex items-center gap-2">
                    <Checkbox id={`${id}-sempre`} checked={valor.sempre} onCheckedChange={(v) => onChange({ dias: valor.dias || "90", sempre: v === true })} />
                    <Label htmlFor={`${id}-sempre`} className="text-sm font-normal cursor-pointer">{t("forever")}</Label>
                </div>
            </div>
            {dica && <p className="text-[11px] text-muted-foreground">{dica}</p>}
        </div>
    );
}

function RetencaoAba() {
    const t = useTranslations("lgpd.admin");
    const tr = useTranslations("lgpd.admin.retention");
    const tc = useTranslations("common");
    const [dados, setDados] = useState<Retencao | null>(null);
    const [erro, setErro] = useState(false);
    const [msg, setMsg] = useState<Campo>({ dias: "", sempre: true });
    const [mid, setMid] = useState<Campo>({ dias: "", sempre: true });
    const [logs, setLogs] = useState<Campo>({ dias: "", sempre: true });
    const [salvando, setSalvando] = useState(false);
    const [executando, setExecutando] = useState(false);
    const [confirmarExec, setConfirmarExec] = useState(false);

    const aplicar = (d: Retencao) => {
        setDados(d);
        setMsg(paraCampo(d.retencaoMensagensDias)); setMid(paraCampo(d.retencaoMidiasDias)); setLogs(paraCampo(d.retencaoLogsDias));
    };
    const carregar = useCallback(async () => {
        setErro(false);
        try { aplicar((await chamar("/api/system/retencao")).data); }
        catch { setErro(true); }
    }, []);
    useEffect(() => { carregar(); }, [carregar]);

    const salvar = async () => {
        const a = deCampo(msg), b = deCampo(mid), c = deCampo(logs);
        if (a === "invalido" || b === "invalido" || c === "invalido") { toast.error(tr("invalid")); return; }
        setSalvando(true);
        try {
            await chamar("/api/system/retencao", { method: "PUT", body: JSON.stringify({ retencaoMensagensDias: a, retencaoMidiasDias: b, retencaoLogsDias: c }) });
            toast.success(tr("saved"));
            carregar();
        } catch (e: any) { toast.error(e?.message || tr("saveError")); }
        finally { setSalvando(false); }
    };

    const executar = async () => {
        setExecutando(true);
        try {
            const d = await chamar("/api/system/retencao/executar", { method: "POST" });
            toast.success(tr("runDone"));
            setConfirmarExec(false);
            setDados((atual) => (atual ? { ...atual, ultimaExecucao: new Date().toISOString(), resultado: d.data ?? d.resultado ?? atual.resultado } : atual));
            carregar();
        } catch (e: any) { toast.error(e?.message || tr("runError")); }
        finally { setExecutando(false); }
    };

    if (erro) return (
        <div className="text-center py-6 space-y-2">
            <p className="text-sm text-destructive" role="alert">{t("loadError")}</p>
            <Button size="sm" variant="outline" onClick={carregar}>{t("retry")}</Button>
        </div>
    );
    if (!dados) return <p className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center" role="status"><Loader2 className="h-4 w-4 animate-spin" /> {t("loading")}</p>;

    return (
        <div className="space-y-6">
            <p className="text-sm text-muted-foreground">{tr("intro")} {tr("min")}</p>
            <div className="space-y-5">
                <CampoRetencao id="ret-msg" rotulo={tr("messages")} valor={msg} onChange={setMsg} />
                <CampoRetencao id="ret-mid" rotulo={tr("media")} valor={mid} onChange={setMid} />
                <CampoRetencao id="ret-log" rotulo={tr("logs")} dica={tr("logsHint")} valor={logs} onChange={setLogs} />
            </div>
            <div className="flex flex-wrap gap-2">
                <Button onClick={salvar} disabled={salvando || executando}>
                    {salvando ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> {tr("saving")}</> : tr("save")}
                </Button>
                <Button variant="outline" onClick={() => setConfirmarExec(true)} disabled={salvando || executando}>
                    <Play className="h-4 w-4 mr-2" /> {tr("runNow")}
                </Button>
            </div>

            <div className="rounded-xl border border-border/60 p-4 space-y-2">
                <p className="text-sm"><strong>{tr("lastRun")}:</strong> {dados.ultimaExecucao ? data(dados.ultimaExecucao) : tr("never")}</p>
                {dados.resultado != null && (
                    <>
                        <p className="text-xs text-muted-foreground">{tr("result")}</p>
                        <pre className="text-xs bg-muted/40 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-words">{textoResultado(dados.resultado)}</pre>
                    </>
                )}
            </div>

            <Dialog open={confirmarExec} onOpenChange={(v) => !executando && setConfirmarExec(v)}>
                <DialogContent className="sm:max-w-sm">
                    <DialogHeader>
                        <DialogTitle>{tr("runNow")}</DialogTitle>
                        <DialogDescription>{tr("runConfirm")}</DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setConfirmarExec(false)} disabled={executando}>{tc("cancel")}</Button>
                        <Button variant="destructive" onClick={executar} disabled={executando}>
                            {executando ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> {tr("running")}</> : tr("runNow")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

/* ---------------------------------------------------------------- Pagina */

export default function PrivacidadePage() {
    const t = useTranslations("lgpd.admin");
    const { data: sessao, status } = useSession();
    const admin = (sessao?.user as any)?.role === "SUPERADMIN";

    if (status === "loading") return <p className="p-6 text-sm text-muted-foreground flex items-center gap-2" role="status"><Loader2 className="h-4 w-4 animate-spin" /> {t("loading")}</p>;
    if (!admin) return <p className="p-6 text-sm text-muted-foreground" role="alert">{t("onlyAdmin")}</p>;

    return (
        <div className="max-w-4xl mx-auto space-y-6 p-4 md:p-6">
            <header>
                <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                    <ShieldUser className="h-6 w-6 text-primary" aria-hidden="true" /> {t("title")}
                </h1>
                <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
            </header>

            <Tabs defaultValue="pedidos">
                <TabsList className="flex-wrap h-auto">
                    <TabsTrigger value="pedidos">{t("tabRequests")}</TabsTrigger>
                    <TabsTrigger value="titular">{t("tabSearch")}</TabsTrigger>
                    <TabsTrigger value="retencao">{t("tabRetention")}</TabsTrigger>
                </TabsList>
                <Card className="mt-3">
                    <CardContent className="pt-6">
                        <TabsContent value="pedidos"><Pedidos /></TabsContent>
                        <TabsContent value="titular"><Titular /></TabsContent>
                        <TabsContent value="retencao"><RetencaoAba /></TabsContent>
                    </CardContent>
                </Card>
            </Tabs>
        </div>
    );
}
