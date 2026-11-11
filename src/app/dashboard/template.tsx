// minha versao: ponto unico da animacao de entrada das telas do dashboard (fade + deslize leve, 220 ms).
// O template remonta a cada navegacao; desligada com prefers-reduced-motion (ver globals.css).
export default function DashboardTemplate({ children }: { children: React.ReactNode }) {
    return <div className="pagina-entrar">{children}</div>;
}
