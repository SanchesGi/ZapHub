"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Plus, Edit, User, Shield, ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface UserProfile {
    id: string;
    name: string | null;
    email: string;
    role: "SUPERADMIN" | "STAFF" | "USER";
    createdAt: string;
    supervisorId?: string | null;
    supervisor?: { id: string; name: string | null; email: string } | null;
    _count?: {
        sessions: number;
    }
}

export default function UsersPage() {
    const t = useTranslations("users");
    const tCommon = useTranslations("common");
    const { data: session } = useSession();
    // minha versao: Supervisor so cria/edita/remove usuarios da Equipe; papeis so o Super Administrador muda
    const souAdmin = (session?.user as any)?.role === "SUPERADMIN";
    const meuId = (session?.user as any)?.id;
    const podeMexer = (u: UserProfile) => souAdmin || u.role === "USER" || u.id === meuId; // a API ja devolve so a equipe do Supervisor
    const nomePapel = (r: string) => r === "SUPERADMIN" ? t("roleSuperadmin") : r === "STAFF" ? t("roleStaff") : t("roleUser");
    const [users, setUsers] = useState<UserProfile[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [editingUser, setEditingUser] = useState<UserProfile | null>(null);

    // Form state
    const [formData, setFormData] = useState({
        name: "",
        email: "",
        password: "",
        role: "USER",
        supervisorId: "" as string
    });
    const supervisores = users.filter((u) => u.role === "STAFF");

    useEffect(() => {
        fetchUsers();
    }, []);

    const fetchUsers = async () => {
        try {
            const res = await fetch("/api/users");
            if (res.ok) {
                const responseData = await res.json();
                setUsers(responseData?.data || []);
            } else if (res.status === 403) {
                toast.error(t("unauthorizedSuperAdmin"));
            }
        } catch (error) {
            console.error("Failed to fetch users", error);
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        try {
            const url = editingUser ? `/api/users/${editingUser.id}` : "/api/users";
            const method = editingUser ? "PATCH" : "POST";

            const res = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                // supervisorId so vai quando e o Super Administrador (o Supervisor ja coloca na propria equipe)
                body: JSON.stringify(souAdmin ? { ...formData, supervisorId: formData.role === "USER" ? (formData.supervisorId || null) : null } : { name: formData.name, email: formData.email, password: formData.password, role: formData.role })
            });

            if (res.ok) {
                toast.success(editingUser ? t("userUpdated") : t("userCreated"));
                setShowForm(false);
                setEditingUser(null);
                setFormData({ name: "", email: "", password: "", role: "USER", supervisorId: "" });
                fetchUsers();
            } else {
                const error = await res.json();
                toast.error(error.message || error.error || "A operação falhou");
            }
        } catch (error) {
            toast.error("A operação falhou");
        }
    };

    const [deleteId, setDeleteId] = useState<string | null>(null);

    const handleDelete = async (id: string) => {
        setDeleteId(id);
    };

    const confirmDelete = async () => {
        if (!deleteId) return;

        try {
            const res = await fetch(`/api/users/${deleteId}`, { method: "DELETE" });
            if (res.ok) {
                toast.success(t("userDeleted"));
                fetchUsers();
            } else {
                const error = await res.json();
                toast.error(error.error || "Failed to delete");
            }
        } catch (error) {
            toast.error("Falha ao excluir o usuário");
        } finally {
            setDeleteId(null);
        }
    };

    const getRoleIcon = (role: string) => {
        switch (role) {
            case "SUPERADMIN": return <ShieldAlert className="h-4 w-4 text-primary" />;
            case "STAFF": return <ShieldCheck className="h-4 w-4 text-foreground" />;
            default: return <User className="h-4 w-4 text-muted-foreground" />;
        }
    };

    if (loading) return <div className="p-8 text-center text-muted-foreground">{tCommon("loading")}</div>;

    // TODO: Improve RBAC check here if strictly needed, but API protects it.
    // If empty list and not loading, likely unauthorized or empty.

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div>
                    <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
                        <UsersIcon className="h-5 w-5 sm:h-6 sm:w-6" /> {t("title")}
                    </h1>
                    <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
                </div>
                <Button size="sm" onClick={() => {
                    setEditingUser(null);
                    setFormData({ name: "", email: "", password: "", role: "USER", supervisorId: "" });
                    setShowForm(true);
                }}>
                    <Plus className="h-4 w-4 mr-1 sm:mr-2" /> {t("addUser")}
                </Button>
            </div>

            {/* User Form Modal/Card */}
            {showForm && (
                <Card className="border-2 border-primary/20">
                    <CardHeader>
                        <CardTitle>{editingUser ? t("editUser") : t("newUser")}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                                <div className="space-y-2">
                                    <Label>{t("name")}</Label>
                                    <Input
                                        value={formData.name}
                                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                                        required
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>{t("email")}</Label>
                                    <Input
                                        type="email"
                                        value={formData.email}
                                        onChange={e => setFormData({ ...formData, email: e.target.value })}
                                        required
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                                <div className="space-y-2">
                                    <Label>{editingUser ? t("newPasswordHint") : t("password")}</Label>
                                    <Input
                                        type="password"
                                        value={formData.password}
                                        onChange={e => setFormData({ ...formData, password: e.target.value })}
                                        required={!editingUser}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>{t("colRole")}</Label>
                                    <Select
                                        value={formData.role}
                                        onValueChange={(v: string) => setFormData({ ...formData, role: v })}
                                        disabled={!souAdmin}
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {souAdmin && <SelectItem value="SUPERADMIN">{t("roleSuperadmin")}</SelectItem>}
                                            {(souAdmin || formData.role === "STAFF") && <SelectItem value="STAFF">{t("roleStaff")}</SelectItem>}
                                            <SelectItem value="USER">{t("roleUser")}</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <p className="text-[11px] text-muted-foreground leading-snug">
                                        {formData.role === "SUPERADMIN" ? "Acesso total: todas as sessões, usuários e configurações do sistema."
                                            : formData.role === "STAFF" ? "Supervisor: cria e gerencia usuários da Equipe, adiciona pessoas às sessões a que tem acesso e gerencia essas sessões (ligar/desligar, bot, respostas automáticas, agendamentos, disparos, webhooks). Vê a Auditoria delas."
                                            : "Equipe: conversa nas sessões compartilhadas com ela e pode conectar o próprio WhatsApp (sessão pessoal, que ninguém mais vê)."}
                                        {!souAdmin && " Só o Super Administrador muda o papel."}
                                    </p>
                                    {souAdmin && formData.role === "USER" && (
                                        <div className="space-y-1 pt-1">
                                            <Label className="text-xs">Supervisor responsável</Label>
                                            <Select value={formData.supervisorId || "nenhum"} onValueChange={(v: string) => setFormData({ ...formData, supervisorId: v === "nenhum" ? "" : v })}>
                                                <SelectTrigger><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="nenhum">Sem supervisor</SelectItem>
                                                    {supervisores.map((s) => <SelectItem key={s.id} value={s.id}>{s.name || s.email}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                            <p className="text-[11px] text-muted-foreground">O Supervisor vê a Auditoria desta pessoa e gerencia o cadastro dela.{supervisores.length === 0 ? " (Ainda não há nenhum Supervisor: mude o papel de alguém para Supervisor.)" : ""}</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="flex justify-end gap-2">
                                <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>{tCommon("cancel")}</Button>
                                <Button type="submit">{editingUser ? tCommon("save") : tCommon("create")}</Button>
                            </div>
                        </form>
                    </CardContent>
                </Card>
            )}

            {/* Users Table */}
            <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                {users.map(user => (
                    <Card key={user.id} className="overflow-hidden">
                        <CardContent className="p-0">
                            <div className="p-6">
                                <div className="flex justify-between items-start mb-4">
                                    <div className="flex items-center gap-3">
                                        <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center font-bold text-muted-foreground">
                                            {user.name?.charAt(0) || user.email.charAt(0)}
                                        </div>
                                        <div>
                                            <h3 className="font-semibold">{user.name || "User"}</h3>
                                            <p className="text-xs text-muted-foreground">{user.email}</p>
                                        </div>
                                    </div>
                                    <Badge variant="outline" className="flex items-center gap-1">
                                        {getRoleIcon(user.role)}
                                        {nomePapel(user.role)}
                                    </Badge>
                                </div>

                                <div className="flex justify-between items-center text-sm text-muted-foreground">
                                    <span>
                                        {user._count ? t("sessionsCountPlain", { count: user._count.sessions || 0 }) : ""}
                                        {user.role === "USER" && (
                                            <span className="block text-[11px]">{user.supervisor ? `Supervisor: ${user.supervisor.name || user.supervisor.email}` : souAdmin ? "Sem supervisor" : ""}</span>
                                        )}
                                    </span>
                                    <span>{t("joined", { date: new Date(user.createdAt).toLocaleDateString() })}</span>
                                </div>
                            </div>
                            {podeMexer(user) && <div className="bg-muted/40 p-3 flex justify-end gap-2 border-t">
                                <Button size="sm" variant="ghost" onClick={() => {
                                    setEditingUser(user);
                                    setFormData({
                                        name: user.name || "",
                                        email: user.email,
                                        password: "",
                                        role: user.role,
                                        supervisorId: user.supervisorId || ""
                                    });
                                    setShowForm(true);
                                }}>
                                    <Edit className="h-4 w-4 mr-1" /> {tCommon("edit")}
                                </Button>
                                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => handleDelete(user.id)}>
                                    <Trash2 className="h-4 w-4 mr-1" /> {tCommon("delete")}
                                </Button>
                            </div>}
                        </CardContent>
                    </Card>
                ))}
            </div>
            {/* Confirmation Dialog */}
            <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t("deleteConfirmTitle")}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t("deleteConfirmDescription")}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{tCommon("delete")}</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

function UsersIcon(props: any) {
    return (
        <svg
            {...props}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
    )
}
