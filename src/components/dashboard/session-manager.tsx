'use client';

import { useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import QRCode from 'qrcode';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardFooter, CardDescription } from "@/components/ui/card";
import { useRouter } from 'next/navigation';
import { toast } from "sonner";
import { useSession as useSessaoDoPainel } from "@/components/dashboard/session-provider";
import { Label } from '@/components/ui/label';
import { Smartphone, Plus, Trash2, Settings, RefreshCw, Power, UserPlus, Lock, LockOpen, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useTranslations } from "next-intl";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

type Session = {
    id: string;
    name: string;
    sessionId: string;
    status: string;
    userId?: string;
    privada?: boolean;
    _count?: { sessionAccesses?: number };
    qr?: string | null;
    user?: {
        name: string | null;
        email: string;
    } | null;
};

export function SessionManager({ user }: { user: any }) {
    const t = useTranslations("sessions");
    const { refreshSessions } = useSessaoDoPainel();
    const [sessions, setSessions] = useState<Session[]>([]);
    const [newSessionName, setNewSessionName] = useState("");
    const [newSessionId, setNewSessionId] = useState("");
    const [loading, setLoading] = useState(false);
    const [socket, setSocket] = useState<Socket | null>(null);
    const router = useRouter();

    useEffect(() => {
        fetchSessions();

        // Init Socket
        const socketInstance = io({
            path: "/api/socket/io",
            addTrailingSlash: false,
        });

        socketInstance.on('connect', () => {
            console.log('Socket connected');
        });

        socketInstance.on('connection.update', (data: { sessionId: string, status: string, qr: string }) => {
            // Update specific session status if match
            setSessions(prev => prev.map(s => {
                if (s.sessionId === data.sessionId) {
                    return { ...s, status: data.status, qr: data.qr };
                }
                return s;
            }));

            if (data.status === 'CONNECTED') {
                fetchSessions(); // Refresh purely to get updated state from DB if needed
            }
        });

        setSocket(socketInstance);

        return () => {
            socketInstance.disconnect();
        };
    }, []);

    // minha versao: sessao privada (so o dono). Compartilhada nao vira privada (o servidor recusa e explica).
    const alternarPrivada = async (s: Session) => {
        const privada = !s.privada;
        try {
            const r = await fetch(`/api/sessions/${encodeURIComponent(s.sessionId)}/privada`, {
                method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ privada }),
            });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j?.message || "Não consegui mudar");
            toast.success(privada ? `"${s.name}" agora é privada: só você vê e usa` : `"${s.name}" deixou de ser privada`);
            fetchSessions();
            refreshSessions().catch(() => {}); // o chat (assinatura) passa a usar a marcacao nova
        } catch (e: any) {
            toast.error(e?.message || "Não consegui mudar");
        }
    };

    const fetchSessions = () => {
        fetch('/api/sessions').then(res => res.json()).then(responseData => {
            const data = responseData?.data || [];
            if (Array.isArray(data)) setSessions(data);
        });
    }

    const createSession = async () => {
        if (!newSessionName) {
            toast.error(t("nameRequired"));
            return;
        }

        // If ID matches existing
        if (newSessionId && sessions.some(s => s.sessionId === newSessionId)) {
            toast.error(t("idExists"));
            return;
        }

        setLoading(true);
        try {
            const res = await fetch('/api/sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: user.id,
                    name: newSessionName,
                    sessionId: newSessionId || undefined // Optional, backend will generate if empty
                })
            });
            const responseData = await res.json();
            const session = responseData?.data;

            if (!res.ok || !session) throw new Error(responseData.error || responseData.message || t("createdFailed"));

            setSessions([...sessions, session]);
            setNewSessionName("");
            setNewSessionId("");
            toast.success(t("createdSuccess"));

            // Optionally redirect immediately or let user choose
            // router.push(`/dashboard/sessions/${session.sessionId}`);
        } catch (e: any) {
            console.error(e);
            toast.error(e.message || t("createdFailed"));
        } finally {
            setLoading(false);
        }
    };

    const handleManageSession = (sessionId: string) => {
        router.push(`/dashboard/sessions/${sessionId}`);
    }

    return (
        <div className="space-y-8">
            {/* Create New Session Card */}
            <Card className="bg-muted/50 border-dashed border-2">
                <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                        <Plus className="h-5 w-5" /> {t("createTitle")}
                    </CardTitle>
                    <CardDescription>
                        {t("createDescription")}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                        <div className="space-y-2">
                            <Label htmlFor="session-name">{t("nameLabel")}</Label>
                            <Input
                                id="session-name"
                                value={newSessionName}
                                onChange={e => setNewSessionName(e.target.value)}
                                placeholder={t("namePlaceholder")}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="session-id">{t("customIdLabel")}</Label>
                            <Input
                                id="session-id"
                                value={newSessionId}
                                onChange={e => setNewSessionId(e.target.value.replace(/[^a-zA-Z0-9-_]/g, ''))}
                                placeholder={t("customIdPlaceholder")}
                            />
                            <p className="text-[10px] text-muted-foreground">{t("customIdHint")}</p>
                        </div>
                        <Button onClick={createSession} disabled={loading}>
                            {loading ? t("creatingButton") : t("createButton")}
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Sessions Table Card */}
            <div>
                {sessions.length === 0 ? (
                    <div className="text-center py-10 text-muted-foreground bg-muted/50 rounded-lg border border-border/50">
                        {t("empty")}
                    </div>
                ) : (
                    <Card className="glass-panel border-border/50 shadow-sm overflow-hidden">
                        <CardHeader className="pb-3 pt-5 px-5">
                            <CardTitle className="text-base font-bold text-foreground flex items-center gap-2">
                                {t("activeTitle", { count: sessions.length })}
                            </CardTitle>
                            <CardDescription>
                                {t("activeDescription")}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="p-0 overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="hover:bg-transparent">
                                        <TableHead className="px-5 text-xs uppercase tracking-wider font-semibold">{t("colDevice")}</TableHead>
                                        <TableHead className="text-xs uppercase tracking-wider font-semibold">{t("colStatus")}</TableHead>
                                        <TableHead className="text-xs uppercase tracking-wider font-semibold">{t("colOwner")}</TableHead>
                                        <TableHead className="text-right px-5 text-xs uppercase tracking-wider font-semibold">{t("colActions")}</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {sessions.map(session => (
                                        <TableRow key={session.id} className="hover:bg-muted/20 dark:hover:bg-muted/5 transition-colors">
                                            <TableCell className="px-5 py-3 font-medium">
                                                <div className="font-semibold text-foreground text-sm flex items-center gap-1.5 flex-wrap">
                                                    {session.name}
                                                    {session.privada && (
                                                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-1.5 py-0.5 text-[10px] font-semibold" title="Só o dono vê e usa esta sessão">
                                                            <Lock className="h-3 w-3" /> Privada
                                                        </span>
                                                    )}
                                                    {!session.privada && (session._count?.sessionAccesses || 0) > 0 && (
                                                        <span className="inline-flex items-center gap-1 rounded-full bg-muted text-muted-foreground px-1.5 py-0.5 text-[10px] font-semibold" title="Pessoas com acesso a esta sessão (a assinatura vem ligada)">
                                                            <Users className="h-3 w-3" /> Compartilhada ({session._count?.sessionAccesses})
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="text-[11px] text-muted-foreground font-mono mt-0.5">{session.sessionId}</div>
                                            </TableCell>
                                            <TableCell className="py-3">
                                                <Badge 
                                                    variant={session.status === 'CONNECTED' ? 'default' : 'secondary'}
                                                    className={`text-[10px] font-semibold transition-all px-2 py-0.5 shrink-0 inline-flex items-center ${
                                                        session.status === 'CONNECTED' 
                                                            ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20' 
                                                            : 'bg-muted text-muted-foreground border border-border hover:bg-muted'
                                                    }`}
                                                >
                                                    <span className={`h-1.5 w-1.5 rounded-full mr-1.5 ${
                                                        session.status === 'CONNECTED' ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground/50'
                                                    }`} />
                                                    {session.status}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="py-3">
                                                {session.user ? (
                                                    <div className="leading-tight">
                                                        <div className="font-semibold text-foreground text-xs">{session.user.name || t("noName")}</div>
                                                        <div className="text-[10px] text-muted-foreground mt-0.5">{session.user.email}</div>
                                                    </div>
                                                ) : (
                                                    <span className="text-xs text-muted-foreground/50">-</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="py-3 text-right px-5">
                                                <div className="flex items-center justify-end gap-2">
                                                    {session.userId && session.userId === user?.id && (
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="h-8 px-2.5 text-xs rounded-lg hover:bg-primary/5 transition-colors border-border/50"
                                                            title={session.privada ? "Deixar de ser privada (poderá ser compartilhada)" : "Só você verá e usará esta sessão (nem outro Super Administrador); a assinatura fica desligada"}
                                                            onClick={() => alternarPrivada(session)}
                                                        >
                                                            {session.privada ? <LockOpen className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" /> : <Lock className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />}
                                                            {session.privada ? "Tornar não privada" : "Tornar privada"}
                                                        </Button>
                                                    )}
                                                    <Button 
                                                        variant="outline" 
                                                        size="sm" 
                                                        className="h-8 px-2.5 text-xs rounded-lg hover:bg-primary/5 transition-colors border-border/50"
                                                        disabled={!!session.privada}
                                                        title={session.privada ? "Sessão privada não é compartilhada" : undefined}
                                                        onClick={() => router.push(`/dashboard/sessions/access?session=${session.sessionId}`)}
                                                    >
                                                        <UserPlus className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" /> {t("share")}
                                                    </Button>
                                                    <Button 
                                                        variant="outline" 
                                                        size="sm" 
                                                        className="h-8 px-2.5 text-xs rounded-lg hover:bg-primary/5 transition-colors border-border/50"
                                                        onClick={() => handleManageSession(session.sessionId)}
                                                    >
                                                        <Settings className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" /> {t("manage")}
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                )}
            </div>
        </div>
    );
}
