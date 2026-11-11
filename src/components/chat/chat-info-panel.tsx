"use client";

// minha versao: painel lateral de informações — contato (foto, telefone, recado, perfil comercial,
// salvar nome, bloquear) e grupo (descrição, criador, regras e TODOS os membros com nome resolvido).
import { useEffect, useMemo, useRef, useState } from "react";
import { X, Copy, Search, Ban, CheckCircle2, Save, MessageCircle, Calendar, Users, Building2, Globe, Mail, Shield, Crown, Loader2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export interface Participante {
    id: string;
    admin: string | null;
    name: string | null;
    phone: string | null;
}

// "5546999998888" -> "+55 (46) 99999-8888"
export function formatarTelefone(d?: string | null): string | null {
    if (!d) return null;
    const n = d.replace(/\D/g, "");
    if (n.startsWith("55") && (n.length === 12 || n.length === 13)) {
        const ddd = n.slice(2, 4), r = n.slice(4);
        return `+55 (${ddd}) ${r.length === 9 ? `${r.slice(0, 5)}-${r.slice(5)}` : `${r.slice(0, 4)}-${r.slice(4)}`}`;
    }
    return `+${n}`;
}

const iniciais = (s?: string | null) => (s || "?").replace(/[^\p{L}\p{N}]/gu, "").slice(0, 2).toUpperCase() || "?";

async function copiar(texto: string, rotulo = "Copiado") {
    try { await navigator.clipboard.writeText(texto); toast.success(rotulo); }
    catch { toast.error("Não consegui copiar — selecione o texto manualmente"); }
}

// foto buscada sob demanda (só quando a linha aparece na tela) + cache
const fotoCache = new Map<string, string | null>();
function MemberRow({ sessionId, p, onClick }: { sessionId: string; p: Participante; onClick: () => void }) {
    const ref = useRef<HTMLButtonElement>(null);
    const [foto, setFoto] = useState<string | null>(fotoCache.get(p.id) || null);
    useEffect(() => {
        if (foto || fotoCache.has(p.id)) return;
        const el = ref.current;
        if (!el) return;
        let active = true;
        const obs = new IntersectionObserver(([e]) => {
            if (!e.isIntersecting) return;
            obs.disconnect();
            fetch(`/api/chat/${sessionId}/${encodeURIComponent(p.id)}/profile-picture`, { method: "POST" })
                .then((r) => r.json())
                .then((d) => { fotoCache.set(p.id, d?.profilePicUrl || null); if (active && d?.profilePicUrl) setFoto(d.profilePicUrl); })
                .catch(() => fotoCache.set(p.id, null));
        }, { rootMargin: "80px" });
        obs.observe(el);
        return () => { active = false; obs.disconnect(); };
    }, [p.id, sessionId, foto]);

    const tel = formatarTelefone(p.phone);
    const titulo = p.name || tel || "Membro (número oculto)";
    return (
        <button ref={ref} type="button" onClick={onClick}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/60 transition-colors text-left cursor-pointer">
            <Avatar className="h-9 w-9 shrink-0">
                {foto && <AvatarImage src={foto} alt={titulo} />}
                <AvatarFallback className="text-[10px] font-semibold bg-primary/15 text-foreground">{iniciais(p.name || p.phone)}</AvatarFallback>
            </Avatar>
            <span className="flex-1 min-w-0">
                <span className="block text-sm truncate text-foreground">{titulo}</span>
                {p.name && tel && <span className="block text-[11px] text-muted-foreground truncate">{tel}</span>}
            </span>
            {p.admin === "superadmin" && <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-foreground bg-primary/15 px-1.5 py-0.5 rounded"><Crown className="h-3 w-3" />Criador</span>}
            {p.admin === "admin" && <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-foreground bg-primary/10 px-1.5 py-0.5 rounded"><Shield className="h-3 w-3" />Admin</span>}
        </button>
    );
}

function Linha({ icon: Icon, rotulo, children }: { icon: typeof Users; rotulo: string; children: React.ReactNode }) {
    return (
        <div className="flex gap-3 px-4 py-2.5">
            <Icon className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{rotulo}</p>
                <div className="text-sm text-foreground break-words">{children}</div>
            </div>
        </div>
    );
}

// ─── CONTATO ───────────────────────
function ContatoInfo({ sessionId, jid, onOpenChat }: { sessionId: string; jid: string; onOpenChat?: (jid: string, name?: string) => void }) {
    const [d, setD] = useState<any>(null);
    const [erro, setErro] = useState<string | null>(null);
    const [nome, setNome] = useState("");
    const [salvando, setSalvando] = useState(false);
    const [bloqueando, setBloqueando] = useState(false);

    useEffect(() => {
        let active = true;
        setD(null); setErro(null);
        fetch(`/api/contacts/${sessionId}/${encodeURIComponent(jid)}`)
            .then((r) => r.json())
            .then((j) => { if (!active) return; if (j?.status === false) setErro(j.message || "Falha ao carregar"); else { setD(j.data); setNome(j.data?.name || ""); } })
            .catch(() => active && setErro("Falha ao carregar"));
        return () => { active = false; };
    }, [sessionId, jid]);

    const salvar = async () => {
        if (!nome.trim()) return;
        setSalvando(true);
        try {
            const r = await fetch(`/api/contacts/${sessionId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jid, name: nome.trim() }) });
            const j = await r.json();
            if (!r.ok || j?.status === false) throw new Error(j?.message || "Falha ao salvar");
            setD((x: any) => ({ ...x, name: nome.trim(), saved: true }));
            toast.success("Contato salvo");
        } catch (e: any) { toast.error(e.message); } finally { setSalvando(false); }
    };

    const bloquear = async (acao: "block" | "unblock") => {
        setBloqueando(true);
        try {
            const r = await fetch(`/api/contacts/${sessionId}/${encodeURIComponent(jid)}/${acao}`, { method: "POST" });
            const j = await r.json().catch(() => ({}));
            if (!r.ok || j?.status === false) throw new Error(j?.message || "Falha");
            toast.success(acao === "block" ? "Contato bloqueado" : "Contato desbloqueado");
        } catch (e: any) { toast.error(e.message); } finally { setBloqueando(false); }
    };

    if (erro) return <p className="p-6 text-sm text-destructive">{erro}</p>;
    if (!d) return <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>;

    const tel = formatarTelefone(d.phone);
    const titulo = d.name || d.notify || d.verifiedName || tel || "Contato";
    return (
        <div className="pb-6">
            <div className="flex flex-col items-center gap-2 px-4 pt-6 pb-4 border-b border-border/40">
                <Avatar className="h-28 w-28">
                    {d.pictureUrl && <AvatarImage src={d.pictureUrl} alt={titulo} />}
                    <AvatarFallback className="text-2xl font-semibold bg-primary/15 text-primary">{iniciais(titulo)}</AvatarFallback>
                </Avatar>
                <h2 className="text-lg font-semibold text-foreground text-center">{titulo}</h2>
                {tel && <p className="text-sm text-muted-foreground">{tel}</p>}
                {!tel && d.isLid && <p className="text-xs text-muted-foreground text-center">Número oculto pelo WhatsApp (privacidade)</p>}
                <div className="flex gap-2 mt-1">
                    {d.phone && <Button size="sm" variant="secondary" className="h-8 gap-1.5" onClick={() => copiar(d.phone, "Número copiado")}><Copy className="h-3.5 w-3.5" />Copiar número</Button>}
                    {d.isLid && d.phone && onOpenChat && <Button size="sm" variant="secondary" className="h-8 gap-1.5" onClick={() => onOpenChat(`${d.phone}@s.whatsapp.net`, titulo)}><MessageCircle className="h-3.5 w-3.5" />Abrir pelo número</Button>}
                </div>
            </div>

            {d.about && (
                <Linha icon={MessageCircle} rotulo="Recado">
                    {d.about}
                    {d.aboutAt && <span className="block text-[11px] text-muted-foreground mt-0.5">desde {new Date(d.aboutAt).toLocaleDateString("pt-BR")}</span>}
                </Linha>
            )}
            {d.notify && d.notify !== titulo && <Linha icon={Users} rotulo="Nome no WhatsApp">{d.notify}</Linha>}
            {d.business && (
                <>
                    {d.business.category && <Linha icon={Building2} rotulo="Conta comercial">{d.business.category}</Linha>}
                    {d.business.description && <Linha icon={Building2} rotulo="Sobre a empresa"><span className="whitespace-pre-wrap">{d.business.description}</span></Linha>}
                    {d.business.email && <Linha icon={Mail} rotulo="E-mail">{d.business.email}</Linha>}
                    {Array.isArray(d.business.website) ? d.business.website.filter(Boolean).map((w: string) => <Linha key={w} icon={Globe} rotulo="Site">{w}</Linha>)
                        : d.business.website && <Linha icon={Globe} rotulo="Site">{d.business.website}</Linha>}
                </>
            )}
            <Linha icon={Calendar} rotulo="Nesta conversa">{d.messageCount} mensagem(ns) registradas</Linha>

            <div className="px-4 pt-3 space-y-2">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{d.saved ? "Renomear contato" : "Salvar contato"}</p>
                <div className="flex gap-2">
                    <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do contato" className="h-9 text-sm"
                        onKeyDown={(e) => e.key === "Enter" && salvar()} />
                    <Button size="sm" className="h-9 gap-1.5" disabled={!nome.trim() || salvando} onClick={salvar}>
                        {salvando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Salvar
                    </Button>
                </div>
            </div>

            <div className="px-4 pt-4 flex gap-2">
                <Button size="sm" variant="outline" className="h-8 gap-1.5 text-destructive hover:text-destructive flex-1" disabled={bloqueando} onClick={() => bloquear("block")}><Ban className="h-3.5 w-3.5" />Bloquear</Button>
                <Button size="sm" variant="outline" className="h-8 gap-1.5 flex-1" disabled={bloqueando} onClick={() => bloquear("unblock")}><CheckCircle2 className="h-3.5 w-3.5" />Desbloquear</Button>
            </div>

            <button type="button" onClick={() => copiar(jid, "ID copiado")} className="block mx-auto mt-5 text-[10px] text-muted-foreground/70 hover:text-muted-foreground font-mono truncate max-w-[90%] cursor-pointer" title="Copiar ID técnico">{jid}</button>
        </div>
    );
}

// ─── GRUPO ─────────────────────────
function GrupoInfo({ sessionId, jid, onOpenChat }: { sessionId: string; jid: string; onOpenChat?: (jid: string, name?: string) => void }) {
    const [g, setG] = useState<any>(null);
    const [erro, setErro] = useState<string | null>(null);
    const [busca, setBusca] = useState("");

    useEffect(() => {
        let active = true;
        setG(null); setErro(null);
        fetch(`/api/groups/${sessionId}/${encodeURIComponent(jid)}`)
            .then((r) => r.json())
            .then((j) => { if (!active) return; if (j?.status === false) setErro(j.message || "Falha ao carregar o grupo"); else setG(j); })
            .catch(() => active && setErro("Falha ao carregar o grupo"));
        return () => { active = false; };
    }, [sessionId, jid]);

    const membros: Participante[] = useMemo(() => {
        const lista: Participante[] = Array.isArray(g?.participantsInfo) ? g.participantsInfo : [];
        const peso = (p: Participante) => (p.admin === "superadmin" ? 0 : p.admin === "admin" ? 1 : p.name ? 2 : p.phone ? 3 : 4);
        return [...lista].sort((a, b) => peso(a) - peso(b) || (a.name || a.phone || "").localeCompare(b.name || b.phone || "", "pt-BR"));
    }, [g]);

    const filtrados = useMemo(() => {
        const q = busca.trim().toLowerCase();
        if (!q) return membros;
        const qd = q.replace(/\D/g, "");
        return membros.filter((p) => (p.name || "").toLowerCase().includes(q) || (qd && (p.phone || "").includes(qd)));
    }, [membros, busca]);

    if (erro) return <p className="p-6 text-sm text-destructive">{erro}</p>;
    if (!g) return <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>;

    const admins = membros.filter((p) => p.admin).length;
    const dono = membros.find((p) => p.id === g.owner || (g.owner && p.phone && g.owner.startsWith(p.phone)));
    const donoNome = dono?.name || formatarTelefone(dono?.phone) || (g.owner && g.owner.endsWith("@s.whatsapp.net") ? formatarTelefone(g.owner.split("@")[0]) : null);
    const total = g.size || membros.length;

    return (
        <div className="pb-6">
            <div className="flex flex-col items-center gap-2 px-4 pt-6 pb-4 border-b border-border/40">
                <Avatar className="h-28 w-28">
                    {g.pictureUrl && <AvatarImage src={g.pictureUrl} alt={g.subject} />}
                    <AvatarFallback className="text-2xl font-semibold bg-primary/15 text-primary">{iniciais(g.subject)}</AvatarFallback>
                </Avatar>
                <h2 className="text-lg font-semibold text-foreground text-center">{g.subject || "Grupo"}</h2>
                <p className="text-sm text-muted-foreground">Grupo · {total} membro(s) · {admins} admin(s)</p>
            </div>

            {g.desc && <Linha icon={MessageCircle} rotulo="Descrição"><span className="whitespace-pre-wrap">{g.desc}</span></Linha>}
            {(g.creation || donoNome) && (
                <Linha icon={Calendar} rotulo="Criado">
                    {g.creation ? new Date(g.creation * 1000).toLocaleDateString("pt-BR") : "—"}
                    {donoNome && <span className="text-muted-foreground"> por {donoNome}</span>}
                </Linha>
            )}
            <Linha icon={Shield} rotulo="Regras">
                <span className="flex flex-wrap gap-1.5 mt-0.5">
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted">{g.announce ? "Só admins enviam mensagens" : "Todos podem enviar"}</span>
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted">{g.restrict ? "Só admins editam os dados" : "Todos editam os dados"}</span>
                    {g.ephemeralDuration ? <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted">Mensagens temporárias</span> : null}
                </span>
            </Linha>

            <div className="px-4 pt-3 pb-2 flex items-center justify-between">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Membros ({membros.length})</p>
            </div>
            <div className="px-3 pb-2">
                <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar membro por nome ou número" className="h-8 pl-8 text-sm" />
                </div>
            </div>
            <div className="px-1">
                {filtrados.map((p) => (
                    <MemberRow key={p.id} sessionId={sessionId} p={p}
                        onClick={() => onOpenChat?.(p.phone ? `${p.phone}@s.whatsapp.net` : p.id, p.name || formatarTelefone(p.phone) || undefined)} />
                ))}
                {filtrados.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground text-center">Nenhum membro encontrado</p>}
            </div>
            <p className="px-4 pt-3 text-[11px] text-muted-foreground">Clique num membro para abrir uma conversa privada com ele.</p>
        </div>
    );
}

export function ChatInfoPanel({ sessionId, jid, onClose, onOpenChat }: {
    sessionId: string; jid: string; onClose: () => void; onOpenChat?: (jid: string, name?: string) => void;
}) {
    const isGroup = jid.endsWith("@g.us");
    useEffect(() => {
        const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [onClose]);

    return (
        <aside className="absolute inset-y-0 right-0 z-40 w-full sm:w-[360px] bg-card border-l border-border/60 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
            <div className="shrink-0 h-[57px] px-3 flex items-center gap-2 border-b border-border/40">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} title="Fechar (Esc)"><X className="h-4 w-4" /></Button>
                <h3 className="text-sm font-semibold text-foreground">{isGroup ? "Dados do grupo" : "Dados do contato"}</h3>
            </div>
            <div className={cn("flex-1 overflow-y-auto styled-scrollbar")}>
                {isGroup
                    ? <GrupoInfo sessionId={sessionId} jid={jid} onOpenChat={onOpenChat} />
                    : <ContatoInfo sessionId={sessionId} jid={jid} onOpenChat={onOpenChat} />}
            </div>
        </aside>
    );
}
