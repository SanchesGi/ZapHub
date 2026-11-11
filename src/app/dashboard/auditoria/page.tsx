"use client";

// minha versao: Auditoria — mensagens apagadas: o que era, de quem, em qual conversa, QUEM apagou e por onde.
import { useCallback, useEffect, useState } from "react";
import { useSession as useAuthSession } from "next-auth/react";
import { ShieldCheck, Search, Loader2, Trash2, Monitor, Smartphone, User, Image as ImageIcon, FileText, Music, Video, RefreshCw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSession } from "@/components/dashboard/session-provider";
import { cn } from "@/lib/utils";

type Registro = {
    id: string;
    sessionId: string;
    sessaoNome: string;
    sessaoDono?: string | null;
    usuarioId?: string | null;
    origem: "PAINEL" | "CONTATO" | "CELULAR";
    modo: "TODOS" | "PARA_MIM" | null;
    usuarioNome: string | null;
    chatJid: string;
    chatNome: string | null;
    autorJid: string | null;
    autorNome: string | null;
    fromMe: boolean;
    tipo: string | null;
    conteudo: string | null;
    mediaUrl: string | null;
    enviadaEm: string | null;
    criadoEm: string;
};

const ORIGEM: Record<Registro["origem"], { rotulo: string; icone: any; cor: string }> = {
    PAINEL: { rotulo: "Pelo painel", icone: Monitor, cor: "bg-primary/15 text-foreground border-primary/30" },
    CONTATO: { rotulo: "O contato apagou", icone: User, cor: "bg-muted text-foreground border-border" },
    CELULAR: { rotulo: "Pelo celular", icone: Smartphone, cor: "bg-chart-5/15 text-foreground border-chart-5/30" },
};

const TIPO_ICONE: Record<string, any> = { IMAGE: ImageIcon, VIDEO: Video, AUDIO: Music, DOCUMENT: FileText, STICKER: ImageIcon };
const TIPO_NOME: Record<string, string> = { IMAGE: "Foto", VIDEO: "Vídeo", AUDIO: "Áudio", DOCUMENT: "Documento", STICKER: "Figurinha", LOCATION: "Localização", CONTACT: "Contato" };

function telefone(jid?: string | null) {
    if (!jid || !jid.endsWith("@s.whatsapp.net")) return null;
    const d = jid.split("@")[0];
    if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
        const r = d.slice(4);
        return `+55 (${d.slice(2, 4)}) ${r.slice(0, r.length - 4)}-${r.slice(-4)}`;
    }
    return "+" + d;
}

const dataHora = (s?: string | null) => (s ? new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");

export default function AuditoriaPage() {
    const { data: auth } = useAuthSession();
    const { sessions } = useSession();
    const [itens, setItens] = useState<Registro[]>([]);
    const [carregando, setCarregando] = useState(true);
    const [busca, setBusca] = useState("");
    const [sessao, setSessao] = useState("todas");
    const [origem, setOrigem] = useState("todas");
    // minha versao: filtro por pessoa (Supervisor: ele e a equipe dele)
    const [pessoa, setPessoa] = useState("todas");
    const [pessoas, setPessoas] = useState<{ id: string; name: string | null; email: string }[]>([]);
    const [pagina, setPagina] = useState(1);
    const [meta, setMeta] = useState({ total: 0, paginas: 1 });
    const [erro, setErro] = useState<string | null>(null);

    const carregar = useCallback(async () => {
        setCarregando(true);
        setErro(null);
        try {
            const p = new URLSearchParams({ pagina: String(pagina), limite: "25", busca });
            if (sessao !== "todas") p.set("sessionId", sessao);
            if (origem !== "todas") p.set("origem", origem);
            if (pessoa !== "todas") p.set("usuarioId", pessoa);
            const r = await fetch(`/api/auditoria?${p}`);
            const d = await r.json();
            if (!r.ok) throw new Error(d?.message || "Falha ao carregar");
            setItens(d.data || []);
            if (Array.isArray(d.pessoas)) setPessoas(d.pessoas);
            setMeta({ total: d.meta?.total || 0, paginas: d.meta?.paginas || 1 });
        } catch (e: any) {
            setErro(e?.message || "Falha ao carregar");
            setItens([]);
        } finally {
            setCarregando(false);
        }
    }, [pagina, busca, sessao, origem, pessoa]);

    useEffect(() => { const t = setTimeout(carregar, 300); return () => clearTimeout(t); }, [carregar]);
    useEffect(() => { setPagina(1); }, [busca, sessao, origem, pessoa]);

    // @ts-ignore
    // @ts-ignore
    if (auth && auth.user?.role !== "SUPERADMIN" && auth.user?.role !== "STAFF") {
        return <div className="p-8 text-center text-muted-foreground">A auditoria é restrita a Supervisores e Super Administradores.</div>;
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2"><ShieldCheck className="h-7 w-7 text-primary" /> Auditoria</h2>
                    <p className="text-muted-foreground">Mensagens apagadas: o conteúdo original, de quem era, em qual conversa e quem apagou.{auth?.user && (auth.user as any).role === "STAFF" ? " Você vê tudo da sua equipe: o que cada um apagou e o que foi apagado nas sessões de vocês." : ""}</p>
                </div>
                <Button variant="outline" className="gap-1.5" onClick={carregar}><RefreshCw className="h-4 w-4" /> Atualizar</Button>
            </div>

            <Card>
                <CardHeader>
                    <div className="flex flex-col lg:flex-row justify-between gap-4">
                        <div className="space-y-1">
                            <CardTitle>Mensagens apagadas</CardTitle>
                            <CardDescription>{meta.total} registro{meta.total === 1 ? "" : "s"}</CardDescription>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-2">
                            <Select value={sessao} onValueChange={setSessao}>
                                <SelectTrigger className="w-full sm:w-[180px]"><SelectValue placeholder="Sessão" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="todas">Todas as sessões</SelectItem>
                                    {sessions.map((s) => <SelectItem key={s.sessionId} value={s.sessionId}>{s.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                            <Select value={pessoa} onValueChange={setPessoa}>
                                <SelectTrigger className="w-full sm:w-[180px]"><SelectValue placeholder="Pessoa" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="todas">Todas as pessoas</SelectItem>
                                    {pessoas.map((u) => <SelectItem key={u.id} value={u.id}>{u.name || u.email}</SelectItem>)}
                                </SelectContent>
                            </Select>
                            <Select value={origem} onValueChange={setOrigem}>
                                <SelectTrigger className="w-full sm:w-[170px]"><SelectValue placeholder="Quem apagou" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="todas">Qualquer origem</SelectItem>
                                    <SelectItem value="PAINEL">Pelo painel</SelectItem>
                                    <SelectItem value="CONTATO">O contato apagou</SelectItem>
                                    <SelectItem value="CELULAR">Pelo celular</SelectItem>
                                </SelectContent>
                            </Select>
                            <div className="relative sm:w-64">
                                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input className="pl-8" placeholder="Buscar texto, contato, usuário..." value={busca} onChange={(e) => setBusca(e.target.value)} />
                            </div>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="space-y-3">
                    {carregando ? (
                        <div className="py-16 flex justify-center gap-2 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /> Carregando...</div>
                    ) : erro ? (
                        <div className="py-16 text-center text-destructive">{erro}</div>
                    ) : itens.length === 0 ? (
                        <div className="py-16 text-center text-muted-foreground space-y-2">
                            <Trash2 className="h-8 w-8 mx-auto opacity-40" />
                            <p>Nenhuma mensagem apagada registrada{busca ? " para essa busca" : ""}.</p>
                            <p className="text-xs">O registro começa a partir desta atualização.</p>
                        </div>
                    ) : itens.map((r) => {
                        const o = ORIGEM[r.origem] || ORIGEM.PAINEL;
                        const Icone = o.icone;
                        const TipoIcone = r.tipo ? TIPO_ICONE[r.tipo] : null;
                        const grupo = r.chatJid.endsWith("@g.us");
                        return (
                            <div key={r.id} className="rounded-xl border border-border/60 p-4 hover:bg-muted/30 transition-colors">
                                <div className="flex flex-wrap items-center gap-2 mb-2.5">
                                    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold", o.cor)}>
                                        <Icone className="h-3.5 w-3.5" /> {o.rotulo}
                                    </span>
                                    {r.modo === "PARA_MIM" && <Badge variant="outline" className="text-[10px]">só para este número</Badge>}
                                    {r.modo === "TODOS" && <Badge variant="outline" className="text-[10px]">para todos</Badge>}
                                    <Badge variant="secondary" className="text-[10px]" title={r.sessaoDono ? `Sessão de ${r.sessaoDono}` : undefined}>{r.sessaoNome}{r.sessaoDono ? ` · ${r.sessaoDono}` : ""}</Badge>
                                    <span className="ml-auto text-xs text-muted-foreground">apagada em {dataHora(r.criadoEm)}</span>
                                </div>

                                <div className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-3 mb-3">
                                    <div>
                                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Quem apagou</p>
                                        <p className="font-semibold">{r.usuarioNome || "—"}</p>
                                    </div>
                                    <div>
                                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{grupo ? "Grupo" : "Conversa"}</p>
                                        <p className="font-medium truncate">{r.chatNome || telefone(r.chatJid) || r.chatJid}</p>
                                        {!grupo && telefone(r.chatJid) && r.chatNome !== telefone(r.chatJid) && <p className="text-xs text-muted-foreground">{telefone(r.chatJid)}</p>}
                                    </div>
                                    <div>
                                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Quem escreveu</p>
                                        <p className="font-medium truncate">{r.autorNome || "—"}</p>
                                        {r.autorJid && telefone(r.autorJid) && r.autorNome !== telefone(r.autorJid) && <p className="text-xs text-muted-foreground">{telefone(r.autorJid)}</p>}
                                    </div>
                                </div>

                                <div className={cn("rounded-lg px-3 py-2.5 text-sm border-l-4", r.fromMe ? "border-primary bg-primary/5" : "border-muted-foreground/40 bg-muted/50")}>
                                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground mb-1">
                                        {TipoIcone && <TipoIcone className="h-3.5 w-3.5" />}
                                        {r.tipo && r.tipo !== "TEXT" && <span>{TIPO_NOME[r.tipo] || r.tipo}</span>}
                                        <span>enviada em {dataHora(r.enviadaEm)}</span>
                                    </div>
                                    {r.mediaUrl && r.tipo === "IMAGE" && (
                                        <a href={r.mediaUrl} target="_blank" rel="noreferrer"><img src={r.mediaUrl} alt="" className="max-h-48 rounded-md mb-1.5" /></a>
                                    )}
                                    {r.mediaUrl && r.tipo === "AUDIO" && <audio src={r.mediaUrl} controls className="h-8 mb-1.5" preload="none" />}
                                    {r.mediaUrl && !["IMAGE", "AUDIO"].includes(r.tipo || "") && (
                                        <a href={r.mediaUrl} target="_blank" rel="noreferrer" className="text-primary underline text-xs">abrir o arquivo original</a>
                                    )}
                                    <p className="whitespace-pre-wrap break-words">{r.conteudo || (r.mediaUrl ? "" : <span className="italic text-muted-foreground">(sem texto)</span>)}</p>
                                </div>
                            </div>
                        );
                    })}

                    {meta.paginas > 1 && (
                        <div className="flex items-center justify-center gap-3 pt-2">
                            <Button variant="ghost" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>Anterior</Button>
                            <span className="text-sm text-muted-foreground">Página {pagina} de {meta.paginas}</span>
                            <Button variant="ghost" disabled={pagina >= meta.paginas} onClick={() => setPagina((p) => p + 1)}>Próxima</Button>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
