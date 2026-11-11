// minha versao: destino depois do login. So aceita caminho relativo do proprio painel; bloqueia javascript:,
// outro dominio, "//dominio", "/\dominio" e caracteres de controle (o navegador remove alguns e monta outra URL).
const CAMINHO_INTERNO = /^\/(?![/\\])[^\\\x00-\x1f\x7f]*$/;

export function destinoSeguro(destino: string | null | undefined, padrao = "/dashboard"): string {
    return destino && CAMINHO_INTERNO.test(destino) ? destino : padrao;
}
