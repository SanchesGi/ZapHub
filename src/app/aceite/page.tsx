"use client";

// minha versao: tela de aceite dos Termos de Uso e da Politica de Privacidade (um aceite so, com versao).
// Fica fora de /dashboard e exige login. Depois de aceitar, atualiza o token da sessao e segue para o destino.
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { ExternalLink, Loader2, LogOut, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { SimboloZapHub } from "@/components/marca/logo-zaphub";
import { destinoSeguro } from "@/lib/destino-seguro";

type Termos = { versaoAtual: string; vigencia: string; precisaAceitar: boolean };

function Aceite() {
    const t = useTranslations("lgpd.accept");
    const router = useRouter();
    const params = useSearchParams();
    const { status, update } = useSession();
    const destino = destinoSeguro(params.get("callbackUrl")); // so caminho interno

    const [termos, setTermos] = useState<Termos | null>(null);
    const [erroCarga, setErroCarga] = useState(false);
    const [li, setLi] = useState(false);
    const [enviando, setEnviando] = useState(false);
    const [erro, setErro] = useState<string | null>(null);

    // sem sessao: volta para o login guardando o destino
    useEffect(() => {
        if (status === "unauthenticated") {
            router.replace(`/auth/login?callbackUrl=${encodeURIComponent(`/aceite?callbackUrl=${encodeURIComponent(destino)}`)}`);
        }
    }, [status, router, destino]);

    const carregar = useCallback(async () => {
        setErroCarga(false);
        try {
            const r = await fetch("/api/me/termos");
            const d = await r.json().catch(() => ({}));
            if (!r.ok || !d?.status) throw new Error("falhou");
            setTermos(d.data);
            // ja aceitou esta versao: nada a fazer aqui
            if (d.data && d.data.precisaAceitar === false) router.replace(destino);
        } catch {
            setErroCarga(true);
        }
    }, [router, destino]);

    useEffect(() => { if (status === "authenticated") carregar(); }, [status, carregar]);

    const aceitar = async () => {
        if (!termos || !li) return;
        setEnviando(true);
        setErro(null);
        try {
            const r = await fetch("/api/me/termos", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ versao: termos.versaoAtual }),
            });
            const d = await r.json().catch(() => ({}));
            if (!r.ok || d?.status === false) throw new Error(d?.message || d?.error || t("saveError"));
            await update({ termosVersao: termos.versaoAtual });
            // navegacao completa: o proxy relê o cookie ja atualizado
            window.location.assign(destino);
        } catch (e: any) {
            setErro(e?.message || t("saveError"));
            setEnviando(false);
        }
    };

    const carregando = status === "loading" || (status === "authenticated" && !termos && !erroCarga);

    return (
        <div className="min-h-screen bg-background relative overflow-hidden flex items-center justify-center p-4 py-10">
            <div className="absolute top-0 right-0 translate-x-1/3 -translate-y-1/4 w-[36rem] h-[36rem] bg-primary/10 rounded-full blur-[120px] pointer-events-none" />
            <main className="relative z-10 w-full max-w-xl">
                <div className="flex flex-col items-center mb-6 text-center">
                    <div className="flex h-14 w-14 mb-4 items-center justify-center rounded-2xl bg-[#0D0E10] text-[#F4A935] shadow-lg shadow-black/30 ring-1 ring-white/10">
                        <SimboloZapHub className="w-9 h-auto" />
                    </div>
                    <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">{t("title")}</h1>
                    <p className="text-muted-foreground mt-2 text-sm">{t("subtitle")}</p>
                </div>

                <div className="glass-panel rounded-3xl p-6 md:p-8 shadow-2xl shadow-black/5 dark:shadow-black/40">
                    {carregando && (
                        <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground" role="status">
                            <Loader2 className="h-5 w-5 animate-spin" /> {t("loading")}
                        </div>
                    )}

                    {erroCarga && (
                        <div className="py-6 text-center space-y-3">
                            <p className="text-sm text-destructive" role="alert">{t("loadError")}</p>
                            <Button variant="outline" onClick={carregar}>{t("retry")}</Button>
                        </div>
                    )}

                    {termos && (
                        <div className="space-y-5">
                            <p className="text-xs text-muted-foreground font-mono">
                                {t("version", { versao: termos.versaoAtual })} · {t("effective", { vigencia: termos.vigencia })}
                            </p>

                            <section aria-labelledby="resumo-termos">
                                <h2 id="resumo-termos" className="flex items-center gap-2 text-sm font-semibold text-foreground mb-2">
                                    <ScrollText className="h-4 w-4 text-primary" /> {t("summaryTitle")}
                                </h2>
                                <ul className="list-disc pl-5 space-y-1.5 text-sm text-muted-foreground leading-relaxed">
                                    <li>{t("point1")}</li>
                                    <li>{t("point2")}</li>
                                    <li>{t("point3")}</li>
                                    <li>{t("point4")}</li>
                                    <li>{t("point5")}</li>
                                </ul>
                            </section>

                            <div className="flex flex-col sm:flex-row gap-2 text-sm">
                                <Link href="/terms" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-primary underline underline-offset-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                                    {t("readTerms")} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                                </Link>
                                <Link href="/privacy" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-primary underline underline-offset-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                                    {t("readPrivacy")} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                                </Link>
                            </div>

                            <div className="flex items-start gap-3 rounded-xl border border-border/60 bg-background/50 p-3">
                                <Checkbox id="li-termos" checked={li} onCheckedChange={(v) => setLi(v === true)} className="mt-0.5" />
                                <Label htmlFor="li-termos" className="text-sm leading-snug cursor-pointer">{t("checkbox")}</Label>
                            </div>

                            {erro && (
                                <p className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm" role="alert">{erro}</p>
                            )}

                            <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-between">
                                <Button variant="ghost" onClick={() => signOut({ callbackUrl: "/auth/login" })} disabled={enviando}>
                                    <LogOut className="h-4 w-4 mr-2" /> {t("signOut")}
                                </Button>
                                <Button onClick={aceitar} disabled={!li || enviando} className="sm:min-w-48">
                                    {enviando ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> {t("submitting")}</> : t("submit")}
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* erro de carga ou carregando: ainda da para sair */}
                    {!termos && !carregando && (
                        <div className="flex justify-center mt-4">
                            <Button variant="ghost" size="sm" onClick={() => signOut({ callbackUrl: "/auth/login" })}>
                                <LogOut className="h-4 w-4 mr-2" /> {t("signOut")}
                            </Button>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}

export default function AceitePage() {
    return (
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-background"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>}>
            <Aceite />
        </Suspense>
    );
}
