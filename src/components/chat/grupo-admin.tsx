"use client";

// minha versao: administracao de grupo no painel de dados do grupo (chat-info-panel). Cada bloco chama as rotas
// /api/groups/<sessao>/<grupo>/... (todas de gestao exigem podeGerenciarSessao no servidor) e, depois de cada acao,
// pede ao painel para recarregar os dados. A decisao de quem ve os botoes fica em lib/grupo-admin (pura e testada).
import { useEffect, useState } from "react";
import { Check, Clock, Copy, Info, Link2, Loader2, LogOut, RefreshCw, ShieldMinus, ShieldPlus, UserMinus, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
    MAX_DESCRICAO_GRUPO, MAX_NOME_GRUPO, MAX_NUMEROS_POR_VEZ, OPCOES_TEMPORARIAS, confirmouSaida, interpretarResultadoAdicao,
    lerNumeros, mensagemDeErroGrupo, PALAVRA_SAIR, validarDescricaoGrupo, validarNomeGrupo, type AcoesDoMembro, type ResultadoAdicao
} from "@/lib/grupo-admin";

export interface ContextoGrupo {
    sessionId: string;
    jid: string;
    /** busca os dados do grupo de novo (sem piscar a tela) */
    recarregar: () => Promise<void>;
}

type RespostaApi = { ok: true; dados: any } | { ok: false; erro: string };

const urlDoGrupo = (c: ContextoGrupo, parte: string) => `/api/groups/${c.sessionId}/${encodeURIComponent(c.jid)}/${parte}`;

async function chamarApi(metodo: "GET" | "PUT" | "POST", url: string, corpo: unknown, acao: string): Promise<RespostaApi> {
    try {
        const r = await fetch(url, {
            method: metodo,
            headers: corpo === undefined ? undefined : { "Content-Type": "application/json" },
            body: corpo === undefined ? undefined : JSON.stringify(corpo)
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j?.status === false || j?.success === false) {
            const bruta = typeof j?.message === "string" ? j.message : typeof j?.error === "string" ? j.error : null;
            return { ok: false, erro: mensagemDeErroGrupo(r.status, bruta, acao) };
        }
        return { ok: true, dados: j };
    } catch {
        return { ok: false, erro: `Sem resposta do painel ao tentar ${acao}. Verifique a conexão.` };
    }
}

async function copiarTexto(texto: string, rotulo: string) {
    try { await navigator.clipboard.writeText(texto); toast.success(rotulo); }
    catch { toast.error("Não consegui copiar. Selecione o texto e copie manualmente."); }
}

function Rotulo({ children }: { children: React.ReactNode }) {
    return <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{children}</p>;
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
    return (
        <section className="px-4 pt-4 space-y-2">
            <Rotulo>{titulo}</Rotulo>
            {children}
        </section>
    );
}

// ─── CONFIRMACAO ───────────────────
interface PropsConfirmar {
    aberto: boolean;
    titulo: string;
    descricao: string;
    rotulo: string;
    ocupado: boolean;
    /** confirmacao forte: o botao so libera depois de digitar esta palavra */
    palavra?: string;
    onConfirmar: () => void;
    onCancelar: () => void;
}

export function ConfirmarDialog({ aberto, titulo, descricao, rotulo, ocupado, palavra, onConfirmar, onCancelar }: PropsConfirmar) {
    const [digitado, setDigitado] = useState("");
    useEffect(() => { if (!aberto) setDigitado(""); }, [aberto]);
    const liberado = !palavra || confirmouSaida(digitado);
    return (
        <AlertDialog open={aberto} onOpenChange={(o) => { if (!o && !ocupado) onCancelar(); }}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{titulo}</AlertDialogTitle>
                    <AlertDialogDescription>{descricao}</AlertDialogDescription>
                </AlertDialogHeader>
                {palavra && (
                    <div className="space-y-1.5">
                        <p className="text-xs text-muted-foreground">Para continuar, digite <strong className="text-foreground">{palavra}</strong>.</p>
                        <Input value={digitado} onChange={(e) => setDigitado(e.target.value)} autoComplete="off" className="h-9" placeholder={palavra} />
                    </div>
                )}
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={ocupado}>Cancelar</AlertDialogCancel>
                    <Button variant="destructive" disabled={!liberado || ocupado} onClick={onConfirmar}>
                        {ocupado && <Loader2 className="h-4 w-4 animate-spin" />}{rotulo}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}

// ─── MODO LEITURA ──────────────────
export function AvisoLeitura({ motivo }: { motivo: string }) {
    return (
        <div className="mx-4 mt-3 flex gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" />
            <span>{motivo}</span>
        </div>
    );
}

// ─── NOME E DESCRICAO ──────────────
export function EditarGrupo({ ctx, subject, desc }: { ctx: ContextoGrupo; subject: string; desc: string }) {
    const [nome, setNome] = useState(subject);
    const [descricao, setDescricao] = useState(desc);
    const [salvando, setSalvando] = useState<"nome" | "descricao" | null>(null);
    useEffect(() => setNome(subject), [subject]);
    useEffect(() => setDescricao(desc), [desc]);

    const erroNome = validarNomeGrupo(nome);
    const erroDescricao = validarDescricaoGrupo(descricao);

    const salvar = async (qual: "nome" | "descricao") => {
        setSalvando(qual);
        const r = qual === "nome"
            ? await chamarApi("PUT", urlDoGrupo(ctx, "subject"), { subject: nome.trim() }, "mudar o nome do grupo")
            : await chamarApi("PUT", urlDoGrupo(ctx, "description"), { description: descricao.trim() }, "mudar a descrição do grupo");
        if (r.ok) { toast.success(qual === "nome" ? "Nome do grupo atualizado" : "Descrição do grupo atualizada"); await ctx.recarregar(); }
        else toast.error(r.erro);
        setSalvando(null);
    };

    return (
        <Bloco titulo="Nome e descrição">
            <div className="flex gap-2">
                <Input value={nome} maxLength={MAX_NOME_GRUPO} onChange={(e) => setNome(e.target.value)} placeholder="Nome do grupo" className="h-9 text-sm" aria-label="Nome do grupo" />
                <Button size="sm" className="h-9" disabled={!!erroNome || nome.trim() === subject || salvando !== null} onClick={() => void salvar("nome")}>
                    {salvando === "nome" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Salvar"}
                </Button>
            </div>
            {erroNome && nome !== subject && <p className="text-[11px] text-destructive">{erroNome}</p>}
            <Textarea value={descricao} maxLength={MAX_DESCRICAO_GRUPO} onChange={(e) => setDescricao(e.target.value)} placeholder="Descrição do grupo (deixe vazio para remover)" className="min-h-20 text-sm" aria-label="Descrição do grupo" />
            <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground">{descricao.length}/{MAX_DESCRICAO_GRUPO}</span>
                <Button size="sm" className="h-8" disabled={!!erroDescricao || descricao.trim() === desc.trim() || salvando !== null} onClick={() => void salvar("descricao")}>
                    {salvando === "descricao" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Salvar descrição"}
                </Button>
            </div>
        </Bloco>
    );
}

// ─── CONFIGURACOES ─────────────────
export function RegrasDoGrupo({ ctx, announce, restrict, ephemeral }: { ctx: ContextoGrupo; announce: boolean; restrict: boolean; ephemeral: number }) {
    const [ocupado, setOcupado] = useState(false);

    const mudar = async (url: string, corpo: unknown, acao: string, sucesso: string) => {
        setOcupado(true);
        const r = await chamarApi("PUT", url, corpo, acao);
        if (r.ok) { toast.success(sucesso); await ctx.recarregar(); }
        else toast.error(r.erro);
        setOcupado(false);
    };

    return (
        <Bloco titulo="Configurações do grupo">
            <label className="flex items-center justify-between gap-3 text-sm">
                <span>Só admins enviam mensagens</span>
                <Switch checked={announce} disabled={ocupado}
                    onCheckedChange={(v) => void mudar(urlDoGrupo(ctx, "settings"), { setting: v ? "announcement" : "not_announcement" }, "mudar quem envia mensagens",
                        v ? "Agora só administradores enviam mensagens" : "Agora todos podem enviar mensagens")} />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm">
                <span>Só admins editam os dados do grupo</span>
                <Switch checked={restrict} disabled={ocupado}
                    onCheckedChange={(v) => void mudar(urlDoGrupo(ctx, "settings"), { setting: v ? "locked" : "unlocked" }, "mudar quem edita os dados",
                        v ? "Agora só administradores editam os dados" : "Agora todos podem editar os dados")} />
            </label>
            <div className="flex items-center justify-between gap-3 text-sm">
                <span className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5 text-primary" />Mensagens temporárias</span>
                <Select value={String(ephemeral)} disabled={ocupado}
                    onValueChange={(v) => void mudar(urlDoGrupo(ctx, "ephemeral"), { expiration: Number.parseInt(v, 10) }, "mudar as mensagens temporárias", "Mensagens temporárias atualizadas")}>
                    <SelectTrigger className="h-8 w-[130px] text-sm" aria-label="Mensagens temporárias"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        {OPCOES_TEMPORARIAS.map((o) => <SelectItem key={o.valor} value={String(o.valor)}>{o.rotulo}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>
        </Bloco>
    );
}

// ─── LINK DE CONVITE ───────────────
export interface Convite {
    link: string | null;
    carregando: boolean;
    /** busca o link (so se ainda nao tiver) e devolve ele; null se falhar */
    obter: () => Promise<string | null>;
    redefinir: () => Promise<boolean>;
}

export function useConvite(ctx: ContextoGrupo): Convite {
    const [link, setLink] = useState<string | null>(null);
    const [carregando, setCarregando] = useState(false);
    // o link e do grupo: ao trocar de conversa, esquece o anterior
    useEffect(() => setLink(null), [ctx.sessionId, ctx.jid]);

    const obter = async () => {
        if (link) return link;
        setCarregando(true);
        const r = await chamarApi("GET", urlDoGrupo(ctx, "invite"), undefined, "buscar o link de convite");
        setCarregando(false);
        if (!r.ok) { toast.error(r.erro); return null; }
        const novo = typeof r.dados.inviteUrl === "string" ? r.dados.inviteUrl : null;
        setLink(novo);
        return novo;
    };
    const redefinir = async () => {
        setCarregando(true);
        const r = await chamarApi("PUT", urlDoGrupo(ctx, "invite"), undefined, "redefinir o link de convite");
        setCarregando(false);
        if (!r.ok) { toast.error(r.erro); return false; }
        setLink(typeof r.dados.inviteUrl === "string" ? r.dados.inviteUrl : null);
        toast.success("Link redefinido. O link antigo deixou de funcionar.");
        return true;
    };
    return { link, carregando, obter, redefinir };
}

export function ConviteGrupo({ convite }: { convite: Convite }) {
    const [confirmando, setConfirmando] = useState(false);
    return (
        <Bloco titulo="Link de convite">
            {!convite.link ? (
                <Button size="sm" variant="secondary" className="h-8 gap-1.5" disabled={convite.carregando} onClick={() => void convite.obter()}>
                    {convite.carregando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}Mostrar link
                </Button>
            ) : (
                <>
                    <Input readOnly value={convite.link} onFocus={(e) => e.currentTarget.select()} className="h-9 text-xs font-mono" aria-label="Link de convite do grupo" />
                    <div className="flex gap-2">
                        <Button size="sm" variant="secondary" className="h-8 gap-1.5 flex-1" onClick={() => void copiarTexto(convite.link as string, "Link copiado")}><Copy className="h-3.5 w-3.5" />Copiar</Button>
                        <Button size="sm" variant="outline" className="h-8 gap-1.5 flex-1" disabled={convite.carregando} onClick={() => setConfirmando(true)}><RefreshCw className="h-3.5 w-3.5" />Redefinir</Button>
                    </div>
                </>
            )}
            <ConfirmarDialog aberto={confirmando} ocupado={convite.carregando} titulo="Redefinir o link de convite?" rotulo="Redefinir link"
                descricao="O link atual deixa de funcionar e um novo é criado. Quem ainda não entrou precisa receber o link novo."
                onCancelar={() => setConfirmando(false)}
                onConfirmar={() => { void convite.redefinir().then(() => setConfirmando(false)); }} />
        </Bloco>
    );
}

// ─── ADICIONAR MEMBROS ─────────────
export function AdicionarMembros({ ctx, convite }: { ctx: ContextoGrupo; convite: Convite }) {
    const [texto, setTexto] = useState("");
    const [enviando, setEnviando] = useState(false);
    const [resultados, setResultados] = useState<ResultadoAdicao[] | null>(null);

    const leitura = lerNumeros(texto);
    const excedeu = leitura.validos.length > MAX_NUMEROS_POR_VEZ;
    const podeEnviar = leitura.validos.length > 0 && leitura.invalidos.length === 0 && !excedeu && !enviando;

    const adicionar = async () => {
        setEnviando(true);
        setResultados(null);
        const r = await chamarApi("PUT", urlDoGrupo(ctx, "members"), { action: "add", participants: leitura.validos.map((v) => v.jid) }, "adicionar os membros");
        if (!r.ok) { toast.error(r.erro); setEnviando(false); return; }
        const lista = interpretarResultadoAdicao(r.dados.result, leitura.validos);
        setResultados(lista);
        const okCount = lista.filter((x) => x.ok).length;
        if (okCount === lista.length) { toast.success(okCount === 1 ? "Membro adicionado" : `${okCount} membros adicionados`); setTexto(""); }
        else if (okCount > 0) toast.warning(`${okCount} de ${lista.length} adicionados. Veja o resultado de cada número.`);
        else toast.error("Nenhum número foi adicionado. Veja o motivo de cada um.");
        await ctx.recarregar();
        setEnviando(false);
    };

    const temConvite = !!resultados?.some((x) => x.situacao === "convite");
    return (
        <Bloco titulo="Adicionar membros">
            <Textarea value={texto} onChange={(e) => { setTexto(e.target.value); setResultados(null); }}
                placeholder={"Números com DDD, um por linha\nEx.: (46) 99999-8888\nOutro país: +1 415 555 0123"} className="min-h-20 text-sm" aria-label="Números a adicionar" />
            {leitura.invalidos.length > 0 && (
                <ul className="text-[11px] text-destructive space-y-0.5">
                    {leitura.invalidos.map((i, idx) => <li key={`${i.entrada}-${idx}`}>{i.entrada}: {i.motivo}</li>)}
                </ul>
            )}
            {excedeu && <p className="text-[11px] text-destructive">Adicione no máximo {MAX_NUMEROS_POR_VEZ} números por vez.</p>}
            {leitura.repetidos > 0 && <p className="text-[11px] text-muted-foreground">{leitura.repetidos} número(s) repetido(s) será(ão) ignorado(s).</p>}
            <Button size="sm" className="h-8 gap-1.5" disabled={!podeEnviar} onClick={() => void adicionar()}>
                {enviando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                {leitura.validos.length > 1 ? `Adicionar ${leitura.validos.length} números` : "Adicionar"}
            </Button>
            {resultados && (
                <ul className="rounded-lg border border-border/60 divide-y divide-border/40 text-xs">
                    {resultados.map((x) => (
                        <li key={x.numero} className="flex gap-2 px-2.5 py-1.5">
                            {x.ok ? <Check className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" /> : <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-destructive" />}
                            <span><span className="font-mono">+{x.numero}</span><span className="block text-muted-foreground">{x.mensagem}</span></span>
                        </li>
                    ))}
                </ul>
            )}
            {temConvite && (
                <Button size="sm" variant="secondary" className="h-8 gap-1.5" disabled={convite.carregando}
                    onClick={() => { void convite.obter().then((l) => { if (l) return copiarTexto(l, "Link do grupo copiado. Envie para a pessoa."); }); }}>
                    <Link2 className="h-3.5 w-3.5" />Copiar link do grupo para enviar
                </Button>
            )}
        </Bloco>
    );
}

// ─── ACOES DE UM MEMBRO ────────────
export function AcoesDoMembroLinha({ ctx, membroId, nome, acoes }: { ctx: ContextoGrupo; membroId: string; nome: string; acoes: AcoesDoMembro }) {
    const [ocupado, setOcupado] = useState(false);
    const [removendo, setRemovendo] = useState(false);

    const agir = async (action: "promote" | "demote" | "remove", acao: string, sucesso: string) => {
        setOcupado(true);
        const r = await chamarApi("PUT", urlDoGrupo(ctx, "members"), { action, participants: [membroId] }, acao);
        // o WhatsApp responde 200 com um status por pessoa: confere o de quem pedimos
        const item = r.ok && Array.isArray(r.dados.result) ? r.dados.result[0] : null;
        const status = item && typeof item.status === "string" ? item.status : "200";
        if (r.ok && status === "200") { toast.success(sucesso); await ctx.recarregar(); }
        else toast.error(r.ok ? `O WhatsApp não permitiu ${acao}.` : r.erro);
        setOcupado(false);
        setRemovendo(false);
    };

    if (!acoes.promover && !acoes.rebaixar && !acoes.remover) return null;
    return (
        <div className="flex items-center shrink-0 pr-1">
            {acoes.promover && (
                <Button variant="ghost" size="icon" className="h-7 w-7" disabled={ocupado} title="Tornar admin" aria-label={`Tornar ${nome} admin`}
                    onClick={() => void agir("promote", "promover o membro a admin", `${nome} agora é admin`)}><ShieldPlus className="h-3.5 w-3.5" /></Button>
            )}
            {acoes.rebaixar && (
                <Button variant="ghost" size="icon" className="h-7 w-7" disabled={ocupado} title="Remover admin" aria-label={`Remover ${nome} de admin`}
                    onClick={() => void agir("demote", "remover o membro de admin", `${nome} deixou de ser admin`)}><ShieldMinus className="h-3.5 w-3.5" /></Button>
            )}
            {acoes.remover && (
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" disabled={ocupado} title="Remover do grupo" aria-label={`Remover ${nome} do grupo`}
                    onClick={() => setRemovendo(true)}><UserMinus className="h-3.5 w-3.5" /></Button>
            )}
            <ConfirmarDialog aberto={removendo} ocupado={ocupado} titulo={`Remover ${nome} do grupo?`} rotulo="Remover do grupo"
                descricao="A pessoa sai do grupo e deixa de receber as mensagens. Você pode adicioná-la de novo depois."
                onCancelar={() => setRemovendo(false)}
                onConfirmar={() => void agir("remove", "remover o membro do grupo", `${nome} foi removido do grupo`)} />
        </div>
    );
}

// ─── SAIR DO GRUPO ─────────────────
export function SairDoGrupo({ ctx, nome, onSaiu }: { ctx: ContextoGrupo; nome: string; onSaiu: () => void }) {
    const [aberto, setAberto] = useState(false);
    const [saindo, setSaindo] = useState(false);

    const sair = async () => {
        setSaindo(true);
        const r = await chamarApi("POST", urlDoGrupo(ctx, "leave"), undefined, "sair do grupo");
        setSaindo(false);
        if (!r.ok) { toast.error(r.erro); return; }
        setAberto(false);
        toast.success(`A conta saiu do grupo "${nome}"`);
        onSaiu();
    };

    return (
        <section className="px-4 pt-6">
            <Button size="sm" variant="outline" className="h-8 gap-1.5 w-full text-destructive hover:text-destructive" onClick={() => setAberto(true)}>
                <LogOut className="h-3.5 w-3.5" />Sair do grupo
            </Button>
            <ConfirmarDialog aberto={aberto} ocupado={saindo} palavra={PALAVRA_SAIR} titulo={`Sair do grupo "${nome}"?`} rotulo="Sair do grupo"
                descricao="A conta desta sessão deixa o grupo e para de receber as mensagens dele. Para voltar, alguém precisa adicioná-la de novo ou enviar o link de convite."
                onCancelar={() => setAberto(false)} onConfirmar={() => void sair()} />
        </section>
    );
}
