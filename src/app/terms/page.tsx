import { Scale } from "lucide-react";
import { PaginaLegal } from "@/components/lgpd/pagina-legal";

export const metadata = {
    title: "Termos de Uso | ZapHub",
    description: "Termos de uso do ZapHub, gateway de WhatsApp instalado e operado pela própria organização.",
};

// minha versao: termos de uso em pt-BR para um software instalado pelo proprio cliente.
// Mudou o texto? Mude VERSAO_TERMOS em src/lib/termos.ts: todos aceitam de novo.
export default function TermsPage() {
    return (
        <PaginaLegal titulo="Termos de Uso" icone={<Scale className="h-8 w-8" />} outra={{ href: "/privacy", texto: "Ler a Política de Privacidade" }}>
            <p className="lead text-lg text-muted-foreground">
                Estes termos valem para quem usa o painel do ZapHub desta instalação. Ao aceitar, você declara que leu e concorda com as regras abaixo.
            </p>

            <h2>1. Quem é quem</h2>
            <ul>
                <li><strong>ZapHub:</strong> software livre de gateway e painel de atendimento por WhatsApp. Ele é instalado e operado pela própria organização que o utiliza.</li>
                <li><strong>Organização:</strong> quem instala e opera esta instalação. É ela quem decide como os dados são usados e, para a LGPD, é a <strong>controladora</strong> dos dados tratados aqui. O autor do software não tem acesso a esta instalação nem aos seus dados.</li>
                <li><strong>Usuário:</strong> pessoa autorizada pela organização a entrar no painel.</li>
            </ul>
            <p>O ZapHub não tem relação com o WhatsApp nem com a Meta, e não é produto deles.</p>

            <h2>2. Sua conta</h2>
            <ul>
                <li>Guarde a sua senha e não a compartilhe. Ative a verificação em duas etapas (2FA) quando puder.</li>
                <li>Tudo o que for feito com a sua conta é registrado em seu nome (registros de acesso e auditoria).</li>
                <li>Se suspeitar de acesso indevido, troque a senha na hora e avise o administrador.</li>
            </ul>

            <h2>3. Uso aceitável</h2>
            <p>Ao usar conversas, disparos, respostas automáticas, agendamentos e a API, você se compromete a:</p>
            <ul>
                <li>seguir a lei, os termos e as regras de uso do WhatsApp e as políticas da organização;</li>
                <li>falar só com quem tem relação com a organização ou autorizou o contato; não enviar spam, golpes (phishing), vírus ou conteúdo ilegal;</li>
                <li>não acessar conversas, sessões ou dados que não sejam do seu trabalho;</li>
                <li>não tentar burlar limites, permissões ou a segurança do sistema.</li>
            </ul>

            <h2>4. Dados de terceiros</h2>
            <p>
                As conversas passam por dados pessoais de outras pessoas (clientes, contatos, participantes de grupos). Use esses dados só para a finalidade do atendimento e conforme a Política de Privacidade.
                Não copie, divulgue nem exporte esses dados fora do que a organização permite.
            </p>

            <h2>5. Riscos do WhatsApp</h2>
            <p>
                O ZapHub se conecta ao WhatsApp por uma biblioteca de terceiros, que não é oficial. O WhatsApp pode mudar o funcionamento a qualquer momento, interromper o serviço ou restringir números que considere abusivos.
                A organização e os usuários assumem esse risco; o autor do software não se responsabiliza por suspensões ou banimentos.
            </p>

            <h2>6. Disponibilidade e garantias</h2>
            <p>
                O software é fornecido &quot;como está&quot;, sem garantia de funcionamento ininterrupto ou livre de erros, nos termos da licença AGPL-3.0.
                A disponibilidade, os backups e a manutenção desta instalação são responsabilidade da organização.
            </p>

            <h2>7. Encerramento</h2>
            <p>
                A organização pode suspender ou encerrar contas que descumpram estes termos. Você pode excluir a sua conta em <em>Meus dados</em>, dentro do painel.
            </p>

            <h2>8. Mudanças nestes termos</h2>
            <p>
                Quando o texto mudar, a versão muda e o painel pede um novo aceite antes de continuar. O aceite fica registrado com data, versão e endereço de rede.
            </p>

            <h2>9. Contato</h2>
            <p>
                Dúvidas sobre o uso do sistema e pedidos relativos a dados pessoais: fale com o encarregado ou responsável <strong>definido pela organização que opera esta instalação</strong>.
                Assuntos do software (falhas, segurança do código): <a href="mailto:ailansanches@tutamail.com">ailansanches@tutamail.com</a>.
            </p>
        </PaginaLegal>
    );
}
