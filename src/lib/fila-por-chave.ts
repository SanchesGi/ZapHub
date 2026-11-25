// minha versao: executa tarefas UMA DE CADA VEZ para a mesma chave (ex.: a mesma mensagem), sem travar as outras.
// Evita que dois votos/recibos chegando juntos leiam o mesmo "extra" e um apague a gravacao do outro.
const caudas = new Map<string, Promise<unknown>>();

export function emSerie<T>(chave: string, tarefa: () => Promise<T>): Promise<T> {
    const anterior = caudas.get(chave) ?? Promise.resolve();
    // roda depois da anterior, tenha ela dado certo ou errado
    const atual = anterior.then(tarefa, tarefa);
    const cauda = atual.catch(() => undefined);
    caudas.set(chave, cauda);
    // limpa a chave quando ninguem mais entrou na fila (nao deixa o mapa crescer)
    void cauda.then(() => {
        if (caudas.get(chave) === cauda) caudas.delete(chave);
    });
    return atual;
}
