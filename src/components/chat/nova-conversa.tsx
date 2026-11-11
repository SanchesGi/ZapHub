"use client";

// minha versao: "Nova conversa" com duas abas
//  - Agenda: busca os contatos salvos desta sessao, abre a conversa ou manda uma mensagem rapida;
//  - Numero novo: qualquer numero (mesmo fora da agenda), confere no WhatsApp, opcionalmente salva
//    (no painel e na agenda do WhatsApp/celular) e ja pode mandar a primeira mensagem.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BookUser, Loader2, MessageCircle, Search, Send, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { CorretorTexto } from "@/components/ui/corretor-texto";
import { cn } from "@/lib/utils";
import { sendChatMessage } from "@/app/dashboard/chat/actions";
import { exigirSucesso } from "@/lib/resultado-acao";
import { lerAlertas, tocarEnviada } from "@/lib/sons";
import { urlDoJid } from "@/lib/jid-url";
import { formatarTelefone } from "./chat-info-panel";

type ContatoAgenda = { id: string; jid: string; name?: string | null; notify?: string | null; verifiedName?: string | null };

export type NovaConversaProps = {
    sessionId: string;
    open: boolean;
    onOpenChange: (v: boolean) => void;
    /** abre a conversa na tela atual; sem isso, navega para /dashboard/chat/<numero> */
    onAbrir?: (jid: string, name?: string) => void;
    modo?: "agenda" | "numero";
    inicial?: { numero?: string; nome?: string };
    /** avisa quem chamou que um contato foi salvo (ex.: recarregar a tabela) */
    onSalvo?: (jid: string, nome: string) => void;
};

// "46 99999-8888" -> "5546999998888"; "+1 555..." mantem o pais. Retorna null se faltar o DDD.
export function normalizarNumero(entrada: string): string | null {
    const internacional = entrada.trim().startsWith("+");
    let d = entrada.replace(/\D/g, "");
    if (!d) return null;
    if (internacional) return d.length >= 8 ? d : null;
    d = d.replace(/^0+/, "");
    if (d.length === 10 || d.length === 11) return "55" + d; // DDD + numero
    if (d.length === 12 || d.length === 13) return d;        // ja tem o 55
    if (d.length < 10) return null;                          // sem DDD
    return d;
}

async function conferirNumero(sessionId: string, numero: string): Promise<string> {
    const res = await fetch(`/api/chat/${sessionId}/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numbers: [numero] }),
    });
    const data = await res.json().catch(() => ({}));
    const r = data?.data?.results?.[0];
    if (!res.ok || !r) throw new Error(data?.message || "Não consegui verificar o número (a sessão está conectada?)");
    if (!r.exists || !r.jid) throw new Error(`O número ${formatarTelefone(numero) || numero} não tem WhatsApp`);
    return r.jid as string; // JID real (resolve o 9º dígito)
}

export async function salvarContato(sessionId: string, jid: string, nome: string, celular: boolean) {
    const res = await fetch(`/api/contacts/${sessionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jid, name: nome, celular }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || d?.status === false) throw new Error(d?.message || "Falha ao salvar o contato");
    return d as { celular?: { ok: boolean; erro?: string } | null };
}

function avisoSalvo(nome: string, r: { celular?: { ok: boolean; erro?: string } | null }) {
    if (r.celular?.ok) toast.success(`"${nome}" salvo na agenda (painel e WhatsApp do celular)`);
    else if (r.celular && !r.celular.ok) toast.warning(`"${nome}" salvo no painel; no celular falhou: ${r.celular.erro}`);
    else toast.success(`"${nome}" salvo na agenda do painel`);
}

// foto so quando a linha aparece na tela (cache por sessao+jid)
const fotoCache = new Map<string, string | null>();
function FotoLinha({ sessionId, jid, nome }: { sessionId: string; jid: string; nome: string }) {
    const ref = useRef<HTMLSpanElement>(null);
    const k = `${sessionId}|${jid}`;
    const [foto, setFoto] = useState<string | null>(fotoCache.get(k) ?? null);
    useEffect(() => {
        if (fotoCache.has(k) || !ref.current) return;
        const el = ref.current;
        const io = new IntersectionObserver((ents) => {
            if (!ents.some((e) => e.isIntersecting)) return;
            io.disconnect();
            fetch(`/api/chat/${sessionId}/${encodeURIComponent(jid)}/profile-picture`, { method: "POST" })
                .then((r) => r.json()).then((d) => { const u = d?.profilePicUrl || null; fotoCache.set(k, u); setFoto(u); })
                .catch(() => fotoCache.set(k, null));
        });
        io.observe(el);
        return () => io.disconnect();
    }, [k, sessionId, jid]);
    return (
        <span ref={ref} className="shrink-0">
            <Avatar className="h-9 w-9">
                {foto && <AvatarImage src={foto} alt={nome} />}
                <AvatarFallback className="text-[11px] font-semibold bg-gradient-to-br from-primary/25 to-primary/10 text-primary">
                    {(nome.replace(/[^\p{L}\p{N} ]/gu, "").trim().split(/\s+/).map((s) => s[0]).join("").slice(0, 2) || "?").toUpperCase()}
                </AvatarFallback>
            </Avatar>
        </span>
    );
}

export function NovaConversaDialog({ sessionId, open, onOpenChange, onAbrir, modo = "agenda", inicial, onSalvo }: NovaConversaProps) {
    const router = useRouter();
    const [aba, setAba] = useState<"agenda" | "numero">(modo);

    // ---- agenda ----
    const [busca, setBusca] = useState("");
    const [todos, setTodos] = useState(false);
    const [lista, setLista] = useState<ContatoAgenda[]>([]);
    const [total, setTotal] = useState(0);
    const [carregando, setCarregando] = useState(false);
    const [rapida, setRapida] = useState<string | null>(null); // jid com a caixa de mensagem rapida aberta
    const [textoRapido, setTextoRapido] = useState("");
    const [enviandoRapido, setEnviandoRapido] = useState(false);

    // ---- numero novo ----
    const [nome, setNome] = useState("");
    const [numero, setNumero] = useState("");
    const [mensagem, setMensagem] = useState("");
    const [salvar, setSalvar] = useState(true);
    const [noCelular, setNoCelular] = useState(true);
    const [ocupado, setOcupado] = useState(false);

    useEffect(() => {
        if (!open) return;
        setAba(modo);
        setNome(inicial?.nome || "");
        setNumero(inicial?.numero || "");
        setMensagem("");
        setRapida(null);
        setTextoRapido("");
    }, [open, modo, inicial?.nome, inicial?.numero]);

    const abrir = useCallback((jid: string, n?: string) => {
        onOpenChange(false);
        if (onAbrir) onAbrir(jid, n);
        else router.push(`/dashboard/chat/${urlDoJid(jid)}`);
    }, [onAbrir, onOpenChange, router]);

    // busca na agenda (com espera de 300 ms enquanto digita)
    useEffect(() => {
        if (!open || aba !== "agenda" || !sessionId) return;
        let ativo = true;
        const t = setTimeout(async () => {
            setCarregando(true);
            try {
                const p = new URLSearchParams({ agenda: todos ? "todos" : "1", limit: "60", page: "1", search: busca.trim() });
                const r = await fetch(`/api/contacts/${sessionId}?${p}`);
                const d = await r.json();
                if (!ativo) return;
                setLista(Array.isArray(d?.data) ? d.data : []);
                setTotal(d?.meta?.total || 0);
            } catch { if (ativo) setLista([]); }
            finally { if (ativo) setCarregando(false); }
        }, 300);
        return () => { ativo = false; clearTimeout(t); };
    }, [open, aba, sessionId, busca, todos]);

    const nomeDe = (c: ContatoAgenda) => c.name || c.notify || c.verifiedName || formatarTelefone(c.jid.split("@")[0]) || "Contato";

    const enviarTexto = async (jid: string, texto: string) => {
        const assinar = !!lerAlertas().assinar; // conversa privada
        exigirSucesso(await sendChatMessage(sessionId, jid, texto, undefined, undefined, assinar));
        tocarEnviada();
    };

    const envioRapido = async (c: ContatoAgenda) => {
        const texto = textoRapido.trim();
        if (!texto) return;
        setEnviandoRapido(true);
        try {
            await enviarTexto(c.jid, texto);
            toast.success(`Mensagem enviada para ${nomeDe(c)}`);
            setTextoRapido("");
            setRapida(null);
        } catch (e: any) { toast.error(e?.message || "Falha ao enviar"); }
        finally { setEnviandoRapido(false); }
    };

    // numero novo: so salvar / abrir / enviar e abrir
    const executar = async (acao: "salvar" | "abrir") => {
        const n = normalizarNumero(numero);
        if (!n) { toast.error("Número incompleto: coloque DDD + número (ex.: 46 99999-8888)"); return; }
        const nm = nome.trim();
        if (acao === "salvar" && !nm) { toast.error("Coloque o nome para salvar na agenda"); return; }
        setOcupado(true);
        try {
            const jid = await conferirNumero(sessionId, n);
            if (nm && (salvar || acao === "salvar")) {
                const r = await salvarContato(sessionId, jid, nm, noCelular);
                avisoSalvo(nm, r);
                onSalvo?.(jid, nm);
            }
            if (acao === "salvar") { onOpenChange(false); return; }
            if (mensagem.trim()) {
                await enviarTexto(jid, mensagem.trim());
                toast.success("Mensagem enviada");
            }
            abrir(jid, nm || formatarTelefone(jid.split("@")[0]) || `+${jid.split("@")[0]}`);
        } catch (e: any) {
            toast.error(e?.message || "Falha");
        } finally {
            setOcupado(false);
        }
    };

    const previa = normalizarNumero(numero);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
                <DialogHeader className="px-5 pt-5 pb-3">
                    <DialogTitle className="flex items-center gap-2"><MessageCircle className="h-5 w-5 text-primary" /> Nova conversa</DialogTitle>
                    <DialogDescription>Escolha alguém da agenda ou digite qualquer número com WhatsApp.</DialogDescription>
                </DialogHeader>
                <Tabs value={aba} onValueChange={(v) => setAba(v as any)} className="gap-0">
                    <div className="px-5">
                        <TabsList className="w-full grid grid-cols-2">
                            <TabsTrigger value="agenda" className="gap-1.5"><BookUser className="h-4 w-4" /> Agenda</TabsTrigger>
                            <TabsTrigger value="numero" className="gap-1.5"><UserPlus className="h-4 w-4" /> Número novo</TabsTrigger>
                        </TabsList>
                    </div>

                    {/* ---------------- AGENDA ---------------- */}
                    <TabsContent value="agenda" className="mt-0">
                        <div className="px-5 pt-3 pb-2 space-y-2">
                            <div className="relative">
                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input autoFocus placeholder="Buscar por nome ou número" value={busca} onChange={(e) => setBusca(e.target.value)} className="pl-8 h-9" />
                            </div>
                            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                                <span>{carregando ? "Buscando…" : `${total} contato${total === 1 ? "" : "s"}${total > lista.length ? ` · mostrando ${lista.length}` : ""}`}</span>
                                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                    <Checkbox checked={todos} onCheckedChange={(v) => setTodos(!!v)} className="h-3.5 w-3.5" />
                                    incluir não salvos
                                </label>
                            </div>
                        </div>
                        <div className="max-h-[50vh] min-h-[200px] overflow-y-auto px-2 pb-3 styled-scrollbar">
                            {!carregando && lista.length === 0 && (
                                <div className="py-10 text-center text-sm text-muted-foreground space-y-2">
                                    <p>{busca ? "Ninguém encontrado na agenda." : "A agenda desta sessão está vazia."}</p>
                                    <Button variant="outline" size="sm" onClick={() => { setNumero(/\d/.test(busca) ? busca : ""); setNome(/\d/.test(busca) ? "" : busca); setAba("numero"); }}>
                                        <UserPlus className="h-4 w-4 mr-1.5" /> Usar um número novo
                                    </Button>
                                </div>
                            )}
                            {lista.map((c) => {
                                const n = nomeDe(c);
                                const tel = formatarTelefone(c.jid.split("@")[0]);
                                const aberta = rapida === c.jid;
                                return (
                                    <div key={c.id} className={cn("rounded-lg", aberta && "bg-muted/50")}>
                                        <div className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/60 cursor-pointer group" onClick={() => abrir(c.jid, n)}>
                                            <FotoLinha sessionId={sessionId} jid={c.jid} nome={n} />
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium truncate">{n}</p>
                                                <p className="text-[11px] text-muted-foreground truncate">
                                                    {tel}{!c.name && c.notify ? " · não salvo" : ""}
                                                </p>
                                            </div>
                                            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full opacity-60 group-hover:opacity-100" title="Mensagem rápida (sem sair daqui)"
                                                onClick={(e) => { e.stopPropagation(); setRapida(aberta ? null : c.jid); setTextoRapido(""); }}>
                                                <Send className="h-4 w-4" />
                                            </Button>
                                        </div>
                                        {aberta && (
                                            <div className="flex items-end gap-2 px-3 pb-2.5">
                                                <Textarea autoFocus rows={2} placeholder={`Mensagem para ${n}`} value={textoRapido} onChange={(e) => setTextoRapido(e.target.value)}
                                                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); envioRapido(c); } }}
                                                    className="min-h-[44px] text-sm resize-none" />
                                                <Button size="icon" className="h-9 w-9 rounded-full shrink-0" disabled={enviandoRapido || !textoRapido.trim()} onClick={() => envioRapido(c)}>
                                                    {enviandoRapido ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </TabsContent>

                    {/* ---------------- NUMERO NOVO ---------------- */}
                    <TabsContent value="numero" className="mt-0">
                        <div className="px-5 pt-3 pb-5 space-y-3">
                            <div className="space-y-1.5">
                                <Label className="text-xs">Número com WhatsApp</Label>
                                <Input autoFocus inputMode="tel" placeholder="DDD + número (ex.: 46 99999-8888)" value={numero} onChange={(e) => setNumero(e.target.value)}
                                    onKeyDown={(e) => e.key === "Enter" && !ocupado && executar("abrir")} className="h-9" />
                                <p className="text-[11px] text-muted-foreground">
                                    {previa ? <>Vai para <b>{formatarTelefone(previa) || "+" + previa}</b>. </> : null}
                                    Sem código do país assumo Brasil (+55); para outro país comece com <b>+</b>. O número é conferido no WhatsApp.
                                </p>
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">Nome <span className="text-muted-foreground font-normal">(para salvar na agenda)</span></Label>
                                <Input placeholder="Ex.: João da Silva" value={nome} onChange={(e) => setNome(e.target.value)} className="h-9" />
                            </div>
                            {nome.trim() && (
                                <div className="rounded-lg border border-border/50 bg-muted/30 p-2.5 space-y-2">
                                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                                        <Checkbox checked={salvar} onCheckedChange={(v) => setSalvar(!!v)} /> Salvar na agenda
                                    </label>
                                    <label className={cn("flex items-start gap-2 text-sm cursor-pointer", !salvar && "opacity-50 pointer-events-none")}>
                                        <Checkbox checked={noCelular} onCheckedChange={(v) => setNoCelular(!!v)} className="mt-0.5" />
                                        <span>Também na agenda do WhatsApp <span className="block text-[11px] text-muted-foreground">sincroniza com o celular desta sessão</span></span>
                                    </label>
                                </div>
                            )}
                            <div className="space-y-1.5">
                                <Label className="text-xs">Primeira mensagem <span className="text-muted-foreground font-normal">(opcional)</span></Label>
                                <Textarea rows={3} placeholder="Escreva para já enviar ao abrir a conversa" value={mensagem} onChange={(e) => setMensagem(e.target.value)} className="text-sm resize-none" />
                                <div className="flex justify-end -mt-0.5">
                                    <CorretorTexto texto={mensagem} aoAplicar={setMensagem} rotulo />
                                </div>
                            </div>
                            <div className="flex gap-2 pt-1">
                                <Button variant="outline" className="flex-1" disabled={ocupado || !numero.trim() || !nome.trim()} onClick={() => executar("salvar")}>
                                    <UserPlus className="h-4 w-4 mr-1.5" /> Só salvar
                                </Button>
                                <Button className="flex-1" disabled={ocupado || !numero.trim()} onClick={() => executar("abrir")}>
                                    {ocupado ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : mensagem.trim() ? <Send className="h-4 w-4 mr-1.5" /> : <MessageCircle className="h-4 w-4 mr-1.5" />}
                                    {mensagem.trim() ? "Enviar e abrir" : "Abrir conversa"}
                                </Button>
                            </div>
                        </div>
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
}
