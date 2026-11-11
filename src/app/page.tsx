// minha versao: pagina publica do ZapHub (apresentacao). As secoes ficam em src/components/landing/.
import { Cabecalho, Hero, Recursos, ComoComecar, Rodape } from "@/components/landing/secoes";

export const metadata = {
  title: "ZapHub | Atendimento por WhatsApp no seu servidor",
  description: "Painel de atendimento por WhatsApp para equipes, instalado no próprio servidor. Conversas, automação, API e webhooks, com os dados com quem instala.",
  openGraph: {
    title: "ZapHub | Atendimento por WhatsApp no seu servidor",
    description: "Painel de atendimento por WhatsApp para equipes, instalado no próprio servidor, sem depender de terceiros.",
    type: "website",
    url: "/",
  },
  twitter: {
    card: "summary",
    title: "ZapHub | Atendimento por WhatsApp no seu servidor",
    description: "Painel de atendimento por WhatsApp para equipes, instalado no próprio servidor, sem depender de terceiros.",
  },
};

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-background selection:bg-primary/30">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground">
        Ir para o conteúdo
      </a>
      <Cabecalho />
      <main id="conteudo" className="flex-1">
        <Hero />
        <Recursos />
        <ComoComecar />
      </main>
      <Rodape />
    </div>
  );
}
