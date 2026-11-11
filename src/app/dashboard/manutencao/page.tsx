"use client";

// minha versao: Manutencao pelo painel (so Super Administrador). Tudo o que antes exigia entrar na VM:
//  - Armazenamento: pasta das midias, mover os arquivos antigos, espaco livre;
//  - Sistema: atualizar agora, reiniciar o servico;
//  - Logs: servico e atualizacao;
//  - Espaco: o que ocupa o disco e limpeza com um clique.
// O unico passo na VM e o preparo de uma vez (deploy/preparar-vm.sh), e o painel mostra o comando quando falta.
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Copy, FolderInput, HardDrive, Loader2, Power, RefreshCw, ScrollText, Trash2, Wrench, DownloadCloud } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

function bytes(n: number | null | undefined): string {
    if (n == null) return "—";
    if (n < 1024) return `${n} B`;
    const u = ["KB", "MB", "GB", "TB"];
    let v = n / 1024, i = 0;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v >= 100 ? 0 : 1).replace(".", ",")} ${u[i]}`;
}

async function chamar(url: string, init?: RequestInit) {
    const r = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d?.status === false) {
        const e: any = new Error(d?.message || "Falhou");
        e.comando = d?.comando;
        throw e;
    }
    return d;
}

function Comando({ texto }: { texto: string }) {
    return (
        <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-2">
            <code className="flex-1 text-xs break-all font-mono">{texto}</code>
            <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" title="Copiar"
                onClick={() => navigator.clipboard.writeText(texto).then(() => toast.success("Comando copiado"), () => toast.error("Não consegui copiar"))}>
                <Copy className="h-3.5 w-3.5" />
            </Button>
        </div>
    );
}

// ---------------------------------------------------------------- Armazenamento

type Uso = { pasta: string; arquivos: number; bytes: number; livre: number | null; total: number | null; existe: boolean };
type Mudanca = { rodando: boolean; origem: string; destino: string; total: number; movidos: number; bytes: number; erros: number; ultimoErro?: string; fim?: string };
type Resumo = { pastaAtual: string; pastaPadrao: string; pastaSugerida: string; comandoSugerido: string; usaPadrao: boolean; uso: Uso; usoPadrao: Uso | null; mudanca: Mudanca | null };

function DiscoBarra({ livre, total }: { livre: number | null; total: number | null }) {
    if (!total || livre == null) return null;
    const usado = total - livre;
    const pct = Math.round((usado / total) * 100);
    return (
        <div className="space-y-1">
            <Progress value={pct} className={pct >= 90 ? "[&>div]:bg-destructive" : undefined} />
            <p className="text-[11px] text-muted-foreground">{bytes(usado)} usados de {bytes(total)} · {bytes(livre)} livres ({pct}%)</p>
        </div>
    );
}

function AbaArmazenamento() {
    const [r, setR] = useState<Resumo | null>(null);
    const [pasta, setPasta] = useState("");
    const [mover, setMover] = useState(true);
    const [ocupado, setOcupado] = useState(false);
    const [comando, setComando] = useState<string | null>(null);

    const carregar = useCallback(async () => {
        try {
            const d = await chamar("/api/system/armazenamento");
            setR(d.data);
            setPasta((p) => p || (d.data.usaPadrao ? d.data.pastaSugerida : d.data.pastaAtual));
        } catch (e: any) { toast.error(e.message); }
    }, []);
    useEffect(() => { carregar(); }, [carregar]);

    // acompanha a mudanca enquanto ela roda
    useEffect(() => {
        if (!r?.mudanca?.rodando) return;
        const t = setInterval(carregar, 2000);
        return () => clearInterval(t);
    }, [r?.mudanca?.rodando, carregar]);

    const trocar = async () => {
        setOcupado(true); setComando(null);
        try {
            const d = await chamar("/api/system/armazenamento", { method: "PUT", body: JSON.stringify({ pasta, mover }) });
            toast.success(d.message);
            setR(d.data);
        } catch (e: any) { toast.error(e.message); setComando(e.comando || null); }
        finally { setOcupado(false); }
    };

    const moverAgora = async () => {
        setOcupado(true);
        try { const d = await chamar("/api/system/armazenamento", { method: "POST", body: JSON.stringify({}) }); toast.success(d.message); setR(d.data); }
        catch (e: any) { toast.error(e.message); }
        finally { setOcupado(false); }
    };

    if (!r) return <div className="py-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
    const m = r.mudanca;

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Pasta atual das mídias</CardTitle>
                    <CardDescription>Imagens, áudios, vídeos, documentos e figurinhas recebidos ficam aqui.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <code className="block text-sm font-mono break-all">{r.pastaAtual}</code>
                    <p className="text-sm">{r.uso.arquivos} arquivo(s) · {bytes(r.uso.bytes)}</p>
                    <DiscoBarra livre={r.uso.livre} total={r.uso.total} />
                    {r.usaPadrao && (
                        <p className="text-xs text-amber-700 dark:text-amber-400">
                            Esta é a pasta padrão, dentro da pasta do aplicativo. Na VM ela fica no /home, que é pequeno. Troque para {r.pastaSugerida}.
                        </p>
                    )}
                </CardContent>
            </Card>

            {r.usoPadrao && r.usoPadrao.arquivos > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Arquivos na pasta antiga</CardTitle>
                        <CardDescription>{r.usoPadrao.arquivos} arquivo(s) · {bytes(r.usoPadrao.bytes)} ainda em {r.pastaPadrao}. Eles continuam aparecendo nas conversas até serem movidos.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Button onClick={moverAgora} disabled={ocupado || !!m?.rodando}><FolderInput className="h-4 w-4 mr-1.5" /> Mover arquivos para a pasta atual</Button>
                    </CardContent>
                </Card>
            )}

            {m && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">{m.rodando && <Loader2 className="h-4 w-4 animate-spin" />} {m.rodando ? "Movendo arquivos…" : "Última mudança"}</CardTitle>
                        <CardDescription className="break-all">{m.origem} → {m.destino}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        <Progress value={m.total ? Math.round(((m.movidos + m.erros) / m.total) * 100) : 100} />
                        <p className="text-sm">{m.movidos} de {m.total} movidos ({bytes(m.bytes)}){m.erros ? ` · ${m.erros} com erro` : ""}</p>
                        {m.ultimoErro && <p className="text-xs text-destructive break-all">Último erro: {m.ultimoErro}</p>}
                    </CardContent>
                </Card>
            )}

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Trocar a pasta</CardTitle>
                    <CardDescription>As mídias novas passam a ir para a pasta escolhida na hora. As antigas podem ser movidas junto.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div className="space-y-1.5">
                        <Label className="text-xs">Pasta</Label>
                        <Input value={pasta} onChange={(e) => setPasta(e.target.value)} placeholder={r.pastaSugerida} className="font-mono text-sm" />
                    </div>
                    <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                        <Checkbox checked={mover} onCheckedChange={(v) => setMover(!!v)} /> Mover os arquivos que já existem
                    </label>
                    <Button onClick={trocar} disabled={ocupado || !pasta.trim() || !!m?.rodando}>
                        {ocupado ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <HardDrive className="h-4 w-4 mr-1.5" />} Usar esta pasta
                    </Button>
                    {comando && (
                        <div className="space-y-1.5 pt-1">
                            <p className="text-xs text-muted-foreground">Rode uma vez na VM (pede a sua senha) e clique em "Usar esta pasta" de novo:</p>
                            <Comando texto={comando} />
                        </div>
                    )}
                    {!comando && r.usaPadrao && (
                        <div className="space-y-1.5 pt-1">
                            <p className="text-xs text-muted-foreground">Na primeira vez, a pasta {r.pastaSugerida} precisa ser criada na VM. O jeito mais completo é o preparo, que já libera também o Atualizar agora:</p>
                            <Comando texto="sudo bash deploy/preparar-vm.sh" />
                            <p className="text-xs text-muted-foreground">Ou só a pasta:</p>
                            <Comando texto={r.comandoSugerido} />
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

// ---------------------------------------------------------------- Sistema

type InfoSistema = {
    espaco: { itens: Item[]; discos: { nome: string; caminho: string; livre: number; total: number }[] };
    atualizador: { ativo: boolean; instalado: boolean };
    versao: { disponivel: boolean; atras: number; localSha: string | null; remotoSha: string | null } | null;
    relogioDiferenca: number | null;
    systemd: boolean;
    comandoPreparo: string;
    iniciadoEm: string;
};
type Item = { id: string; nome: string; caminho: string; bytes: number | null; limpavel: boolean; explicacao: string };

function AbaSistema({ info, recarregar }: { info: InfoSistema | null; recarregar: () => void }) {
    const [confirmar, setConfirmar] = useState<"reiniciar" | "atualizar" | null>(null);
    const [ocupado, setOcupado] = useState(false);
    const [comando, setComando] = useState<string | null>(null);

    const executar = async (acao: "reiniciar" | "atualizar") => {
        setOcupado(true); setComando(null);
        try {
            const d = await chamar("/api/system/manutencao", { method: "POST", body: JSON.stringify({ acao }) });
            toast.success(d.message);
            if (acao === "reiniciar") setTimeout(() => window.location.reload(), 12000);
            else setTimeout(recarregar, 3000);
        } catch (e: any) { toast.error(e.message); setComando(e.comando || null); }
        finally { setOcupado(false); setConfirmar(null); }
    };

    if (!info) return <div className="py-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
    const v = info.versao;

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Versão</CardTitle>
                    <CardDescription>No ar desde {new Date(info.iniciadoEm).toLocaleString()}.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <p className="text-sm">
                        Instalada: <code className="font-mono">{v?.localSha?.slice(0, 7) || "?"}</code>
                        {v?.disponivel ? <> · <b>{v.atras} atualização(ões) no GitHub</b> (<code className="font-mono">{v.remotoSha?.slice(0, 7)}</code>)</> : " · em dia com o GitHub"}
                    </p>
                    {info.atualizador.ativo && <p className="text-sm flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Atualização em andamento. Acompanhe em Logs.</p>}
                    <div className="flex flex-wrap gap-2">
                        <Button onClick={() => setConfirmar("atualizar")} disabled={ocupado || info.atualizador.ativo}>
                            <DownloadCloud className="h-4 w-4 mr-1.5" /> Atualizar agora
                        </Button>
                        <Button variant="outline" onClick={() => setConfirmar("reiniciar")} disabled={ocupado || !info.systemd}>
                            <Power className="h-4 w-4 mr-1.5" /> Reiniciar o serviço
                        </Button>
                        <Button variant="ghost" onClick={recarregar} disabled={ocupado}><RefreshCw className="h-4 w-4 mr-1.5" /> Conferir de novo</Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        A atualização só instala versões aprovadas na verificação do GitHub, compila sem tirar o site do ar e volta sozinha para a versão anterior se a nova não responder.
                    </p>
                    {(comando || (!info.atualizador.instalado && info.systemd)) && (
                        <div className="space-y-1.5">
                            <p className="text-xs text-muted-foreground">Para o painel poder atualizar, rode uma vez na VM (pede a sua senha):</p>
                            <Comando texto={comando || info.comandoPreparo} />
                        </div>
                    )}
                    {!info.systemd && <p className="text-xs text-muted-foreground">Este servidor não está rodando como serviço do systemd (desenvolvimento): reiniciar e atualizar ficam desligados.</p>}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Relógio da VM</CardTitle>
                    <CardDescription>Comparado com o horário da internet. Relógio errado bagunça a ordem das mensagens e os horários.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                    {info.relogioDiferenca == null ? (
                        <p className="text-sm text-muted-foreground">Não consegui comparar agora (sem acesso à internet?).</p>
                    ) : Math.abs(info.relogioDiferenca) <= 5 ? (
                        <p className="text-sm">Certo (diferença de {Math.abs(info.relogioDiferenca)} s).</p>
                    ) : (
                        <>
                            <p className="text-sm text-destructive">
                                A VM está {info.relogioDiferenca > 0 ? "adiantada" : "atrasada"} {Math.abs(info.relogioDiferenca)} segundos.
                            </p>
                            <p className="text-xs text-muted-foreground">Para acertar de vez (sincroniza sozinho com a internet), rode uma vez na VM:</p>
                            <Comando texto="sudo systemctl enable --now chronyd && sudo chronyc makestep" />
                        </>
                    )}
                </CardContent>
            </Card>

            <AlertDialog open={!!confirmar} onOpenChange={(o) => !o && setConfirmar(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{confirmar === "reiniciar" ? "Reiniciar o serviço?" : "Atualizar agora?"}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {confirmar === "reiniciar"
                                ? "O painel e as sessões do WhatsApp ficam fora do ar por alguns segundos e reconectam sozinhos."
                                : "Baixa a versão mais nova do GitHub e instala. Durante a troca o painel fica fora por alguns segundos."}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={() => confirmar && executar(confirmar)}>{confirmar === "reiniciar" ? "Reiniciar" : "Atualizar"}</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

// ---------------------------------------------------------------- Logs

function AbaLogs() {
    const [fonte, setFonte] = useState<"servico" | "atualizacao">("servico");
    const [dados, setDados] = useState<{ origem: string; linhas: string[] } | null>(null);
    const [carregando, setCarregando] = useState(false);
    const [filtro, setFiltro] = useState("");
    const fimRef = useRef<HTMLDivElement>(null);

    const carregar = useCallback(async () => {
        setCarregando(true);
        try { const d = await chamar(`/api/system/logs?fonte=${fonte}&n=800`); setDados(d.data); }
        catch (e: any) { toast.error(e.message); }
        finally { setCarregando(false); }
    }, [fonte]);
    useEffect(() => { carregar(); }, [carregar]);
    useEffect(() => { fimRef.current?.scrollIntoView({ block: "end" }); }, [dados]);

    const linhas = (dados?.linhas || []).filter((l) => !filtro.trim() || l.toLowerCase().includes(filtro.toLowerCase()));
    return (
        <Card>
            <CardHeader className="gap-3">
                <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant={fonte === "servico" ? "default" : "outline"} onClick={() => setFonte("servico")}>Serviço</Button>
                    <Button size="sm" variant={fonte === "atualizacao" ? "default" : "outline"} onClick={() => setFonte("atualizacao")}>Atualização</Button>
                    <Input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Filtrar" className="h-8 w-40 sm:w-56" />
                    <Button size="sm" variant="ghost" onClick={carregar} disabled={carregando}>
                        {carregando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    </Button>
                </div>
                <CardDescription>Origem: {dados?.origem || "…"} · {linhas.length} linha(s)</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="h-[60vh] overflow-auto rounded-lg border border-border/60 bg-muted/30 p-3 styled-scrollbar">
                    {linhas.length === 0 && !carregando && <p className="text-sm text-muted-foreground">Nada registrado ainda.</p>}
                    <pre className="text-[11px] leading-relaxed font-mono whitespace-pre-wrap [overflow-wrap:anywhere]">
                        {linhas.map((l, i) => (
                            <span key={i} className={/\bERRO\b|\berror\b|ERROR/i.test(l) ? "text-destructive" : /AVISO|warn/i.test(l) ? "text-amber-700 dark:text-amber-400" : undefined}>{l + "\n"}</span>
                        ))}
                    </pre>
                    <div ref={fimRef} />
                </div>
            </CardContent>
        </Card>
    );
}

// ---------------------------------------------------------------- Espaco

function AbaEspaco({ info, recarregar }: { info: InfoSistema | null; recarregar: () => void }) {
    const [ocupado, setOcupado] = useState<string | null>(null);
    const [dias, setDias] = useState("90");
    const [confirmar, setConfirmar] = useState<Item | null>(null);

    const limpar = async (item: Item) => {
        setOcupado(item.id);
        try {
            const d = await chamar("/api/system/manutencao", { method: "POST", body: JSON.stringify({ acao: "limpar", item: item.id, dias: Number(dias) }) });
            toast.success(`Liberados ${bytes(d.data?.liberados)}${d.data?.detalhe ? ` (${d.data.detalhe})` : ""}`);
            recarregar();
        } catch (e: any) { toast.error(e.message); }
        finally { setOcupado(null); setConfirmar(null); }
    };

    if (!info) return <div className="py-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
    return (
        <div className="space-y-4">
            <Card>
                <CardHeader><CardTitle className="text-base">Discos</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                    {info.espaco.discos.map((d) => (
                        <div key={d.caminho} className="space-y-1">
                            <p className="text-sm font-medium">{d.nome} <span className="text-xs text-muted-foreground font-mono">({d.caminho})</span></p>
                            <DiscoBarra livre={d.livre} total={d.total} />
                        </div>
                    ))}
                </CardContent>
            </Card>
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">O que ocupa espaço</CardTitle>
                    <CardDescription>Só itens que o sistema pode recriar ou que você escolhe apagar. Nada do banco de dados nem das sessões.</CardDescription>
                </CardHeader>
                <CardContent className="divide-y divide-border/50">
                    {info.espaco.itens.map((it) => (
                        <div key={it.id} className="py-3 flex flex-col sm:flex-row sm:items-center gap-2">
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium">{it.nome} · <span className="tabular-nums">{bytes(it.bytes)}</span></p>
                                <p className="text-xs text-muted-foreground">{it.explicacao}</p>
                                <p className="text-[11px] text-muted-foreground font-mono [overflow-wrap:anywhere]">{it.caminho}</p>
                            </div>
                            {it.limpavel && (
                                <div className="flex items-center gap-2 shrink-0">
                                    {it.id === "midia" && (
                                        <span className="flex items-center gap-1 text-xs">mais de
                                            <Input value={dias} onChange={(e) => setDias(e.target.value.replace(/\D/g, ""))} className="h-8 w-16 text-center" inputMode="numeric" /> dias
                                        </span>
                                    )}
                                    <Button size="sm" variant="outline" disabled={!!ocupado || !it.bytes} onClick={() => setConfirmar(it)}>
                                        {ocupado === it.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />} Limpar
                                    </Button>
                                </div>
                            )}
                        </div>
                    ))}
                </CardContent>
            </Card>
            <AlertDialog open={!!confirmar} onOpenChange={(o) => !o && setConfirmar(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Limpar {confirmar?.nome.toLowerCase()}?</AlertDialogTitle>
                        <AlertDialogDescription>
                            {confirmar?.id === "midia"
                                ? `Apaga as mídias com mais de ${dias} dias. Nas conversas elas viram "baixar de novo", que funciona enquanto o WhatsApp ainda guardar o arquivo. Não dá para desfazer.`
                                : confirmar?.explicacao}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={() => confirmar && limpar(confirmar)}>Limpar</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

// ---------------------------------------------------------------- pagina

export default function ManutencaoPage() {
    const { data: sessao, status } = useSession();
    const admin = (sessao?.user as any)?.role === "SUPERADMIN";
    const [info, setInfo] = useState<InfoSistema | null>(null);

    const carregar = useCallback(async () => {
        try { const d = await chamar("/api/system/manutencao"); setInfo(d.data); }
        catch (e: any) { toast.error(e.message); }
    }, []);
    useEffect(() => { if (admin) carregar(); }, [admin, carregar]);

    if (status === "loading") return null;
    if (!admin) return <div className="p-6 text-sm text-muted-foreground">Somente o Super Administrador acessa a manutenção.</div>;

    return (
        <div className="space-y-4 p-1 sm:p-2 max-w-4xl">
            <div>
                <h1 className="text-xl font-semibold flex items-center gap-2"><Wrench className="h-5 w-5 text-primary" /> Manutenção</h1>
                <p className="text-sm text-muted-foreground">Armazenamento, atualização, logs e espaço em disco, sem precisar entrar na VM.</p>
            </div>
            <Tabs defaultValue="armazenamento">
                <TabsList className="flex-wrap h-auto">
                    <TabsTrigger value="armazenamento" className="gap-1.5"><HardDrive className="h-4 w-4" /> Armazenamento</TabsTrigger>
                    <TabsTrigger value="sistema" className="gap-1.5"><Power className="h-4 w-4" /> Sistema</TabsTrigger>
                    <TabsTrigger value="logs" className="gap-1.5"><ScrollText className="h-4 w-4" /> Logs</TabsTrigger>
                    <TabsTrigger value="espaco" className="gap-1.5"><Trash2 className="h-4 w-4" /> Espaço</TabsTrigger>
                </TabsList>
                <TabsContent value="armazenamento" className="mt-4"><AbaArmazenamento /></TabsContent>
                <TabsContent value="sistema" className="mt-4"><AbaSistema info={info} recarregar={carregar} /></TabsContent>
                <TabsContent value="logs" className="mt-4"><AbaLogs /></TabsContent>
                <TabsContent value="espaco" className="mt-4"><AbaEspaco info={info} recarregar={carregar} /></TabsContent>
            </Tabs>
        </div>
    );
}
