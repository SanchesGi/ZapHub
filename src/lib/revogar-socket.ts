// minha versao: a permissao do socket e checada so ao entrar na sala. Quem perde o acesso precisa sair na hora,
// senao um socket aberto continua recebendo as mensagens da sessao.
import { salaGestao } from "./session-access";

const io = () => (global as any).io;

/** Tira o usuario das salas da sessao, sem derrubar a conexao dele com as outras sessoes. */
export async function tirarDaSessao(userId: string, sessionKey: string) {
    const servidor = io();
    if (!servidor) return;
    const sockets = await servidor.in(sessionKey).fetchSockets();
    for (const s of sockets) {
        if (s.data?.user?.id !== userId) continue;
        s.leave(sessionKey);
        s.leave(salaGestao(sessionKey));
    }
}

/** Derruba todos os sockets do usuario (removido, trocou de papel ou teve a senha alterada). */
export async function desconectarUsuario(userId: string) {
    const servidor = io();
    if (!servidor) return;
    const sockets = await servidor.fetchSockets();
    for (const s of sockets) {
        if (s.data?.user?.id === userId) s.disconnect(true);
    }
}
