
"use client";

import { useState, useEffect } from "react";
import { useSession } from "@/components/dashboard/session-provider";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table";
import {
    Pagination,
    PaginationContent,
    PaginationItem,
    PaginationLink,
    PaginationNext,
    PaginationPrevious
} from "@/components/ui/pagination";

import { Search, Loader2, User, ChevronDown, MessageCircle, Pencil, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { NovaConversaDialog } from "@/components/chat/nova-conversa";
import { urlDoJid } from "@/lib/jid-url";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { SessionGuard } from "@/components/dashboard/session-guard";
import { useTranslations } from "next-intl";

interface Contact {
    id: string;
    jid: string;
    name?: string;
    notify?: string;
    verifiedName?: string;
    profilePic?: string;
    remoteJidAlt?: string;
}

export default function ContactListPage() {
    const t = useTranslations("contacts");
    const tCommon = useTranslations("common");
    const { sessionId } = useSession();
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [loading, setLoading] = useState(false);

    // Filters
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState("10");
    const [meta, setMeta] = useState({ total: 0, totalPages: 1 });
    // minha versao: dialogo de agenda / novo contato
    const router = useRouter();
    const [dlgAberto, setDlgAberto] = useState(false);
    const [dlgModo, setDlgModo] = useState<"agenda" | "numero">("numero");
    const [dlgInicial, setDlgInicial] = useState<{ numero?: string; nome?: string } | undefined>(undefined);

    // Debounce Search
    useEffect(() => {
        const timer = setTimeout(() => {
            setPage(1); // Reset to page 1 on search
            fetchContacts();
        }, 500);
        return () => clearTimeout(timer);
    }, [search]);

    // Fetch on page/session/limit change
    useEffect(() => {
        fetchContacts();
    }, [page, sessionId, limit]);

    const fetchContacts = async () => {
        if (!sessionId) return;
        setLoading(true);
        try {
            const params = new URLSearchParams({
                page: page.toString(),
                limit: limit,
                search: search
            });

            const res = await fetch(`/api/contacts/${sessionId}?${params}`);
            const data = await res.json();

            if (res.ok) {
                setContacts(data.data);
                setMeta(data.meta);
            } else {
                setContacts([]);
            }
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <SessionGuard>
            <div className="space-y-6">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <h2 className="text-3xl font-bold tracking-tight">{t("title")}</h2>
                        <p className="text-muted-foreground">
                            {t("subtitle")}
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" className="gap-1.5" onClick={() => { setDlgInicial(undefined); setDlgModo("agenda"); setDlgAberto(true); }}>
                            <MessageCircle className="h-4 w-4" /> Mandar mensagem
                        </Button>
                        <Button className="gap-1.5" onClick={() => { setDlgInicial(undefined); setDlgModo("numero"); setDlgAberto(true); }}>
                            <UserPlus className="h-4 w-4" /> Novo contato
                        </Button>
                    </div>
                </div>
                {sessionId && (
                    <NovaConversaDialog sessionId={sessionId} open={dlgAberto} onOpenChange={setDlgAberto}
                        modo={dlgInicial ? "numero" : dlgModo} inicial={dlgInicial} onSalvo={() => fetchContacts()} />
                )}

                <Card>
                    <CardHeader>
                        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                            <div className="space-y-1">
                                <CardTitle>{t("cardTitle")}</CardTitle>
                                <CardDescription>
                                    {t("totalContacts", { total: meta.total })}
                                </CardDescription>
                            </div>
                            <div className="flex items-center gap-2 w-full md:w-auto">
                                <Select value={limit} onValueChange={(val) => { setLimit(val); setPage(1); }}>
                                    <SelectTrigger className="w-[120px]">
                                        <SelectValue placeholder={t("perPagePlaceholder")} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {[10, 25, 50, 100].map((l) => (
                                            <SelectItem key={l} value={l.toString()}>
                                                {t("perPage", { count: l })}
                                            </SelectItem>
                                        ))}
                                        <SelectItem value="all">{t("showAll")}</SelectItem>
                                    </SelectContent>
                                </Select>
                                <div className="relative w-full md:w-64">
                                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        placeholder={t("searchPlaceholder")}
                                        className="pl-8"
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                    />
                                </div>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="rounded-md border">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-[80px]">{t("colImage")}</TableHead>
                                        <TableHead>{t("colName")}</TableHead>
                                        <TableHead className="hidden md:table-cell">{t("colJid")}</TableHead>
                                        <TableHead className="hidden md:table-cell">{t("colPhone")}</TableHead>
                                        <TableHead className="text-right">Ações</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {loading ? (
                                        <TableRow>
                                            <TableCell colSpan={5} className="h-24 text-center">
                                                <div className="flex justify-center items-center gap-2">
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                    {tCommon("loading")}
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ) : contacts.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={5} className="h-24 text-center">
                                                {t("empty")}
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        contacts.map((contact) => (
                                            <TableRow key={contact.id}>
                                                <TableCell>
                                                    <Avatar>
                                                        <AvatarImage src={contact.profilePic || ""} />
                                                        <AvatarFallback><User className="h-4 w-4" /></AvatarFallback>
                                                    </Avatar>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex flex-col">
                                                        <span className="font-medium">{contact.name || contact.notify || tCommon("unknown")}</span>
                                                        {contact.verifiedName && (
                                                            <span className="text-xs text-green-700 dark:text-green-400 flex items-center gap-1">
                                                                ✓ {contact.verifiedName}
                                                            </span>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="hidden md:table-cell font-mono text-sm text-muted-foreground">
                                                    {contact.jid}
                                                </TableCell>
                                                <TableCell className="hidden md:table-cell text-sm">
                                                    {contact.remoteJidAlt || "-"}
                                                </TableCell>
                                                <TableCell className="text-right whitespace-nowrap">
                                                    {/* minha versao: conversar / editar direto da agenda */}
                                                    {(contact.jid.endsWith("@s.whatsapp.net") || contact.jid.endsWith("@lid")) && (
                                                        <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={() => router.push(`/dashboard/chat/${urlDoJid(contact.jid)}`)}>
                                                            <MessageCircle className="h-4 w-4" /> <span className="hidden sm:inline">Conversar</span>
                                                        </Button>
                                                    )}
                                                    {contact.jid.endsWith("@s.whatsapp.net") && (
                                                        <Button variant="ghost" size="sm" className="h-8 gap-1.5" title={contact.name ? "Editar nome" : "Salvar na agenda"}
                                                            onClick={() => { setDlgInicial({ numero: "+" + contact.jid.split("@")[0], nome: contact.name || contact.notify || "" }); setDlgAberto(true); }}>
                                                            {contact.name ? <Pencil className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
                                                        </Button>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>

                        {/* Pagination */}
                        {meta.totalPages > 1 && (
                            <div className="mt-4">
                                <Pagination>
                                    <PaginationContent>
                                        <PaginationItem>
                                            <Button
                                                variant="ghost"
                                                disabled={page <= 1}
                                                onClick={() => setPage(p => Math.max(1, p - 1))}
                                            >
                                                {tCommon("previous")}
                                            </Button>
                                        </PaginationItem>

                                        <PaginationItem>
                                            <span className="text-sm text-muted-foreground mx-4">
                                                {t("pageInfo", { page, totalPages: meta.totalPages })}
                                            </span>
                                        </PaginationItem>

                                        <PaginationItem>
                                            <Button
                                                variant="ghost"
                                                disabled={page >= meta.totalPages}
                                                onClick={() => setPage(p => Math.min(meta.totalPages, p + 1))}
                                            >
                                                {tCommon("next")}
                                            </Button>
                                        </PaginationItem>
                                    </PaginationContent>
                                </Pagination>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </SessionGuard>
    );
}
