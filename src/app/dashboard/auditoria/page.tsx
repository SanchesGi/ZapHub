"use client";

// minha versao: Auditoria — o que foi apagado (mensagens e conversas): o conteudo original, de quem era, em qual
// conversa, QUEM apagou e por onde. Cartoes em frases simples, agrupados por dia, com filtros faceis.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession as useAuthSession } from "next-auth/react";
import { ShieldCheck, Search, Loader2, Trash2, RefreshCw, Info } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSession } from "@/components/dashboard/session-provider";
import { CartaoConversa, CartaoMensagem, type ItemAuditoria } from "@/components/auditoria/cartoes";
import { agruparPorDia, type Periodo } from "@/lib/auditoria-tela";
import { cn } from "@/lib/utils";

const PERIODOS: { valor: Periodo; rotulo: string }[] = [
    { valor: "hoje", rotulo: "Hoje" },
    { valor: "7d", rotulo: "7 dias" },
    { valor: "30d", rotulo: "30 dias" },
    { valor: "tudo", rotulo: "Tudo" },
];

const TIPOS: { valor: string; rotulo: string }[] = [
    { valor: "todos", rotulo: "Todos os tipos" },
    { valor: "PAINEL", rotulo: "Pelo painel" },
    { valor: "CELULAR", rotulo: "Pelo celular" },
    { valor: "CONTATO", rotulo: "O contato apagou" },
    { valor: "CONVERSA", rotulo: "Conversa apagada" },
];

type Pessoa = { id: string; name: string | null; email: string };

function CaixaExplicativa({ papel }: { papel?: string }) {
    const quemVe = papel === "STAFF"
        ? "Você é Supervisor: vê só as sessões a que tem acesso."
        : "Você é Super Administrador: vê todas as sessões, menos as privadas de outros donos.";
    return (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 sm:p-4 text-sm space-y-1.5">
            <p className="flex items-center gap-2 font-semibold"><Info className="h-4 w-4 text-primary shrink-0" /> Para que serve esta tela</p>
            <p>Guarda o que foi apagado: a mensagem original, de quem era e quem apagou (pelo painel, pelo celular ou pelo próprio contato).</p>
            <p><span className="font-medium">Quem vê:</span> {quemVe}</p>
            <p className="text-muted-foreground">
                <span className="font-medium text-foreground">Limites:</span> só aparece o que foi apagado depois que esta função começou a valer.
                Quando o dono apaga só no celular (“apagar só para mim” ou “apagar conversa”), a mensagem some do painel e fica guardada aqui.
                “Limpar conversa” pelo celular não chega ao ZapHub; só “apagar” chega.
            </p>
        </div>
    );
}

export default function AuditoriaPage() {
    const { data: auth } = useAuthSession();
    const { sessions } = useSession();
    const [itens, setItens] = useState<ItemAuditoria[]>([]);
    const [carregando, setCarregando] = useState(true);
    const [busca, setBusca] = useState("");
    const [periodo, setPeriodo] = useState<Periodo>("tudo");
    const [sessao, setSessao] = useState("todas");
    const [tipo, setTipo] = useState("todos");
    // minha versao: filtro por pessoa (Supervisor: ele e a equipe dele)
    const [pessoa, setPessoa] = useState("todas");
    const [pessoas, setPessoas] = useState<Pessoa[]>([]);
    const [pagina, setPagina] = useState(1);
    const [meta, setMeta] = useState({ total: 0, paginas: 1, truncado: false });
    const [erro, setErro] = useState<string | null>(null);
    // fuso do navegador: "Hoje" e as horas dos cartoes seguem o relogio de quem esta olhando
    const [fuso] = useState(() => new Date().getTimezoneOffset());
    const [agora, setAgora] = useState(() => new Date());

    const carregar = useCallback(async () => {
        setCarregando(true);
        setErro(null);
        try {
            const p = new URLSearchParams({ pagina: String(pagina), limite: "25", busca, periodo, fuso: String(fuso) });
            if (sessao !== "todas") p.set("sessionId", sessao);
            if (tipo !== "todos") p.set("tipo", tipo);
            if (pessoa !== "todas") p.set("usuarioId", pessoa);
            const r = await fetch(`/api/auditoria?${p}`);
            const d = await r.json();
            if (!r.ok) throw new Error(d?.message || "Falha ao carregar");
            setItens(d.data || []);
            if (Array.isArray(d.pessoas)) setPessoas(d.pessoas);
            setMeta({ total: d.meta?.total || 0, paginas: d.meta?.paginas || 1, truncado: !!d.meta?.truncado });
            setAgora(new Date());
        } catch (e: any) {
            setErro(e?.message || "Falha ao carregar");
            setItens([]);
        } finally {
            setCarregando(false);
        }
    }, [pagina, busca, periodo, sessao, tipo, pessoa, fuso]);

    useEffect(() => { const t = setTimeout(() => { void carregar(); }, 300); return () => clearTimeout(t); }, [carregar]);
    useEffect(() => { setPagina(1); }, [busca, periodo, sessao, tipo, pessoa]);

    const dias = useMemo(() => agruparPorDia(itens, agora, fuso), [itens, agora, fuso]);
    const papel = (auth?.user as any)?.role as string | undefined;
    const filtrando = !!busca || periodo !== "tudo" || sessao !== "todas" || tipo !== "todos" || pessoa !== "todas";

    if (auth && papel !== "SUPERADMIN" && papel !== "STAFF") {
        return <div className="p-8 text-center text-muted-foreground">A auditoria é restrita a Supervisores e Super Administradores.</div>;
    }

    return (
        <div className="space-y-4 sm:space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div className="min-w-0">
                    <h2 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2"><ShieldCheck className="h-6 w-6 sm:h-7 sm:w-7 text-primary shrink-0" /> Auditoria</h2>
                    <p className="text-muted-foreground">O que foi apagado, por quem e por onde.</p>
                </div>
                <Button variant="outline" className="gap-1.5" onClick={() => { void carregar(); }}><RefreshCw className="h-4 w-4" /> Atualizar</Button>
            </div>

            <CaixaExplicativa papel={papel} />

            <Card>
                <CardContent className="space-y-4 p-3 sm:p-6">
                    <div className="space-y-3">
                        <div role="group" aria-label="Período" className="grid grid-cols-4 gap-1 rounded-lg bg-muted p-1 sm:inline-grid sm:w-auto">
                            {PERIODOS.map((p) => (
                                <button
                                    key={p.valor} type="button" onClick={() => setPeriodo(p.valor)} aria-pressed={periodo === p.valor}
                                    className={cn("rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                                        periodo === p.valor ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
                                >{p.rotulo}</button>
                            ))}
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            <Select value={sessao} onValueChange={setSessao}>
                                <SelectTrigger className="w-full" aria-label="Sessão"><SelectValue placeholder="Sessão" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="todas">Todas as sessões</SelectItem>
                                    {sessions.map((s) => <SelectItem key={s.sessionId} value={s.sessionId}>{s.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                            <Select value={pessoa} onValueChange={setPessoa}>
                                <SelectTrigger className="w-full" aria-label="Quem apagou"><SelectValue placeholder="Quem apagou" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="todas">Todas as pessoas</SelectItem>
                                    {pessoas.map((u) => <SelectItem key={u.id} value={u.id}>{u.name || u.email}</SelectItem>)}
                                </SelectContent>
                            </Select>
                            <Select value={tipo} onValueChange={setTipo}>
                                <SelectTrigger className="w-full" aria-label="Tipo"><SelectValue placeholder="Tipo" /></SelectTrigger>
                                <SelectContent>
                                    {TIPOS.map((t) => <SelectItem key={t.valor} value={t.valor}>{t.rotulo}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="relative">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input className="pl-8" placeholder="Buscar por texto, contato ou pessoa..." value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar" />
                        </div>
                    </div>

                    <p className="text-sm text-muted-foreground">{meta.total} {meta.total === 1 ? "registro" : "registros"}</p>

                    {carregando ? (
                        <div className="py-16 flex justify-center gap-2 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /> Carregando...</div>
                    ) : erro ? (
                        <div className="py-16 text-center text-destructive">{erro}</div>
                    ) : itens.length === 0 ? (
                        <div className="py-16 text-center text-muted-foreground space-y-2">
                            <Trash2 className="h-8 w-8 mx-auto opacity-40" />
                            <p>{filtrando ? "Nada apagado encontrado com esses filtros." : "Nada apagado registrado ainda."}</p>
                            <p className="text-xs">O registro vale só a partir do momento em que esta função começou a funcionar.</p>
                        </div>
                    ) : (
                        <div className="space-y-5">
                            {dias.map((dia) => (
                                <section key={dia.chave} className="space-y-2">
                                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{dia.rotulo}</h3>
                                    {dia.itens.map((r) => (r.tipoItem === "conversa"
                                        ? <CartaoConversa key={r.id} r={r} fuso={fuso} />
                                        : <CartaoMensagem key={r.id} r={r} fuso={fuso} />))}
                                </section>
                            ))}
                        </div>
                    )}

                    {meta.truncado && <p className="text-xs text-muted-foreground text-center">Mostrando só os registros mais recentes. Use os filtros para achar os mais antigos.</p>}
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
