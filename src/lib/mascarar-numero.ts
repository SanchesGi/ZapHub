// minha versao: numero de telefone mascarado para o log (so os 4 ultimos digitos). O log nunca leva o numero inteiro.
// Aceita jid ("5511999998888@s.whatsapp.net", "5511999998888:12@s.whatsapp.net"), @lid ou so o numero.

/** "5511999998888@s.whatsapp.net" -> "****8888"; vazio/sem digitos -> "desconhecido" */
export function mascararNumero(valor: string | null | undefined): string {
    const base = String(valor ?? "");
    const arroba = base.indexOf("@");
    const usuario = arroba >= 0 ? base.slice(0, arroba) : base;
    const dospontos = usuario.indexOf(":");
    const semAparelho = dospontos >= 0 ? usuario.slice(0, dospontos) : usuario;
    let digitos = "";
    for (const ch of semAparelho) if (ch >= "0" && ch <= "9") digitos += ch;
    if (!digitos) return "desconhecido";
    return `****${digitos.slice(-4)}`;
}
