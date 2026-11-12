"use client";

// minha versao: links nas mensagens.
//  - TextoComLinks: o texto com os links clicaveis (abrem em outra aba) e quebrando dentro do balao;
//    antes um link comprido nao quebrava e estourava a tela.
//  - PreviaLinkCartao: titulo, descricao e miniatura do primeiro link. Usa a previa que veio com a mensagem
//    (WhatsApp ou envio pelo painel); sem ela, pede ao servidor quando o balao aparece na tela.
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { lerLinkWhatsApp, enderecoParaAbrir } from "@/lib/link-whatsapp";

export type PreviaLink = { url: string; titulo: string | null; descricao: string | null; site: string | null; miniatura: string | null };

const RE_LINKS = /\b(?:https?:\/\/|www\.)[^\s<>"']{2,2000}/gi;

/** so http(s); "www." vira https://. Qualquer outra coisa (javascript:, data:...) nao vira link */
export function hrefSeguro(bruto: string): string | null {
    const s = /^www\./i.test(bruto) ? `https://${bruto}` : bruto;
    try {
        const u = new URL(s);
        return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
    } catch {
        return null;
    }
}

/** separa a pontuacao do fim (ponto final, virgula, parentese que fecha frase) do link */
function aparar(url: string): [string, string] {
    let fim = "";
    while (/[.,;:!?)\]}*_~]$/.test(url)) {
        if (url.endsWith(")") && (url.match(/\(/g) || []).length >= (url.match(/\)/g) || []).length) break;
        fim = url.slice(-1) + fim;
        url = url.slice(0, -1);
    }
    return [url, fim];
}

export function TextoComLinks({ texto, fromMe }: { texto: string | null | undefined; fromMe: boolean }) {
    if (!texto) return null;
    const partes: React.ReactNode[] = [];
    let ultimo = 0;
    for (const m of texto.matchAll(RE_LINKS)) {
        const inicio = m.index ?? 0;
        const [url, sobra] = aparar(m[0]);
        const href = hrefSeguro(url);
        if (!href) continue;
        if (inicio > ultimo) partes.push(texto.slice(ultimo, inicio));
        // minha versao: link "clique para conversar" do WhatsApp abre a conversa aqui no ZapHub
        const doWhatsApp = lerLinkWhatsApp(href)?.numero ? enderecoParaAbrir(href) : null;
        partes.push(
            <a key={inicio} href={doWhatsApp || href} target="_blank" rel="noopener noreferrer nofollow" title={doWhatsApp ? "Abrir esta conversa no ZapHub (nova aba)" : undefined}
                onClick={(e) => e.stopPropagation()}
                className={cn("underline underline-offset-2 [overflow-wrap:anywhere]", fromMe ? "text-primary-foreground decoration-primary-foreground/60" : "text-primary decoration-primary/50")}>
                {url}
            </a>,
        );
        if (sobra) partes.push(sobra);
        ultimo = inicio + m[0].length;
    }
    if (ultimo < texto.length) partes.push(texto.slice(ultimo));
    return <>{partes}</>;
}

export function primeiroLinkDoTexto(texto: string | null | undefined): string | null {
    if (!texto) return null;
    RE_LINKS.lastIndex = 0;
    const m = RE_LINKS.exec(texto);
    RE_LINKS.lastIndex = 0;
    return m ? hrefSeguro(aparar(m[0])[0]) : null;
}

// cache no navegador (por url) para nao pedir de novo a cada rolagem
const cache = new Map<string, PreviaLink | null | Promise<PreviaLink | null>>();
function buscarPrevia(url: string): Promise<PreviaLink | null> {
    const c = cache.get(url);
    if (c !== undefined) return Promise.resolve(c);
    const p = fetch(`/api/link-preview?url=${encodeURIComponent(url)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => (d?.data as PreviaLink) || null)
        .catch(() => null)
        .then((v) => { cache.set(url, v); return v; });
    cache.set(url, p);
    return p;
}

export function PreviaLinkCartao({ previa, texto, fromMe }: { previa?: PreviaLink | null; texto: string | null | undefined; fromMe: boolean }) {
    const ref = useRef<HTMLDivElement>(null);
    const url = previa?.url ? hrefSeguro(previa.url) : primeiroLinkDoTexto(texto);
    const [dados, setDados] = useState<PreviaLink | null>(previa || null);

    useEffect(() => {
        if (previa || !url || !ref.current) return;
        let vivo = true;
        const el = ref.current;
        const io = new IntersectionObserver((ents) => {
            if (!ents.some((e) => e.isIntersecting)) return;
            io.disconnect();
            buscarPrevia(url)
                .then((p) => { if (vivo) setDados(p); })
                .catch(() => { /* sem previa: o balao fica so com o texto */ });
        }, { rootMargin: "200px" });
        io.observe(el);
        return () => { vivo = false; io.disconnect(); };
    }, [previa, url]);

    if (!url) return null;
    const href = hrefSeguro(dados?.url || url) || url;
    const miniatura = dados?.miniatura && dados.miniatura.startsWith("data:image/") ? dados.miniatura : null;
    return (
        <div ref={ref} className="min-w-0">
            {dados && (dados.titulo || dados.descricao) && (
                <a href={href} target="_blank" rel="noopener noreferrer nofollow" onClick={(e) => e.stopPropagation()}
                    className={cn("mb-1.5 flex gap-2 overflow-hidden rounded-lg border-l-4 p-1.5 no-underline transition-colors",
                        fromMe ? "border-primary-foreground/40 bg-primary-foreground/10 hover:bg-primary-foreground/15" : "border-primary bg-muted/60 hover:bg-muted")}>
                    {miniatura && <img src={miniatura} alt="" className="h-14 w-14 shrink-0 rounded-md object-cover" loading="lazy" />}
                    <span className="min-w-0 flex-1">
                        {dados.titulo && <span className="block text-xs font-semibold line-clamp-2 [overflow-wrap:anywhere]">{dados.titulo}</span>}
                        {dados.descricao && <span className={cn("block text-[11px] line-clamp-2 [overflow-wrap:anywhere]", fromMe ? "text-primary-foreground/80" : "text-muted-foreground")}>{dados.descricao}</span>}
                        {dados.site && <span className={cn("block text-[10px] truncate", fromMe ? "text-primary-foreground/70" : "text-muted-foreground")}>{dados.site}</span>}
                    </span>
                </a>
            )}
        </div>
    );
}
