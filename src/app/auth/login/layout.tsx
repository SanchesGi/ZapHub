// minha versao: le o modo demonstracao no servidor, a cada pedido (nao no build)
import { MODO_DEMO } from "@/lib/demo";
import { ProvedorDemo } from "@/components/auth/provedor-demo";

export const dynamic = "force-dynamic";

export default function LayoutLogin({ children }: { children: React.ReactNode }) {
    return <ProvedorDemo demo={MODO_DEMO}>{children}</ProvedorDemo>;
}
