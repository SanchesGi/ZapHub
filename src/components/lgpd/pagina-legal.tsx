import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { VERSAO_TERMOS, VIGENCIA_TERMOS } from "@/lib/termos";

// minha versao: moldura comum das paginas /terms e /privacy (texto juridico, so em pt-BR).
export function PaginaLegal({ titulo, icone, outra, children }: {
    titulo: string;
    icone: React.ReactNode;
    outra: { href: string; texto: string };
    children: React.ReactNode;
}) {
    return (
        <div className="min-h-screen bg-background relative overflow-hidden py-16 md:py-24">
            <div className="fixed top-0 left-1/4 -translate-x-1/2 -translate-y-1/2 w-[40rem] h-[40rem] bg-primary/5 dark:bg-primary/10 rounded-full blur-[120px] pointer-events-none -z-10" />
            <main className="container max-w-4xl px-4 mx-auto relative z-10">
                <Link href="/" className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground mb-8 transition-colors group rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                    <ArrowLeft className="mr-2 h-4 w-4 transition-transform group-hover:-translate-x-1" />
                    Voltar ao início
                </Link>

                <article className="glass-panel p-6 md:p-12 rounded-3xl shadow-xl shadow-black/5 dark:shadow-black/20">
                    <header className="flex items-center gap-4 mb-8">
                        <div className="p-3 bg-primary/10 rounded-2xl text-primary" aria-hidden="true">{icone}</div>
                        <div>
                            <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground">{titulo}</h1>
                            <p className="text-muted-foreground mt-2 text-sm">
                                Versão {VERSAO_TERMOS} · em vigor desde {VIGENCIA_TERMOS}
                            </p>
                        </div>
                    </header>

                    <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 mb-8 text-sm leading-relaxed text-foreground/90" role="note">
                        <strong>Este texto é um modelo.</strong> A organização que opera esta instalação deve revisá-lo, com sua assessoria jurídica, antes de adotá-lo.
                        O ZapHub é um software independente e não tem relação com o WhatsApp nem com a Meta.
                    </div>

                    <div className="prose prose-slate dark:prose-invert max-w-none prose-headings:font-bold prose-headings:tracking-tight prose-a:text-primary prose-p:leading-relaxed prose-h2:text-2xl prose-h2:mt-10 prose-h2:border-b prose-h2:pb-2">
                        {children}
                    </div>

                    <footer className="mt-12 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground border-t pt-6">
                        <span>Contato sobre o software (não para pedidos de titulares): <a className="text-primary underline" href="mailto:ailansanches@tutamail.com">ailansanches@tutamail.com</a></span>
                        <Link href={outra.href} className="text-primary underline font-medium">{outra.texto}</Link>
                    </footer>
                </article>
            </main>
        </div>
    );
}
