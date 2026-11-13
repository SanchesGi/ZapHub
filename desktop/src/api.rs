//! Conversa com o servidor ZapHub: login (o mesmo do painel, com 2FA) e as rotas /api/app/*.
//! Toda conexao usa o certificado fixado (tls::config_fixada); http so vale para o proprio computador.

use crate::tls;
use reqwest::header::{HeaderMap, HeaderValue, CONTENT_TYPE, COOKIE, ORIGIN, SET_COOKIE};
use serde::Deserialize;
use std::sync::{Arc, RwLock};
use std::time::Duration;

/// rotas do painel (contatos, verificar numero, estado da conversa, foto, info, termos)
pub mod painel_api;

#[derive(Debug)]
pub enum Erro {
    /// login expirou ou foi revogado: volta para a tela de entrar
    Sessao,
    /// o servidor apresentou outro certificado
    Certificado,
    /// o servidor pede o aceite dos Termos de Uso antes de qualquer outra coisa
    Termos,
    Msg(String),
}

impl std::fmt::Display for Erro {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Erro::Sessao => write!(f, "Sua sessão expirou. Entre de novo."),
            Erro::Certificado => write!(f, "O certificado do servidor mudou. Conexão bloqueada por segurança."),
            Erro::Termos => write!(f, "Antes de usar, aceite os Termos de Uso do servidor."),
            Erro::Msg(m) => write!(f, "{m}"),
        }
    }
}

fn erro_rede(e: reqwest::Error) -> Erro {
    // o motivo real do rustls vem na cadeia de causas
    let mut fonte: Option<&dyn std::error::Error> = Some(&e);
    while let Some(f) = fonte {
        if f.to_string().contains(tls::ERRO_CERTIFICADO) {
            return Erro::Certificado;
        }
        fonte = f.source();
    }
    if e.is_timeout() {
        Erro::Msg("O servidor demorou para responder.".into())
    } else if e.is_connect() {
        Erro::Msg("Não consegui conectar ao servidor.".into())
    } else {
        Erro::Msg(format!("Falha de rede: {e}"))
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessaoWa {
    pub session_id: String,
    pub name: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub privada: bool,
    #[serde(default, rename = "_count")]
    pub contagem: Option<Contagem>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Contagem {
    #[serde(default)]
    pub session_accesses: i64,
}

impl SessaoWa {
    /// mesma regra do painel: compartilhada assina por padrao, privada nunca
    pub fn assina_por_padrao(&self) -> bool {
        !self.privada && self.contagem.as_ref().map(|c| c.session_accesses).unwrap_or(0) > 0
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversa {
    pub jid: String,
    pub name: Option<String>,
    pub notify: Option<String>,
    #[serde(default)]
    pub unread: i64,
    #[serde(default)]
    pub nao_lida: bool,
    #[serde(default)]
    pub fixada: bool,
    #[serde(default)]
    pub silenciada: bool,
    pub last_message: Option<Ultima>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Ultima {
    pub content: Option<String>,
    pub timestamp: Option<String>,
    #[serde(rename = "type")]
    pub tipo: Option<String>,
    #[serde(default)]
    pub from_me: bool,
    pub status: Option<String>,
    pub key_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mensagem {
    pub key_id: String,
    pub remote_jid: String,
    #[serde(default)]
    pub from_me: bool,
    pub content: Option<String>,
    #[serde(rename = "type")]
    pub tipo: Option<String>,
    pub timestamp: Option<String>,
    pub status: Option<String>,
    pub media_url: Option<String>,
    pub sender_name: Option<String>,
    pub push_name: Option<String>,
    pub sent_by: Option<String>,
    #[serde(default)]
    pub live: bool,
    /// mensagem citada (resposta)
    #[serde(default, deserialize_with = "crate::acoes::citada_tolerante")]
    pub quoted: Option<crate::acoes::Citada>,
    /// quem reagiu e com qual emoji (null ou objeto no servidor)
    #[serde(default, deserialize_with = "crate::acoes::reacoes_tolerantes")]
    pub reacoes: Vec<crate::acoes::Reacao>,
    /// encaminhada / editada / apagada
    #[serde(default, deserialize_with = "crate::acoes::extra_tolerante")]
    pub extra: crate::acoes::Extra,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct RespostaApagar {
    /// "TODOS" ou "PARA_MIM"
    #[serde(default)]
    pub modo: String,
    #[serde(default)]
    pub aviso: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct FalhaEncaminhar {
    #[serde(default)]
    pub jid: String,
    #[serde(default)]
    pub erro: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct ResultadoEncaminhar {
    #[serde(default)]
    pub enviados: u32,
    #[serde(default)]
    pub falhas: Vec<FalhaEncaminhar>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultadoBusca {
    pub key_id: String,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub from_me: bool,
    #[serde(default)]
    pub timestamp: Option<String>,
    #[serde(default)]
    pub sender_name: Option<String>,
    #[serde(default, rename = "type")]
    pub tipo: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct PaginaBusca {
    #[serde(default)]
    pub resultados: Vec<ResultadoBusca>,
    #[serde(default)]
    pub total: u32,
    #[serde(default)]
    pub paginas: u32,
}

pub struct Cliente {
    pub origem: String,
    http: reqwest::Client,
    cookie: RwLock<String>,
}

pub enum Login {
    Ok,
    PrecisaCodigo,
}

impl Cliente {
    pub fn novo(origem: &str, fixacao: Option<&tls::Fixacao>) -> Result<Arc<Cliente>, Erro> {
        // provedor de criptografia do processo (o reqwest exige um, mesmo sem https); so a 1a chamada instala
        let _ = rustls::crypto::ring::default_provider().install_default();
        let mut padrao = HeaderMap::new();
        padrao.insert(ORIGIN, HeaderValue::from_str(origem).map_err(|_| Erro::Msg("Endereço inválido.".into()))?);
        let mut b = reqwest::Client::builder()
            .default_headers(padrao)
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(120))
            .user_agent(concat!("ZapHub-Windows/", env!("CARGO_PKG_VERSION")));
        if origem.starts_with("https://") {
            let fix = fixacao.filter(|f| !f.vazia()).ok_or_else(|| Erro::Msg("Identidade do servidor não confirmada.".into()))?;
            b = b.use_preconfigured_tls(tls::config_fixada(fix).map_err(Erro::Msg)?);
        }
        let http = b.build().map_err(|e| Erro::Msg(format!("HTTP: {e}")))?;
        Ok(Arc::new(Cliente { origem: origem.to_string(), http, cookie: RwLock::new(String::new()) }))
    }

    pub fn cookie(&self) -> String {
        self.cookie.read().map(|c| c.clone()).unwrap_or_default()
    }

    pub fn usar_cookie(&self, c: &str) {
        if let Ok(mut g) = self.cookie.write() {
            *g = c.to_string();
        }
    }

    fn url(&self, caminho: &str) -> String {
        format!("{}{}", self.origem, caminho)
    }

    /// Login do painel (Auth.js): confere a senha, pede o codigo 2FA se a conta tiver, e guarda o cookie da sessao.
    pub async fn entrar(&self, email: &str, senha: &str, codigo: &str) -> Result<Login, Erro> {
        let r = self.http.post(self.url("/api/auth/precheck")).json(&serde_json::json!({ "email": email, "password": senha })).send().await.map_err(erro_rede)?;
        let pre = json_limitado(r).await?;
        if pre.get("bloqueado").and_then(|v| v.as_bool()) == Some(true) {
            return Err(Erro::Msg("Muitas tentativas. Espere alguns minutos e tente de novo.".into()));
        }
        if pre.get("needs2fa").and_then(|v| v.as_bool()) == Some(true) && codigo.trim().is_empty() {
            return Ok(Login::PrecisaCodigo);
        }

        let r = self.http.get(self.url("/api/auth/csrf")).send().await.map_err(erro_rede)?;
        let cookies_csrf = juntar_cookies(r.headers(), |_| true);
        let csrf = json_limitado(r).await?;
        let token = csrf.get("csrfToken").and_then(|v| v.as_str()).unwrap_or_default().to_string();

        let r = self
            .http
            .post(self.url("/api/auth/callback/credentials"))
            .header(COOKIE, cookies_csrf)
            .header("X-Auth-Return-Redirect", "1")
            .form(&[
                ("email", email),
                ("password", senha),
                ("totp", codigo.trim()),
                ("csrfToken", token.as_str()),
                ("callbackUrl", &self.url("/dashboard")),
            ])
            .send()
            .await
            .map_err(erro_rede)?;
        let sessao = juntar_cookies(r.headers(), |n| n.contains("session-token"));
        if sessao.is_empty() {
            return Err(Erro::Msg("E-mail, senha ou código incorretos.".into()));
        }
        self.usar_cookie(&sessao);
        Ok(Login::Ok)
    }

    /// "Sair": pede ao servidor para encerrar a sessao (Auth.js: POST /api/auth/signout com o token csrf) com o
    /// cookie que estava em uso. Melhor esforco, ate 6 s: se falhar, o login ja acabou neste computador de qualquer jeito
    /// (quem chama apaga o cookie local antes).
    pub async fn encerrar_no_servidor(&self, cookie: &str) {
        if cookie.is_empty() {
            return;
        }
        let tarefa = async {
            let r = self.http.get(self.url("/api/auth/csrf")).header(COOKIE, cookie).send().await.ok()?;
            let cookies_csrf = juntar_cookies(r.headers(), |_| true);
            let token = json_limitado(r).await.ok()?.get("csrfToken").and_then(|v| v.as_str()).map(String::from)?;
            let todos = if cookies_csrf.is_empty() { cookie.to_string() } else { format!("{cookie}; {cookies_csrf}") };
            self.http
                .post(self.url("/api/auth/signout"))
                .header(COOKIE, todos)
                .header("X-Auth-Return-Redirect", "1")
                .form(&[("csrfToken", token.as_str()), ("callbackUrl", self.url("/").as_str())])
                .send()
                .await
                .ok()
        };
        let _ = tokio::time::timeout(Duration::from_secs(6), tarefa).await;
    }

    async fn get<T: serde::de::DeserializeOwned>(&self, caminho: &str) -> Result<T, Erro> {
        let r = self.http.get(self.url(caminho)).header(COOKIE, self.cookie()).send().await.map_err(erro_rede)?;
        tratar(r).await
    }

    async fn post_json<T: serde::de::DeserializeOwned>(&self, caminho: &str, corpo: serde_json::Value) -> Result<T, Erro> {
        let r = self
            .http
            .post(self.url(caminho))
            .header(COOKIE, self.cookie())
            .header(CONTENT_TYPE, "application/json")
            .body(corpo.to_string())
            .send()
            .await
            .map_err(erro_rede)?;
        tratar(r).await
    }

    pub async fn sessoes(&self) -> Result<Vec<SessaoWa>, Erro> {
        let v: serde_json::Value = self.get("/api/sessions").await?;
        serde_json::from_value(v.get("data").cloned().unwrap_or_default()).map_err(|e| Erro::Msg(format!("Resposta inesperada: {e}")))
    }

    pub async fn conversas(&self, sessao: &str, busca: &str, filtro: &str, antes: Option<&str>) -> Result<Vec<Conversa>, Erro> {
        let mut u = url::Url::parse(&self.url(&format!("/api/app/{}/conversas", enc(sessao)))).map_err(|e| Erro::Msg(e.to_string()))?;
        {
            let mut q = u.query_pairs_mut();
            if !busca.trim().is_empty() {
                q.append_pair("busca", busca.trim());
            }
            if let Some(a) = antes {
                q.append_pair("antes", a);
            }
            q.append_pair("filtro", filtro);
        }
        let caminho = format!("{}?{}", u.path(), u.query().unwrap_or(""));
        let v: serde_json::Value = self.get(&caminho).await?;
        serde_json::from_value(v.get("conversas").cloned().unwrap_or_default()).map_err(|e| Erro::Msg(format!("Resposta inesperada: {e}")))
    }

    pub async fn mensagens(&self, sessao: &str, jid: &str, antes: Option<&str>) -> Result<(Vec<Mensagem>, bool), Erro> {
        let mut caminho = format!("/api/app/{}/conversas/{}/mensagens", enc(sessao), enc(jid));
        if let Some(a) = antes {
            caminho.push_str(&format!("?antes={}", enc(a)));
        }
        let v: serde_json::Value = self.get(&caminho).await?;
        let lista = serde_json::from_value(v.get("mensagens").cloned().unwrap_or_default()).map_err(|e| Erro::Msg(format!("Resposta inesperada: {e}")))?;
        Ok((lista, v.get("temMais").and_then(|x| x.as_bool()).unwrap_or(false)))
    }

    /// Baixa uma midia da conversa (so do proprio servidor, caminho /api/media/<nome>). Limite de 100 MB.
    pub async fn baixar(&self, media_url: &str) -> Result<Vec<u8>, Erro> {
        if !crate::midia::caminho_valido(media_url) {
            return Err(Erro::Msg("Endereço de mídia inválido.".into()));
        }
        let mut r = self.http.get(self.url(media_url)).header(COOKIE, self.cookie()).send().await.map_err(erro_rede)?;
        match r.status().as_u16() {
            200 => {}
            401 => return Err(Erro::Sessao),
            404 => return Err(Erro::Msg("Esta mídia não está mais no servidor.".into())),
            403 => return Err(Erro::Msg("Sem permissão para esta mídia.".into())),
            c => return Err(Erro::Msg(format!("O servidor não entregou a mídia ({c})."))),
        }
        const LIMITE: usize = 100 * 1024 * 1024;
        let mut dados = Vec::new();
        while let Some(parte) = r.chunk().await.map_err(erro_rede)? {
            if dados.len() + parte.len() > LIMITE {
                return Err(Erro::Msg("Arquivo grande demais para abrir aqui.".into()));
            }
            dados.extend_from_slice(&parte);
        }
        Ok(dados)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn enviar_midia(&self, sessao: &str, jid: &str, dados: bytes::Bytes, nome: &str, mime: &str, tipo: &str, legenda: &str, duracao: Option<f32>) -> Result<(), Erro> {
        // `Bytes` e contado por referencia: quem chama guarda a sua copia (para tentar de novo) sem duplicar o arquivo
        let tamanho = dados.len() as u64;
        let parte = reqwest::multipart::Part::stream_with_length(reqwest::Body::from(dados), tamanho)
            .file_name(nome.to_string())
            .mime_str(mime)
            .map_err(|e| Erro::Msg(e.to_string()))?;
        let mut form = reqwest::multipart::Form::new().part("arquivo", parte).text("tipo", tipo.to_string()).text("legenda", legenda.to_string());
        if let Some(d) = duracao {
            form = form.text("duracao", format!("{d:.1}"));
        }
        let r = self
            .http
            .post(self.url(&format!("/api/app/{}/conversas/{}/midia", enc(sessao), enc(jid))))
            .header(COOKIE, self.cookie())
            .multipart(form)
            .send()
            .await
            .map_err(erro_rede)?;
        let _: serde_json::Value = tratar(r).await?;
        Ok(())
    }

    /// Texto, opcionalmente respondendo a uma mensagem (`citada` e o keyId dela).
    pub async fn enviar_texto_citando(&self, sessao: &str, jid: &str, texto: &str, assinar: bool, citada: Option<&str>) -> Result<(), Erro> {
        let mut corpo = serde_json::json!({ "texto": texto, "assinar": assinar });
        if let Some(c) = citada.filter(|c| !c.is_empty()) {
            corpo["citada"] = serde_json::Value::String(c.to_string());
        }
        let _: serde_json::Value = self.post_json(&format!("/api/app/{}/conversas/{}/mensagens", enc(sessao), enc(jid)), corpo).await?;
        Ok(())
    }

    /// Reage a uma mensagem; emoji vazio remove a reacao.
    pub async fn reagir(&self, sessao: &str, jid: &str, key_id: &str, emoji: &str) -> Result<(), Erro> {
        let caminho = format!("/api/app/{}/conversas/{}/mensagens/{}/reacao", enc(sessao), enc(jid), enc(key_id));
        let _: serde_json::Value = self.post_json(&caminho, serde_json::json!({ "emoji": emoji })).await?;
        Ok(())
    }

    /// Apaga: o servidor decide entre "TODOS" e "PARA_MIM" e explica no aviso.
    pub async fn apagar_mensagem(&self, sessao: &str, jid: &str, key_id: &str) -> Result<RespostaApagar, Erro> {
        let caminho = format!("/api/app/{}/conversas/{}/mensagens/{}", enc(sessao), enc(jid), enc(key_id));
        let r = self.http.delete(self.url(&caminho)).header(COOKIE, self.cookie()).send().await.map_err(erro_rede)?;
        tratar(r).await
    }

    /// Edita uma mensagem de texto enviada (o servidor confere: propria, texto, ate 15 minutos, nao apagada).
    pub async fn editar_mensagem(&self, sessao: &str, jid: &str, key_id: &str, texto: &str) -> Result<(), Erro> {
        let caminho = format!("/api/app/{}/conversas/{}/mensagens/{}", enc(sessao), enc(jid), enc(key_id));
        let r = self
            .http
            .patch(self.url(&caminho))
            .header(COOKIE, self.cookie())
            .header(CONTENT_TYPE, "application/json")
            .body(serde_json::json!({ "texto": texto }).to_string())
            .send()
            .await
            .map_err(erro_rede)?;
        let _: serde_json::Value = tratar(r).await?;
        Ok(())
    }

    /// Encaminha uma mensagem para ate 5 conversas. Se ninguem recebeu o servidor responde 502 com o mesmo corpo.
    pub async fn encaminhar(&self, sessao: &str, key_id: &str, destinos: &[String]) -> Result<ResultadoEncaminhar, Erro> {
        let r = self
            .http
            .post(self.url(&format!("/api/app/{}/encaminhar", enc(sessao))))
            .header(COOKIE, self.cookie())
            .header(CONTENT_TYPE, "application/json")
            .body(serde_json::json!({ "keyId": key_id, "destinos": destinos }).to_string())
            .send()
            .await
            .map_err(erro_rede)?;
        if r.status().as_u16() == 502 {
            let v = json_limitado(r).await.unwrap_or_default();
            return serde_json::from_value(v).map_err(|_| Erro::Msg("Não consegui encaminhar para nenhuma conversa.".into()));
        }
        tratar(r).await
    }

    /// Busca texto dentro de uma conversa (30 por pagina, `q` ate 100 caracteres).
    pub async fn buscar_na_conversa(&self, sessao: &str, jid: &str, q: &str, pagina: u32) -> Result<PaginaBusca, Erro> {
        let q: String = q.trim().chars().take(100).collect();
        let caminho = format!("/api/app/{}/conversas/{}/busca?q={}&pagina={}", enc(sessao), enc(jid), enc(&q), pagina.max(1));
        self.get(&caminho).await
    }

    pub async fn marcar_lida(&self, sessao: &str, jid: &str) -> Result<(), Erro> {
        let _: serde_json::Value = self.post_json(&format!("/api/app/{}/conversas/{}/lida", enc(sessao), enc(jid)), serde_json::json!({})).await?;
        Ok(())
    }
}

/// Teto do corpo JSON das respostas: um servidor (ou intermediario) defeituoso nao enche a memoria do programa.
pub const LIMITE_JSON: usize = 10 * 1024 * 1024;

/// Cabe mais um pedaco sem passar do limite?
fn cabe(acumulado: usize, parte: usize, limite: usize) -> bool {
    acumulado.checked_add(parte).is_some_and(|t| t <= limite)
}

/// Le o corpo da resposta ate `limite` bytes; acima disso, erro.
async fn corpo_limitado(mut r: reqwest::Response, limite: usize) -> Result<Vec<u8>, Erro> {
    const GRANDE: &str = "O servidor mandou uma resposta grande demais.";
    if r.content_length().is_some_and(|n| n > limite as u64) {
        return Err(Erro::Msg(GRANDE.into()));
    }
    let mut dados = Vec::new();
    while let Some(parte) = r.chunk().await.map_err(erro_rede)? {
        if !cabe(dados.len(), parte.len(), limite) {
            return Err(Erro::Msg(GRANDE.into()));
        }
        dados.extend_from_slice(&parte);
    }
    Ok(dados)
}

/// JSON da resposta com teto de tamanho; corpo que nao e JSON vira valor vazio (como antes).
async fn json_limitado(r: reqwest::Response) -> Result<serde_json::Value, Erro> {
    let corpo = corpo_limitado(r, LIMITE_JSON).await?;
    Ok(serde_json::from_slice(&corpo).unwrap_or_default())
}

fn enc(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect::<String>().replace('+', "%20")
}

/// "nome=valor; nome2=valor2" a partir dos Set-Cookie da resposta
fn juntar_cookies(h: &HeaderMap, filtro: impl Fn(&str) -> bool) -> String {
    h.get_all(SET_COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .filter_map(|v| v.split(';').next())
        .filter(|par| {
            let nome = par.split('=').next().unwrap_or("");
            let valor = par.split_once('=').map(|(_, v)| v).unwrap_or("");
            !valor.is_empty() && filtro(nome)
        })
        .collect::<Vec<_>>()
        .join("; ")
}

async fn tratar<T: serde::de::DeserializeOwned>(r: reqwest::Response) -> Result<T, Erro> {
    let status = r.status();
    if status.as_u16() == 404 && r.url().path().starts_with("/api/app/") && r.headers().get(CONTENT_TYPE).map(|v| !v.as_bytes().starts_with(b"application/json")).unwrap_or(true) {
        // a rota nem existe (a resposta e a pagina 404 do painel): servidor anterior ao programa do Windows
        return Err(Erro::Msg("Este servidor ainda não tem a versão do ZapHub que atende o programa do Windows. Peça ao administrador para atualizar o ZapHub no servidor.".into()));
    }
    if status.as_u16() == 401 || status.is_redirection() {
        return Err(Erro::Sessao);
    }
    let v = json_limitado(r).await?;
    if status.as_u16() == 403 && v.get("error").and_then(|x| x.as_str()) == Some("termos_pendentes") {
        return Err(Erro::Termos);
    }
    if !status.is_success() {
        let msg = v.get("erro").or_else(|| v.get("message")).and_then(|x| x.as_str()).unwrap_or("Falha no servidor").to_string();
        return Err(Erro::Msg(if status.as_u16() == 403 { format!("Sem permissão: {msg}") } else { msg }));
    }
    serde_json::from_value(v).map_err(|e| Erro::Msg(format!("Resposta inesperada: {e}")))
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn junta_so_os_cookies_pedidos() {
        let mut h = HeaderMap::new();
        h.append(SET_COOKIE, HeaderValue::from_static("authjs.csrf-token=abc; Path=/; HttpOnly"));
        h.append(SET_COOKIE, HeaderValue::from_static("__Secure-authjs.session-token=jwt123; Path=/; Secure"));
        h.append(SET_COOKIE, HeaderValue::from_static("authjs.session-token=; Max-Age=0"));
        assert_eq!(juntar_cookies(&h, |n| n.contains("session-token")), "__Secure-authjs.session-token=jwt123");
        assert_eq!(juntar_cookies(&h, |_| true), "authjs.csrf-token=abc; __Secure-authjs.session-token=jwt123");
    }

    /// Contra uma instancia de verdade: ZAPHUB_TESTE_URL, ZAPHUB_TESTE_EMAIL e ZAPHUB_TESTE_SENHA.
    /// Rodar com: cargo test -- --ignored ponta_a_ponta
    #[tokio::test]
    #[ignore]
    async fn ponta_a_ponta() {
        let url = std::env::var("ZAPHUB_TESTE_URL").expect("ZAPHUB_TESTE_URL");
        let c = Cliente::novo(&url, None).unwrap();
        let senha = std::env::var("ZAPHUB_TESTE_SENHA").unwrap();
        assert!(matches!(c.entrar(&std::env::var("ZAPHUB_TESTE_EMAIL").unwrap(), "senha-errada", "").await, Err(Erro::Msg(_))));
        assert!(matches!(c.entrar(&std::env::var("ZAPHUB_TESTE_EMAIL").unwrap(), &senha, "").await, Ok(Login::Ok)));
        let s = c.sessoes().await.unwrap();
        assert!(!s.is_empty());
        let conv = c.conversas(&s[0].session_id, "", "all", None).await.unwrap();
        assert!(!conv.is_empty());
        let (msgs, _) = c.mensagens(&s[0].session_id, &conv[0].jid, None).await.unwrap();
        println!("sessoes={} conversas={} mensagens={}", s.len(), conv.len(), msgs.len());
        let busca = c.conversas(&s[0].session_id, "zzzz-nada", "all", None).await.unwrap();
        assert!(busca.is_empty());

        let (tx, mut rx) = tokio::sync::mpsc::channel(64);
        let con = crate::tempo_real::iniciar(url.clone(), None, c.cookie(), tx);
        con.entrar_na_sala(s[0].session_id.clone());
        let av = tokio::time::timeout(Duration::from_secs(15), rx.recv()).await.expect("tempo real nao respondeu");
        assert!(matches!(av, Some(crate::tempo_real::Aviso::Conectado)), "tempo real nao conectou");

        // login invalido: o tempo real recusa
        let (tx2, mut rx2) = tokio::sync::mpsc::channel(64);
        let _con2 = crate::tempo_real::iniciar(url, None, "authjs.session-token=falso".into(), tx2);
        let av = tokio::time::timeout(Duration::from_secs(15), rx2.recv()).await.expect("sem resposta");
        assert!(matches!(av, Some(crate::tempo_real::Aviso::SemLogin)), "aceitou login falso");
    }

    /// Midia contra uma instancia de verdade: baixa uma foto da conversa e envia uma imagem pequena.
    /// ZAPHUB_TESTE_URL/EMAIL/SENHA + ZAPHUB_TESTE_JID (conversa combinada para testes).
    #[tokio::test]
    #[ignore]
    async fn midia_ponta_a_ponta() {
        let url = std::env::var("ZAPHUB_TESTE_URL").unwrap();
        let jid = std::env::var("ZAPHUB_TESTE_JID").unwrap();
        let c = Cliente::novo(&url, None).unwrap();
        assert!(matches!(c.entrar(&std::env::var("ZAPHUB_TESTE_EMAIL").unwrap(), &std::env::var("ZAPHUB_TESTE_SENHA").unwrap(), "").await, Ok(Login::Ok)));
        let s = c.sessoes().await.unwrap();
        let sessao = &s[0].session_id;
        let (msgs, _) = c.mensagens(sessao, &jid, None).await.unwrap();
        if let Some(foto) = msgs.iter().find(|m| m.tipo.as_deref() == Some("IMAGE") && m.media_url.is_some()) {
            let dados = c.baixar(foto.media_url.as_deref().unwrap()).await.unwrap();
            let mini = crate::midia::miniatura(&dados).expect("foto decodificada");
            println!("foto {} bytes -> {}x{}", dados.len(), mini.width(), mini.height());
        }
        assert!(c.baixar("/api/media/../.env").await.is_err());
        assert!(c.baixar("https://exemplo.com/x.jpg").await.is_err());

        let mut png = Vec::new();
        image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(64, 64, image::Rgba([244, 169, 53, 255])))
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        c.enviar_midia(sessao, &jid, bytes::Bytes::from(png), "teste-programa-windows.png", "image/png", "image", "Teste do programa do Windows (envio de imagem)", None).await.unwrap();
        println!("imagem enviada");
    }

    /// Fixacao do certificado num servidor https publico (precisa de internet): cargo test -- --ignored fixacao
    #[tokio::test]
    #[ignore]
    async fn fixacao_bloqueia_outro_certificado() {
        let origem = "https://github.com";
        let lido = tokio::task::spawn_blocking(move || tls::ler(origem)).await.unwrap().unwrap();
        let certo = tls::Fixacao { chave_publica: lido.chave_publica, certificado: Some(lido.impressao) };
        let ok = Cliente::novo(origem, Some(&certo)).unwrap();
        let r = ok.http.get(origem).send().await;
        assert!(r.is_ok(), "com o certificado confirmado deveria conectar: {r:?}");

        let errado = tls::Fixacao { chave_publica: Some("AA:".repeat(31) + "AA"), certificado: None };
        let outro = Cliente::novo(origem, Some(&errado)).unwrap();
        let r = outro.http.get(origem).send().await.map_err(erro_rede);
        assert!(matches!(r, Err(Erro::Certificado)), "com outro certificado tinha que bloquear: {:?}", r.err());
        assert!(Cliente::novo(origem, None).is_err(), "https sem certificado confirmado nao pode");
    }

    #[test]
    fn teto_do_corpo_da_resposta() {
        assert_eq!(LIMITE_JSON, 10 * 1024 * 1024);
        assert!(cabe(0, LIMITE_JSON, LIMITE_JSON));
        assert!(cabe(LIMITE_JSON - 1, 1, LIMITE_JSON));
        assert!(!cabe(LIMITE_JSON, 1, LIMITE_JSON));
        assert!(!cabe(usize::MAX, 1, usize::MAX), "soma estourando nao passa");
    }

    #[test]
    fn codifica_jid_e_data() {
        assert_eq!(enc("5541999@s.whatsapp.net"), "5541999%40s.whatsapp.net");
        assert_eq!(enc("2026-11-13T10:00:00.000Z"), "2026-11-13T10%3A00%3A00.000Z");
    }
}
