// minha versao: regra de senha SIMPLES (o setor usa senhas faceis no dia a dia).
// Sem obrigar letra+numero nem barrar "comuns"; so um minimo para nao ficar em branco.
export function validarSenhaForte(senha: string): { ok: true } | { ok: false; motivo: string } {
    const s = String(senha || "");
    if (s.length < 4) return { ok: false, motivo: "A senha precisa ter pelo menos 4 caracteres." };
    return { ok: true };
}
