// minha versao: secoes da pagina publica do ZapHub (texto fixo em pt-BR, como a pagina anterior).
import Link from "next/link";
import { ArrowRight, Github, MessagesSquare, Users, Workflow, Webhook, ShieldCheck, Wrench, Lock, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LogoZapHub } from "@/components/marca/logo-zaphub";
import { DiagramaHub } from "./diagrama-hub";

import { GITHUB_AUTOR, arquivoNoRepositorio } from "@/lib/projeto";
const FOCO = "rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function Cabecalho() {
    return (
        <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur">
            <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 md:px-6">
                <Link href="/" aria-label="ZapHub, início" className={FOCO}>
                    <LogoZapHub className="text-xl md:text-2xl" />
                </Link>
                <nav aria-label="Seções da página" className="hidden items-center gap-7 text-sm font-medium text-muted-foreground md:flex">
                    <a href="#recursos" className={`hover:text-foreground ${FOCO}`}>Recursos</a>
                    <a href="#comecar" className={`hover:text-foreground ${FOCO}`}>Como começar</a>
                    <Link href="/docs" className={`hover:text-foreground ${FOCO}`}>API</Link>
                    <a href={GITHUB_AUTOR} target="_blank" rel="noopener noreferrer" className={`flex items-center gap-1.5 hover:text-foreground ${FOCO}`}>
                        <Github className="h-4 w-4" aria-hidden /> GitHub
                    </a>
                </nav>
                <Button asChild size="sm" className="rounded-lg px-5">
                    <Link href="/auth/login">Entrar</Link>
                </Button>
            </div>
        </header>
    );
}

export function Hero() {
    return (
        <section className="relative overflow-hidden">
            <div aria-hidden className="pointer-events-none absolute inset-0 chat-fundo opacity-60 [mask-image:linear-gradient(to_bottom,black,transparent_85%)]" />
            <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 md:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:py-24">
                <div>
                    <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 font-mono text-xs font-semibold text-primary">
                        <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
                        Código aberto · instalado no seu servidor
                    </p>
                    <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight text-foreground sm:text-5xl lg:text-6xl">
                        Atendimento por WhatsApp para a sua equipe,{" "}
                        <span className="text-primary">com os dados na sua mão.</span>
                    </h1>
                    <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
                        O ZapHub é um painel de atendimento que você instala no próprio servidor. Sem depender de terceiros:
                        conversas, contatos e arquivos ficam com quem instala.
                    </p>
                    <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                        <Button asChild size="lg" className="h-12 rounded-lg px-7 text-base">
                            <Link href="/auth/login">
                                Entrar no painel <ArrowRight className="ml-2 h-5 w-5" aria-hidden />
                            </Link>
                        </Button>
                        <Button asChild size="lg" variant="outline" className="h-12 rounded-lg px-7 text-base">
                            <a href="#comecar">Como começar</a>
                        </Button>
                    </div>
                </div>
                <DiagramaHub className="mx-auto w-full max-w-md lg:max-w-none" />
            </div>
        </section>
    );
}

const BLOCOS = [
    { icone: MessagesSquare, titulo: "Conversas em tempo real", texto: "Veja e responda as conversas ao vivo, com mídias, respostas, reações e etiquetas, direto do navegador." },
    { icone: Users, titulo: "Várias sessões e atendentes", texto: "Conecte vários números e distribua o acesso entre as pessoas da equipe, cada uma vendo só o que lhe cabe." },
    { icone: Workflow, titulo: "Automação", texto: "Disparos para listas, mensagens interativas, agendador e respostas automáticas por palavra-chave." },
    { icone: Webhook, titulo: "Integração", texto: "API REST documentada e webhooks para ligar o ZapHub aos seus sistemas e receber eventos na hora." },
    { icone: ShieldCheck, titulo: "Segurança", texto: "Papéis de acesso, verificação em duas etapas (2FA) e trilha de auditoria de quem fez o quê." },
    { icone: Wrench, titulo: "Manutenção pelo painel", texto: "Atualização, espaço em disco, pasta de mídia e logs sem precisar entrar no servidor." },
    { icone: Lock, titulo: "Privacidade e LGPD", texto: "Aceite dos termos, página Meus dados, pedidos de titulares e retenção configurável das mensagens." },
];

export function Recursos() {
    return (
        <section id="recursos" className="scroll-mt-20 border-y border-border bg-muted/40 py-16 lg:py-24">
            <div className="mx-auto max-w-6xl px-4 md:px-6">
                <h2 className="max-w-2xl text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                    Tudo o que uma equipe precisa para atender bem
                </h2>
                <p className="mt-3 max-w-2xl text-muted-foreground">
                    Um painel só para conversar, automatizar e integrar, sem mandar seus clientes para a nuvem de outra empresa.
                </p>
                <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {BLOCOS.map((b, i) => {
                        const Icone = b.icone;
                        return (
                            <li key={b.titulo} className="relative rounded-xl border border-border bg-card p-6 pl-7 shadow-sm">
                                <span aria-hidden className="absolute inset-y-4 left-0 w-1 rounded-r bg-primary" />
                                <div className="mb-4 flex items-center justify-between">
                                    <Icone className="h-6 w-6 text-primary" aria-hidden />
                                    <span aria-hidden className="font-mono text-xs text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                                </div>
                                <h3 className="text-lg font-bold text-foreground">{b.titulo}</h3>
                                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{b.texto}</p>
                            </li>
                        );
                    })}
                </ul>
            </div>
        </section>
    );
}

export function ComoComecar() {
    const passos = [
        { n: "1", t: "Instale no seu servidor", d: "Siga o guia de instalação do zero: banco de dados, certificado e serviço." },
        { n: "2", t: "Crie sua conta e entre", d: "A primeira conta vira Super Administrador e libera o painel." },
        { n: "3", t: "Conecte o WhatsApp", d: "Leia o QR Code com o celular e comece a atender." },
    ];
    return (
        <section id="comecar" className="scroll-mt-20 mx-auto max-w-6xl px-4 py-16 md:px-6 lg:py-24">
            <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Como começar</h2>
            <ol className="mt-8 grid gap-4 md:grid-cols-3">
                {passos.map((p) => (
                    <li key={p.n} className="flex gap-4 rounded-xl border border-border bg-card p-5">
                        <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary font-mono text-sm font-bold text-primary-foreground">{p.n}</span>
                        <div>
                            <h3 className="font-bold text-foreground">{p.t}</h3>
                            <p className="mt-1 text-sm text-muted-foreground">{p.d}</p>
                        </div>
                    </li>
                ))}
            </ol>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg" className="rounded-lg">
                    <a href={arquivoNoRepositorio("docs/INSTALACAO.md")} target="_blank" rel="noopener noreferrer">Guia de instalação</a>
                </Button>
                <Button asChild size="lg" variant="outline" className="rounded-lg">
                    <a href={GITHUB_AUTOR} target="_blank" rel="noopener noreferrer"><Github className="mr-2 h-4 w-4" aria-hidden /> Código no GitHub</a>
                </Button>
            </div>

            <div role="note" className="mt-12 flex gap-3 rounded-xl border border-primary/40 bg-primary/10 p-4 text-sm text-foreground">
                <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
                <p>
                    <strong>Uso não oficial.</strong> O ZapHub se conecta ao WhatsApp por um meio não oficial. A Meta pode limitar ou
                    banir números que enviem spam ou abusem da automação. Use com consentimento de quem recebe e por sua conta e risco.
                </p>
            </div>
        </section>
    );
}

export function Rodape() {
    const link = `text-muted-foreground hover:text-foreground ${FOCO}`;
    return (
        <footer className="border-t border-border bg-muted/40 py-10">
            <div className="mx-auto max-w-6xl space-y-6 px-4 text-sm md:px-6">
                <div className="flex flex-col justify-between gap-5 md:flex-row md:items-center">
                    <LogoZapHub className="text-xl" />
                    <nav aria-label="Rodapé" className="flex flex-wrap gap-x-6 gap-y-2 font-medium">
                        <Link href="/terms" className={link}>Termos de uso</Link>
                        <Link href="/privacy" className={link}>Privacidade</Link>
                        <a href={arquivoNoRepositorio("LICENSE")} className={link}>Licença AGPL-3.0</a>
                        <a href={arquivoNoRepositorio("CREDITOS.md")} className={link}>Créditos</a>
                        <a href="mailto:ailansanches@tutamail.com" className={link}>ailansanches@tutamail.com</a>
                    </nav>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                    ZapHub é software livre sob a licença AGPL-3.0. O ZapHub não tem relação com o WhatsApp nem com a Meta;
                    WhatsApp é marca de seus respectivos titulares.
                </p>
            </div>
        </footer>
    );
}
