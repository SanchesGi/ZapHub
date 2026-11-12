"use client";
// minha versao: pede ao navegador para entregar ao ZapHub os links whatsapp:// (os que a pagina "clique para
// conversar" do api.whatsapp.com aciona no computador). Vale por navegador; o navegador pede confirmacao.
import { useEffect, useState } from "react";
import { Link2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function AbrirLinksWhatsApp() {
    const [pode, setPode] = useState(false);
    useEffect(() => {
        setPode(typeof navigator !== "undefined" && typeof (navigator as any).registerProtocolHandler === "function" && window.isSecureContext);
    }, []);

    const registrar = () => {
        try {
            (navigator as any).registerProtocolHandler("whatsapp", `${window.location.origin}/dashboard/abrir?uri=%s`);
            toast.success("Pronto. Se o navegador perguntar, permita. Daqui em diante os links do WhatsApp abrem no ZapHub.");
        } catch (e: any) {
            toast.error(e?.message || "Este navegador não deixou registrar.");
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><Link2 className="h-5 w-5 text-primary" /> Links do WhatsApp</CardTitle>
                <CardDescription>
                    Faz os links &quot;clique para conversar&quot; (os botões &quot;Fale conosco pelo WhatsApp&quot; dos sites) abrirem a conversa no ZapHub, com o número e o texto prontos, em vez do aplicativo do WhatsApp. Vale para este navegador.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
                <Button variant="outline" className="w-full" onClick={registrar} disabled={!pode}>
                    Abrir links do WhatsApp no ZapHub
                </Button>
                {!pode && <p className="text-xs text-muted-foreground">Precisa de um navegador de computador (Chrome, Edge ou Firefox) e do painel aberto em HTTPS.</p>}
                <p className="text-xs text-muted-foreground">
                    Na página do WhatsApp, clique em &quot;Conversar&quot; (ou &quot;Continuar para a conversa&quot;). Links dentro das conversas do ZapHub já abrem aqui. Para desfazer: configurações do navegador, em &quot;Gerenciadores de protocolos&quot;.
                </p>
            </CardContent>
        </Card>
    );
}
