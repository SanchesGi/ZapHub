import { prisma } from "@/lib/prisma";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import {
    Plus,
    MessageSquare,
    MessageSquarePlus,
    Megaphone,
    CalendarClock,
    BookUser,
    ArrowRight,
    ArrowDownLeft,
    ArrowUpRight,
    MailWarning,
    Radio,
    HardDrive,
    ShieldAlert,
    RefreshCw,
    Wrench,
    QrCode,
} from "lucide-react";
import { statfs } from "fs/promises";

import { auth } from "@/lib/auth";
import { getAccessibleSessions } from "@/lib/api-auth";
import { verificarAtualizacao } from "@/lib/atualizacao";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import pkg from "../../../package.json";

export const dynamic = 'force-dynamic';

// minha versao: conta sem quebrar a tela se a tabela/campo ainda nao existir (cliente Prisma desatualizado)
async function contar(fn: () => Promise<number>): Promise<number> {
    try { return await fn(); } catch { return 0; }
}

function formatarBytes(b: number): string {
    const gb = b / 1024 ** 3;
    return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(b / 1024 ** 2)} MB`;
}

export default async function DashboardPage() {
    const session = await auth();
    if (!session?.user) {
        redirect("/auth/login"); // minha versao: era /login, rota que nao existe
    }

    const t = await getTranslations("dashboard");
    const role = session.user.role || "USER";
    const ehSuper = role === "SUPERADMIN";
    const nome = (session.user.name || session.user.email || "").split(" ")[0];

    const sessions = await getAccessibleSessions(session.user.id!, role);
    const totalSessions = sessions.length;
    const conectadas = sessions.filter(s => s.status === 'CONNECTED').length;
    const desconectadas = totalSessions - conectadas;

    // minha versao: numeros do dia, sempre limitados as sessoes que este usuario pode acessar
    const idsInternos = sessions.map(s => s.id);       // Message / ChatLeitura / ScheduledMessage usam Session.id
    const idsTexto = sessions.map(s => s.sessionId);   // BroadcastLog usa o sessionId em texto
    const inicioDoDia = new Date();
    inicioDoDia.setHours(0, 0, 0, 0);
    const temSessoes = idsInternos.length > 0;

    const [recebidas, enviadas, naoLidas, disparos, agendadas] = await Promise.all([
        contar(async () => temSessoes ? prisma.message.count({ where: { sessionId: { in: idsInternos }, fromMe: false, timestamp: { gte: inicioDoDia } } }) : 0),
        contar(async () => temSessoes ? prisma.message.count({ where: { sessionId: { in: idsInternos }, fromMe: true, timestamp: { gte: inicioDoDia } } }) : 0),
        contar(async () => temSessoes ? prisma.chatLeitura.count({ where: { sessionId: { in: idsInternos }, naoLida: true } }) : 0),
        contar(async () => temSessoes ? prisma.broadcastLog.count({ where: { sessionId: { in: idsTexto }, status: "running" } }) : 0),
        contar(async () => temSessoes ? prisma.scheduledMessage.count({ where: { sessionId: { in: idsInternos }, status: "PENDING" } }) : 0),
    ]);

    const numeros = [
        { titulo: t("today.received"), valor: recebidas, icone: ArrowDownLeft },
        { titulo: t("today.sent"), valor: enviadas, icone: ArrowUpRight },
        { titulo: t("today.unread"), valor: naoLidas, icone: MailWarning },
        { titulo: t("today.broadcasts"), valor: disparos, icone: Radio },
        { titulo: t("today.scheduled"), valor: agendadas, icone: CalendarClock },
    ];

    const atalhos = [
        { href: "/dashboard/chat", label: t("shortcuts.chat"), desc: t("shortcuts.chatDesc"), icone: MessageSquare },
        { href: "/dashboard/chat", label: t("shortcuts.newChat"), desc: t("shortcuts.newChatDesc"), icone: MessageSquarePlus },
        { href: "/dashboard/broadcast", label: t("shortcuts.broadcast"), desc: t("shortcuts.broadcastDesc"), icone: Megaphone },
        { href: "/dashboard/scheduler", label: t("shortcuts.scheduler"), desc: t("shortcuts.schedulerDesc"), icone: CalendarClock },
        { href: "/dashboard/contacts", label: t("shortcuts.contacts"), desc: t("shortcuts.contactsDesc"), icone: BookUser },
    ];

    // minha versao: saude do sistema, so Super Administrador (consultas locais e baratas)
    let saude: { versao: string; atualizacao: boolean; livre: number | null; pedidos: number } | null = null;
    if (ehSuper) {
        const [info, livre, pedidos] = await Promise.all([
            verificarAtualizacao(false).catch(() => null),
            statfs(process.cwd()).then(f => Number(f.bavail) * Number(f.bsize)).catch(() => null),
            contar(() => prisma.pedidoTitular.count({ where: { status: "ABERTO" } })),
        ]);
        saude = { versao: pkg.version, atualizacao: !!info?.disponivel, livre, pedidos };
    }

    const foco = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background";

    return (
        <div className="space-y-8">
            {/* Saudacao */}
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
                <div>
                    <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">{t("greeting", { name: nome })}</h2>
                    <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
                </div>
                <Button asChild size="sm" className="gap-2 self-start sm:self-auto">
                    <Link href="/dashboard/sessions"><Plus className="h-4 w-4" aria-hidden /> {t("addSession")}</Link>
                </Button>
            </div>

            {/* Sessoes */}
            <section aria-labelledby="titulo-sessoes">
                <div className="flex items-center justify-between mb-3">
                    <h3 id="titulo-sessoes" className="text-sm font-bold text-muted-foreground uppercase tracking-widest">
                        {t("sessions.title")}
                        {totalSessions > 0 && (
                            <span className="ml-2 normal-case tracking-normal font-medium">
                                {t("sessions.summary", { connected: conectadas, disconnected: desconectadas })}
                            </span>
                        )}
                    </h3>
                    <Link href="/dashboard/sessions" className={`text-xs text-primary hover:text-primary/80 font-medium flex items-center gap-1 rounded ${foco}`}>
                        {t("sessions.viewAll")} <ArrowRight size={14} aria-hidden />
                    </Link>
                </div>

                {sessions.length === 0 ? (
                    <Card className="border-dashed border-2 border-border shadow-none">
                        <CardContent className="py-12 text-center">
                            <div className="bg-muted h-12 w-12 rounded-full flex items-center justify-center mx-auto mb-3">
                                <QrCode className="h-6 w-6 text-muted-foreground" aria-hidden />
                            </div>
                            <p className="text-sm font-medium text-foreground mb-1">{t("sessions.emptyTitle")}</p>
                            <p className="text-xs text-muted-foreground mb-4">{t("sessions.emptyDescription")}</p>
                            <Button asChild size="sm" variant="outline" className="gap-2">
                                <Link href="/dashboard/sessions"><Plus className="h-4 w-4" aria-hidden /> {t("sessions.createSession")}</Link>
                            </Button>
                        </CardContent>
                    </Card>
                ) : (
                    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {sessions.map(s => {
                            const ok = s.status === 'CONNECTED';
                            return (
                                <li key={s.id}>
                                    <Card className="glass-panel border-border/50 shadow-sm h-full">
                                        <CardContent className="p-4 flex items-center justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="text-sm font-bold text-foreground truncate">{s.name}</p>
                                                <p className={`mt-1 inline-flex items-center gap-1.5 text-xs font-medium ${ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>
                                                    <span className={`h-2 w-2 rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-500'}`} aria-hidden />
                                                    {ok ? t("sessions.connected") : t("sessions.disconnected")}
                                                </p>
                                            </div>
                                            <Button asChild size="sm" variant={ok ? "ghost" : "default"} className="shrink-0">
                                                <Link href={`/dashboard/sessions/${s.sessionId}`} aria-label={`${ok ? t("sessions.manage") : t("sessions.connect")}: ${s.name}`}>
                                                    {ok ? t("sessions.manage") : t("sessions.connect")}
                                                </Link>
                                            </Button>
                                        </CardContent>
                                    </Card>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </section>

            {/* Numeros do dia */}
            <section aria-labelledby="titulo-hoje">
                <h3 id="titulo-hoje" className="text-sm font-bold text-muted-foreground uppercase tracking-widest mb-3">{t("today.title")}</h3>
                <dl className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                    {numeros.map(n => {
                        const Icone = n.icone;
                        return (
                            <Card key={n.titulo} className="glass-panel border-border/50 shadow-sm">
                                <CardContent className="p-4">
                                    <dt className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                                        <Icone className="h-4 w-4 text-primary" aria-hidden /> {n.titulo}
                                    </dt>
                                    <dd className="mt-2 text-3xl font-extrabold tabular-nums text-foreground">{n.valor}</dd>
                                </CardContent>
                            </Card>
                        );
                    })}
                </dl>
            </section>

            {/* Atalhos */}
            <section aria-labelledby="titulo-atalhos">
                <h3 id="titulo-atalhos" className="text-sm font-bold text-muted-foreground uppercase tracking-widest mb-3">{t("shortcuts.title")}</h3>
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                    {atalhos.map(a => {
                        const Icone = a.icone;
                        return (
                            <Link key={a.label} href={a.href} className={`group rounded-xl ${foco}`}>
                                <Card className="glass-panel border-border/50 shadow-sm group-hover:border-primary/50 group-hover:-translate-y-0.5 transition-all duration-200 h-full">
                                    <CardContent className="p-4">
                                        <Icone className="h-6 w-6 text-primary mb-3" aria-hidden />
                                        <p className="text-sm font-semibold text-foreground">{a.label}</p>
                                        <p className="text-xs text-muted-foreground mt-0.5">{a.desc}</p>
                                    </CardContent>
                                </Card>
                            </Link>
                        );
                    })}
                </div>
            </section>

            {/* Saude do sistema (Super Administrador) */}
            {saude && (
                <section aria-labelledby="titulo-saude">
                    <h3 id="titulo-saude" className="text-sm font-bold text-muted-foreground uppercase tracking-widest mb-3">{t("health.title")}</h3>
                    <div className="grid gap-3 sm:grid-cols-3">
                        <Link href="/dashboard/manutencao" className={`rounded-xl ${foco}`}>
                            <Card className="glass-panel border-border/50 shadow-sm hover:border-primary/50 transition-colors h-full">
                                <CardContent className="p-4">
                                    <p className="flex items-center gap-2 text-xs font-semibold text-muted-foreground"><RefreshCw className="h-4 w-4 text-primary" aria-hidden /> {t("health.version")}</p>
                                    <p className="mt-2 text-xl font-bold text-foreground">v{saude.versao}</p>
                                    <p className={`text-xs mt-1 font-medium ${saude.atualizacao ? 'text-primary' : 'text-muted-foreground'}`}>
                                        {saude.atualizacao ? t("health.updateAvailable") : t("health.upToDate")}
                                    </p>
                                </CardContent>
                            </Card>
                        </Link>
                        <Link href="/dashboard/manutencao" className={`rounded-xl ${foco}`}>
                            <Card className="glass-panel border-border/50 shadow-sm hover:border-primary/50 transition-colors h-full">
                                <CardContent className="p-4">
                                    <p className="flex items-center gap-2 text-xs font-semibold text-muted-foreground"><HardDrive className="h-4 w-4 text-primary" aria-hidden /> {t("health.space")}</p>
                                    <p className="mt-2 text-xl font-bold text-foreground">{saude.livre != null ? formatarBytes(saude.livre) : "—"}</p>
                                    <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1"><Wrench className="h-3 w-3" aria-hidden /> {t("health.openMaintenance")}</p>
                                </CardContent>
                            </Card>
                        </Link>
                        <Link href="/dashboard/privacidade" className={`rounded-xl ${foco}`}>
                            <Card className="glass-panel border-border/50 shadow-sm hover:border-primary/50 transition-colors h-full">
                                <CardContent className="p-4">
                                    <p className="flex items-center gap-2 text-xs font-semibold text-muted-foreground"><ShieldAlert className="h-4 w-4 text-primary" aria-hidden /> {t("health.requests")}</p>
                                    <p className="mt-2 text-xl font-bold tabular-nums text-foreground">{saude.pedidos}</p>
                                    <p className="text-xs text-muted-foreground mt-1">{t("health.requestsDesc")}</p>
                                </CardContent>
                            </Card>
                        </Link>
                    </div>
                </section>
            )}
        </div>
    );
}
