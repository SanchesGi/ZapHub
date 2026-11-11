import { Lock } from "lucide-react";
import { PaginaLegal } from "@/components/lgpd/pagina-legal";

export const metadata = {
    title: "Política de Privacidade | ZapHub",
    description: "Como o ZapHub trata dados pessoais, conforme a LGPD, em uma instalação operada pela própria organização.",
};

// minha versao: politica de privacidade (LGPD) em pt-BR. Mesma versao dos termos: um aceite so.
export default function PrivacyPage() {
    return (
        <PaginaLegal titulo="Política de Privacidade" icone={<Lock className="h-8 w-8" />} outra={{ href: "/terms", texto: "Ler os Termos de Uso" }}>
            <p className="lead text-lg text-muted-foreground">
                Esta política explica quais dados pessoais são tratados nesta instalação do ZapHub, para quê, por quanto tempo e como exercer seus direitos, conforme a Lei Geral de Proteção de Dados (Lei 13.709/2018, a LGPD).
            </p>

            <h2>1. Quem é o controlador</h2>
            <p>
                O ZapHub é instalado e operado pela própria organização que o utiliza. Essa <strong>organização é a controladora</strong> dos dados tratados aqui e decide as finalidades e a retenção.
                O autor do software não opera esta instalação, não recebe cópia dos dados e não tem acesso a eles.
            </p>
            <p>
                Encarregado (DPO) e canal para titulares: <strong>definidos pela organização que opera esta instalação</strong>. Pergunte ao administrador do sistema.
            </p>

            <h2>2. Quais dados são tratados</h2>
            <h3>Usuários do painel</h3>
            <ul>
                <li>Nome, e-mail, senha (guardada só como hash bcrypt) e função (papel) no sistema;</li>
                <li>endereço IP, navegador e registros de acesso (entradas, saídas, falhas e ações sensíveis);</li>
                <li>dados da verificação em duas etapas (2FA), quando ativada;</li>
                <li>aceites dos termos (data, versão, IP) e notificações.</li>
            </ul>
            <h3>Contatos e conversas do WhatsApp</h3>
            <ul>
                <li>Número de telefone, nome, foto de perfil, recado e identificadores do WhatsApp;</li>
                <li>mensagens (texto, áudios, imagens, vídeos, documentos e outras mídias), enquetes, reações e dados de grupos (nome, participantes);</li>
                <li>etiquetas, estados de leitura e agendamentos ligados às conversas.</li>
            </ul>
            <h3>Auditoria</h3>
            <p>
                A auditoria registra eventos como mensagens apagadas ou editadas, e <strong>pode guardar o conteúdo das mensagens apagadas</strong>, inclusive de terceiros. Isso permite à organização conferir o que foi dito no atendimento.
            </p>

            <h2>3. Para que usamos e em que base legal</h2>
            <table>
                <thead><tr><th>Finalidade</th><th>Base legal (art. 7º)</th></tr></thead>
                <tbody>
                    <tr><td>Dar acesso ao painel e identificar quem faz o quê</td><td>Execução de contrato ou de procedimentos ligados a ele (inc. V)</td></tr>
                    <tr><td>Trocar mensagens e atender clientes e contatos</td><td>Execução de contrato (inc. V) e legítimo interesse (inc. IX)</td></tr>
                    <tr><td>Segurança, prevenção a fraude, registros de acesso e auditoria</td><td>Legítimo interesse (inc. IX)</td></tr>
                    <tr><td>Guardar registros de acesso e atender ordens e autoridades</td><td>Cumprimento de obrigação legal ou regulatória (inc. II)</td></tr>
                </tbody>
            </table>
            <p>A organização pode adotar outra base legal para tratamentos próprios que configurar (por exemplo, consentimento em disparos), e deve informar isso aos titulares.</p>

            <h2>4. Com quem os dados são compartilhados</h2>
            <ul>
                <li><strong>WhatsApp (Meta):</strong> as mensagens trafegam pelos servidores do WhatsApp, sob os termos e a política de privacidade dele. O ZapHub não tem relação com a Meta.</li>
                <li><strong>Webhooks:</strong> só se o administrador cadastrar um endereço, os eventos (por exemplo, mensagens recebidas) são enviados a esse destino.</li>
                <li><strong>remove.bg:</strong> só se o administrador configurar a chave, imagens de figurinhas enviadas para remover o fundo vão a esse serviço.</li>
                <li><strong>Prévias de link:</strong> ao mostrar a prévia de um link, o servidor busca a página do endereço, que pode ver o IP do servidor.</li>
                <li><strong>Telemetria:</strong> <strong>não há</strong>. O ZapHub não envia estatísticas, relatórios de erro nem dados de uso a terceiros nem ao autor do software.</li>
            </ul>

            <h2>5. Por quanto tempo guardamos</h2>
            <p>
                A retenção é <strong>configurável pelo administrador</strong> em Privacidade: mensagens, arquivos de mídia e registros (mínimo de 30 dias, ou guardar sem prazo). Uma rotina diária apaga o que passou do prazo.
                Sem prazo definido, os dados ficam até serem apagados. Contas excluídas pelo próprio usuário têm seus dados removidos conforme o painel.
            </p>
            <p>
                <strong>Atenção:</strong> ao reconectar uma sessão, o WhatsApp pode sincronizar o histórico de novo, e mensagens já apagadas daqui podem voltar a aparecer.
            </p>

            <h2>6. Segurança</h2>
            <ul>
                <li>Conexão HTTPS no acesso ao painel (quando instalada com certificado);</li>
                <li>senhas guardadas com bcrypt, nunca em texto;</li>
                <li>credenciais da sessão do WhatsApp cifradas no banco;</li>
                <li>verificação em duas etapas (2FA), limite de tentativas de login e controle de permissões por função e por sessão;</li>
                <li>registro das ações sensíveis.</li>
            </ul>
            <p>Nenhum sistema é totalmente imune. Em caso de incidente que possa causar dano relevante, a organização avalia e comunica a ANPD e os titulares, conforme o art. 48 da LGPD.</p>

            <h2>7. Seus direitos (art. 18)</h2>
            <p>Você pode pedir: confirmação do tratamento, acesso, correção, anonimização, bloqueio ou eliminação de dados desnecessários, portabilidade, informação sobre compartilhamento, revogação de consentimento e oposição a tratamentos feitos sem consentimento.</p>
            <ul>
                <li><strong>Usuários do painel:</strong> em <em>Meus dados</em> você baixa os seus dados e pode excluir a sua conta, sem depender de ninguém.</li>
                <li><strong>Contatos do WhatsApp:</strong> faça o pedido à organização, pelo canal que ela indicar. O administrador registra o pedido em <em>Privacidade</em>, e pode exportar ou apagar os dados do titular e responder.</li>
            </ul>
            <p>Se não for atendido, você pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).</p>

            <h2>8. Crianças e adolescentes</h2>
            <p>O ZapHub não é voltado a menores. Dados de menores só devem ser tratados pela organização com base legal adequada e, quando exigido, com o consentimento de um responsável.</p>

            <h2>9. Mudanças nesta política</h2>
            <p>Quando o texto mudar, a versão muda e o painel pede novo aceite. A versão e a data de vigência aparecem no alto desta página.</p>

            <h2>10. Contato</h2>
            <p>
                Sobre dados pessoais nesta instalação: o encarregado ou responsável <strong>definido pela organização que opera esta instalação</strong>.
                Sobre o software em si (falhas, segurança do código; <strong>não</strong> para pedidos de titulares): <a href="mailto:ailansanches@tutamail.com">ailansanches@tutamail.com</a>.
            </p>
        </PaginaLegal>
    );
}
