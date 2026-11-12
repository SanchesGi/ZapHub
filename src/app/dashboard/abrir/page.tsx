"use client";
// minha versao: abre no ZapHub um link "clique para conversar" do WhatsApp.
//   /dashboard/abrir?url=https://api.whatsapp.com/send/?phone=...&text=...
//   /dashboard/abrir?uri=whatsapp://send?phone=...   (navegador, com o ZapHub registrado para links whatsapp:)
//   /dashboard/abrir?phone=5543999998888&text=Ola
// Mostra numero, sessao e texto e so abre a conversa com o clique em "Abrir conversa" (qualquer site pode montar
// um link destes). O numero do link e internacional, como no WhatsApp; so se ele nao existir e parecer brasileiro
// sem o 55 (10 ou 11 digitos) tenta com 55. O texto vai para o campo da conversa (sessionStorage); nunca e enviado.
import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, MessageCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession as useSessaoDoPainel } from "@/components/dashboard/session-provider";
import { conferirNumero } from "@/components/chat/nova-conversa";
import { lerLinkWhatsApp, guardarTextoDoLink } from "@/lib/link-whatsapp";
import { urlDoJid } from "@/lib/jid-url";
import { formatarTelefone } from "@/components/chat/chat-info-panel";

async function resolverNumero(sessionId: string, digitos: string): Promise<string> {
    try {
        return await conferirNumero(sessionId, digitos);
    } catch (e) {
        // numero brasileiro sem o 55 (ex.: 43999998888)? tenta de novo com o 55
        if ((digitos.length === 10 || digitos.length === 11) && !digitos.startsWith("55")) {
            return conferirNumero(sessionId, `55${digitos}`);
        }
        throw e;
    }
}

function Abrir() {
    const params = useSearchParams();
    const router = useRouter();
    const { sessionId, sessions, loading } = useSessaoDoPainel();
    const [abrindo, setAbrindo] = useState(false);
    const [erro, setErro] = useState<string | null>(null);

    const lido = useMemo(() => {
        const link = params.get("uri") || params.get("url");
        if (link) return lerLinkWhatsApp(link);
        const phone = params.get("phone");
        if (!phone) return null;
        const d = phone.replace(/\D/g, "");
        return { numero: d.length >= 8 && d.length <= 15 ? d : null, texto: (params.get("text") || "").slice(0, 4096) };
    }, [params]);

    const sessao = sessions.find((s) => s.sessionId === sessionId);

    const abrir = async () => {
        if (!lido?.numero || !sessionId) return;
        setAbrindo(true);
        setErro(null);
        try {
            const jid = await resolverNumero(sessionId, lido.numero);
            if (lido.texto) guardarTextoDoLink(jid, lido.texto);
            router.replace(`/dashboard/chat/${urlDoJid(jid)}`);
        } catch (e: any) {
            setErro(e?.message || "Não consegui abrir a conversa.");
            setAbrindo(false);
        }
    };

    if (loading) {
        return <div className="flex min-h-[40vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
    }
    if (!lido) {
        return <Aviso titulo="Link inválido" erro><p>Este endereço não é um link de conversa do WhatsApp.</p><Voltar /></Aviso>;
    }
    if (!lido.numero) {
        return (
            <Aviso titulo="O link não tem número">
                <p>Ele só traz um texto para compartilhar. Escolha a conversa e cole:</p>
                <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-muted p-3 text-sm text-foreground">{lido.texto || "(vazio)"}</pre>
                {lido.texto && <Button className="mt-3" variant="outline" onClick={() => navigator.clipboard?.writeText(lido.texto).catch(() => {})}>Copiar texto</Button>}
            </Aviso>
        );
    }
    if (!sessao) {
        return <Aviso titulo="Escolha uma sessão" erro><p>Selecione a sessão na barra superior e abra o link de novo.</p><Voltar /></Aviso>;
    }

    return (
        <Aviso titulo="Abrir conversa no ZapHub">
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
                <dt className="text-muted-foreground">Número</dt>
                <dd className="font-mono text-foreground">+{lido.numero}{formatarTelefone(lido.numero) ? ` (${formatarTelefone(lido.numero)})` : ""}</dd>
                <dt className="text-muted-foreground">Sessão</dt>
                <dd className="text-foreground">{sessao.name}</dd>
            </dl>
            {lido.texto && (
                <>
                    <p className="mt-3">Texto que vai ficar no campo (você revisa e envia):</p>
                    <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-muted p-3 text-sm text-foreground">{lido.texto}</pre>
                </>
            )}
            {erro && <p className="mt-3 text-destructive">{erro}</p>}
            <div className="mt-4 flex gap-2">
                <Button onClick={abrir} disabled={abrindo}>
                    {abrindo ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MessageCircle className="mr-2 h-4 w-4" />} Abrir conversa
                </Button>
                <Voltar />
            </div>
        </Aviso>
    );
}

function Voltar() {
    const router = useRouter();
    return <Button variant="outline" className="mt-0" onClick={() => router.push("/dashboard/chat")}>Ir para as conversas</Button>;
}

function Aviso({ titulo, erro, children }: { titulo: string; erro?: boolean; children: React.ReactNode }) {
    const Icone = erro ? AlertCircle : MessageCircle;
    return (
        <div className="mx-auto mt-12 max-w-lg rounded-xl border bg-card p-6 text-sm text-muted-foreground">
            <div className="mb-2 flex items-center gap-2 font-semibold text-foreground">
                <Icone className={erro ? "h-5 w-5 text-destructive" : "h-5 w-5 text-primary"} /> {titulo}
            </div>
            {children}
        </div>
    );
}

export default function AbrirLinkPage() {
    return (
        <Suspense fallback={null}>
            <Abrir />
        </Suspense>
    );
}
