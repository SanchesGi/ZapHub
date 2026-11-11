// minha versao: dados do projeto num lugar so (nome, versao, links e contato). Mude aqui e vale para o painel todo.
import pkg from "../../package.json";

export const NOME_PROJETO = "ZapHub";
export const VERSAO_PROJETO: string = pkg.version;

/** perfil do autor no GitHub (botoes "GitHub" da pagina publica) */
export const GITHUB_AUTOR = "https://github.com/SanchesGi";
/** repositorio publico do projeto (guia de instalacao, licenca, creditos) */
export const REPOSITORIO = "https://github.com/SanchesGi/ZapHub";
/** arquivo do repositorio publico, ex.: arquivoNoRepositorio("docs/INSTALACAO.md") */
export const arquivoNoRepositorio = (caminho: string) => `${REPOSITORIO}/blob/main/${caminho}`;

/** contato do desenvolvedor do software (nao e o contato para pedidos de titulares de dados) */
export const CONTATO_AUTOR = "ailansanches@tutamail.com";
