//! Tempo real: a mesma conexao Socket.IO do painel (Engine.IO v4 por WebSocket), com o cookie do login e o
//! certificado fixado. Reconecta sozinho. Entrega cada evento do servidor como (nome, dados).

use crate::tls;
use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;

pub enum Aviso {
    Conectado,
    Desconectado,
    /// o servidor recusou o login (expirou)
    SemLogin,
    Evento(String, serde_json::Value),
}

/// Quantos avisos cabem esperando a tela (se a tela travar, o socket espera em vez de encher a memoria).
pub const CAPACIDADE_AVISOS: usize = 512;
const CAPACIDADE_SALAS: usize = 32;
const ESPERA_MINIMA_S: u64 = 1;
const ESPERA_MAXIMA_S: u64 = 30;

/// A conexao em tempo real. Ao soltar (Drop) a tarefa e abortada na hora: o socket fecha e nao sobra
/// reconexao rodando para um login que acabou.
pub struct Conexao {
    /// sessoes do WhatsApp para entrar (sala do Socket.IO); trocar a lista reenvia o join-session
    entrar: mpsc::Sender<String>,
    tarefa: tokio::task::AbortHandle,
}

impl Conexao {
    /// Entra na sala de uma sessao do WhatsApp (se o canal estiver cheio, a sala ja esta pedida).
    pub fn entrar_na_sala(&self, sessao: String) {
        let _ = self.entrar.try_send(sessao);
    }
}

impl Drop for Conexao {
    fn drop(&mut self) {
        self.tarefa.abort();
    }
}

/// Espera antes de reconectar: dobra a cada queda (1, 2, 4... ate 30 s). Depois de uma conexao que funcionou volta
/// para o minimo, mas nunca abaixo de 1 s (servidor que fecha logo ao conectar nao vira laco quente).
pub fn proxima_espera(atual_s: u64, funcionou: bool) -> u64 {
    if funcionou {
        ESPERA_MINIMA_S
    } else {
        atual_s.saturating_mul(2).clamp(ESPERA_MINIMA_S, ESPERA_MAXIMA_S)
    }
}

/// Soma uma variacao de ate 1/4 da espera (mais ate 250 ms), para varios programas nao reconectarem juntos.
pub fn com_variacao(espera_s: u64, sorteio: u64) -> Duration {
    let base_ms = espera_s.max(ESPERA_MINIMA_S) * 1000;
    Duration::from_millis(base_ms + sorteio % (base_ms / 4 + 250))
}

fn sorteio() -> u64 {
    use std::hash::{BuildHasher, Hasher};
    std::collections::hash_map::RandomState::new().build_hasher().finish()
}

pub fn iniciar(origem: String, fixacao: Option<tls::Fixacao>, cookie: String, avisos: mpsc::Sender<Aviso>) -> Conexao {
    let (tx, mut rx) = mpsc::channel::<String>(CAPACIDADE_SALAS);
    let tarefa = tokio::spawn(async move {
        let mut salas: Vec<String> = Vec::new();
        let mut espera = ESPERA_MINIMA_S;
        loop {
            while let Ok(s) = rx.try_recv() {
                if !salas.contains(&s) {
                    salas.push(s);
                }
            }
            let fim = rodar(&origem, fixacao.as_ref(), &cookie, &mut salas, &mut rx, &avisos).await;
            match fim {
                Ok(()) => return, // o programa fechou o canal
                Err(Fim::SemLogin) => {
                    let _ = avisos.send(Aviso::SemLogin).await;
                    return;
                }
                Err(f) => {
                    // caiu (ou funcionou e depois caiu): avisa a tela e espera antes de tentar de novo
                    if avisos.send(Aviso::Desconectado).await.is_err() {
                        return;
                    }
                    espera = proxima_espera(espera, matches!(f, Fim::Funcionou));
                    tokio::select! {
                        _ = tokio::time::sleep(com_variacao(espera, sorteio())) => {}
                        _ = avisos.closed() => return,
                    }
                }
            }
        }
    });
    Conexao { entrar: tx, tarefa: tarefa.abort_handle() }
}

enum Fim {
    SemLogin,
    Caiu,
    /// caiu depois de ter funcionado: a espera volta ao minimo
    Funcionou,
}

async fn rodar(
    origem: &str,
    fixacao: Option<&tls::Fixacao>,
    cookie: &str,
    salas: &mut Vec<String>,
    rx: &mut mpsc::Receiver<String>,
    avisos: &mpsc::Sender<Aviso>,
) -> Result<(), Fim> {
    let ws = origem.replacen("https://", "wss://", 1).replacen("http://", "ws://", 1);
    let mut req = format!("{ws}/api/socket/io/?EIO=4&transport=websocket").into_client_request().map_err(|_| Fim::Caiu)?;
    req.headers_mut().insert("Cookie", HeaderValue::from_str(cookie).map_err(|_| Fim::SemLogin)?);
    req.headers_mut().insert("Origin", HeaderValue::from_str(origem).map_err(|_| Fim::Caiu)?);
    let conector = match fixacao {
        Some(f) if origem.starts_with("https://") => Some(tokio_tungstenite::Connector::Rustls(Arc::new(tls::config_fixada(f).map_err(|_| Fim::Caiu)?))),
        _ => None,
    };
    let conectar = tokio_tungstenite::connect_async_tls_with_config(req, None, false, conector);
    let (mut sock, _) = tokio::time::timeout(Duration::from_secs(15), conectar).await.map_err(|_| Fim::Caiu)?.map_err(|_| Fim::Caiu)?;

    let mut funcionou = false;
    let mut ping = Duration::from_secs(25 + 20 + 5);
    loop {
        tokio::select! {
            msg = tokio::time::timeout(ping, sock.next()) => {
                let texto = match msg {
                    Ok(Some(Ok(Message::Text(t)))) => t,
                    Ok(Some(Ok(Message::Ping(p)))) => { let _ = sock.send(Message::Pong(p)).await; continue; }
                    Ok(Some(Ok(_))) => continue,
                    _ => return Err(if funcionou { Fim::Funcionou } else { Fim::Caiu }),
                };
                match pacote(&texto) {
                    Pacote::Abrir(intervalo) => {
                        ping = Duration::from_millis(intervalo) + Duration::from_secs(25);
                        sock.send(Message::Text("40".into())).await.map_err(|_| Fim::Caiu)?;
                    }
                    Pacote::Ping => { sock.send(Message::Text("3".into())).await.map_err(|_| Fim::Caiu)?; }
                    Pacote::Conectou => {
                        funcionou = true;
                        if avisos.send(Aviso::Conectado).await.is_err() { return Ok(()); }
                        for s in salas.iter() {
                            sock.send(Message::Text(emitir("join-session", s))).await.map_err(|_| Fim::Caiu)?;
                        }
                    }
                    Pacote::Recusou => return Err(Fim::SemLogin),
                    Pacote::Desconectou => return Err(if funcionou { Fim::Funcionou } else { Fim::Caiu }),
                    Pacote::Evento(nome, dados) => {
                        if avisos.send(Aviso::Evento(nome, dados)).await.is_err() { return Ok(()); }
                    }
                    Pacote::Outro => {}
                }
            }
            _ = avisos.closed() => return Ok(()),
            sala = rx.recv() => {
                let Some(s) = sala else { return Ok(()) };
                if !salas.contains(&s) {
                    salas.push(s.clone());
                    if funcionou {
                        sock.send(Message::Text(emitir("join-session", &s))).await.map_err(|_| Fim::Caiu)?;
                    }
                }
            }
        }
    }
}

#[derive(Debug, PartialEq)]
enum Pacote {
    Abrir(u64),
    Ping,
    Conectou,
    Recusou,
    /// pacote 41: o servidor encerrou esta conexao
    Desconectou,
    Evento(String, serde_json::Value),
    Outro,
}

fn pacote(t: &str) -> Pacote {
    if let Some(resto) = t.strip_prefix('0') {
        let v: serde_json::Value = serde_json::from_str(resto).unwrap_or_default();
        return Pacote::Abrir(v.get("pingInterval").and_then(|x| x.as_u64()).unwrap_or(25000));
    }
    if t == "2" {
        return Pacote::Ping;
    }
    if t.starts_with("40") {
        return Pacote::Conectou;
    }
    if t.starts_with("44") {
        return Pacote::Recusou;
    }
    if t.starts_with("41") {
        return Pacote::Desconectou;
    }
    if let Some(resto) = t.strip_prefix("42") {
        // pode vir com id de confirmacao antes do JSON (42<id>[...])
        let json = resto.trim_start_matches(|c: char| c.is_ascii_digit());
        if let Ok(serde_json::Value::Array(mut a)) = serde_json::from_str::<serde_json::Value>(json) {
            if !a.is_empty() {
                let nome = a.remove(0).as_str().unwrap_or_default().to_string();
                let dados = if a.is_empty() { serde_json::Value::Null } else { a.remove(0) };
                return Pacote::Evento(nome, dados);
            }
        }
    }
    Pacote::Outro
}

fn emitir(nome: &str, dado: &str) -> String {
    format!("42{}", serde_json::json!([nome, dado]))
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn entende_os_pacotes() {
        assert_eq!(pacote(r#"0{"sid":"x","pingInterval":25000,"pingTimeout":20000}"#), Pacote::Abrir(25000));
        assert_eq!(pacote("2"), Pacote::Ping);
        assert_eq!(pacote(r#"40{"sid":"y"}"#), Pacote::Conectou);
        assert_eq!(pacote(r#"44{"message":"Authentication required"}"#), Pacote::Recusou);
        assert_eq!(pacote(r#"42["chat.lida",{"jid":"a"}]"#), Pacote::Evento("chat.lida".into(), serde_json::json!({"jid":"a"})));
        assert_eq!(pacote(r#"4212["x",1]"#), Pacote::Evento("x".into(), serde_json::json!(1)));
        assert_eq!(pacote("lixo"), Pacote::Outro);
    }

    #[test]
    fn pacote_41_e_desconexao() {
        assert_eq!(pacote("41"), Pacote::Desconectou);
        assert_eq!(pacote(r#"41{"x":1}"#), Pacote::Desconectou);
        // 40 continua sendo conectar; 42 evento
        assert_eq!(pacote("40"), Pacote::Conectou);
        assert!(matches!(pacote(r#"42["a",1]"#), Pacote::Evento(..)));
    }

    #[test]
    fn espera_dobra_ate_o_teto_e_nunca_passa_de_zero() {
        let mut e = ESPERA_MINIMA_S;
        let mut vistos = Vec::new();
        for _ in 0..8 {
            e = proxima_espera(e, false);
            vistos.push(e);
        }
        assert_eq!(vistos, vec![2, 4, 8, 16, 30, 30, 30, 30]);
        assert_eq!(proxima_espera(30, true), 1, "depois de funcionar volta ao minimo");
        assert_eq!(proxima_espera(0, false), 1, "nunca zero");
        assert_eq!(proxima_espera(u64::MAX, false), 30);
    }

    #[test]
    fn variacao_fica_entre_a_espera_e_um_quarto_a_mais() {
        for sorteio in [0u64, 1, 249, 250, 1_000_000, u64::MAX] {
            for s in [0u64, 1, 2, 30] {
                let d = com_variacao(s, sorteio);
                let base = s.max(1) * 1000;
                assert!(d >= Duration::from_millis(base), "{s} {sorteio}");
                assert!(d < Duration::from_millis(base + base / 4 + 250), "{s} {sorteio}");
            }
        }
        assert!(com_variacao(0, 0) >= Duration::from_secs(1), "espera minima de 1 s");
    }

    #[test]
    fn monta_o_join() {
        assert_eq!(emitir("join-session", "abc"), r#"42["join-session","abc"]"#);
    }
}
