//! Rotas do painel do programa: contatos, verificar numero, estado da conversa (arquivar, silenciar, fixar,
//! nao lida), foto de perfil, informacoes do contato/grupo e aceite dos Termos de Uso.

use super::*;

// ---------- dados ----------
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Contato {
    pub jid: String,
    #[serde(default)]
    pub nome: Option<String>,
    #[serde(default)]
    pub numero: Option<String>,
    #[serde(default)]
    pub tem_conversa: bool,
}

#[derive(Debug, Clone, Default)]
pub struct PaginaContatos {
    pub contatos: Vec<Contato>,
    pub tem_mais: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Verificacao {
    #[serde(default)]
    pub existe: bool,
    #[serde(default)]
    pub jid: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Participante {
    pub jid: String,
    #[serde(default)]
    pub nome: Option<String>,
    #[serde(default)]
    pub admin: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Info {
    #[serde(default)]
    pub nome: Option<String>,
    #[serde(default)]
    pub numero: Option<String>,
    #[serde(default)]
    pub grupo: bool,
    #[serde(default)]
    pub descricao: Option<String>,
    #[serde(default)]
    pub participantes: Option<Vec<Participante>>,
}

#[derive(Debug, Clone)]
pub struct Termos {
    pub versao_atual: String,
    pub vigencia: String,
    pub precisa_aceitar: bool,
}

// ---------- regras puras ----------
/// Acoes que o servidor aceita em /estado.
pub const ACOES: [&str; 7] = ["arquivar", "desarquivar", "silenciar", "dessilenciar", "fixar", "desfixar", "nao-lida"];

pub fn acao_valida(acao: &str) -> bool {
    ACOES.contains(&acao)
}

/// Caminho da foto de perfil. So /api/app/<sessao>/conversas/<jid>/foto, com sessao e jid codificados:
/// nenhum valor vindo do WhatsApp muda o destino da requisicao nem leva o login para outro lugar.
pub fn caminho_foto(sessao: &str, jid: &str, grande: bool) -> String {
    let base = format!("/api/app/{}/conversas/{}/foto", enc(sessao), enc(jid));
    if grande {
        base + "?tamanho=grande"
    } else {
        base
    }
}

/// Mensagem para o limite de verificacoes (429), com o tempo de espera quando o servidor informa.
pub fn msg_limite(espera_s: Option<u64>) -> String {
    match espera_s {
        Some(s) if s > 0 => format!("Muitas verificações seguidas. Tente de novo em {s} s."),
        _ => "Muitas verificações seguidas. Tente de novo em instantes.".into(),
    }
}

/// So digitos, 8 a 15 (o servidor aceita formatacao, mas aqui mandamos limpo).
pub fn numero_valido(numero: &str) -> bool {
    (8..=15).contains(&numero.len()) && numero.bytes().all(|b| b.is_ascii_digit())
}

const LIMITE_FOTO: usize = 5 * 1024 * 1024;

impl Cliente {
    pub async fn contatos(&self, sessao: &str, busca: &str, pagina: u32) -> Result<PaginaContatos, Erro> {
        let mut u = url::Url::parse(&self.url(&format!("/api/app/{}/contatos", enc(sessao)))).map_err(|e| Erro::Msg(e.to_string()))?;
        {
            let mut q = u.query_pairs_mut();
            if !busca.trim().is_empty() {
                q.append_pair("busca", busca.trim());
            }
            q.append_pair("pagina", &pagina.max(1).to_string());
        }
        let caminho = format!("{}?{}", u.path(), u.query().unwrap_or(""));
        let v: serde_json::Value = self.get(&caminho).await?;
        let contatos = serde_json::from_value(v.get("contatos").cloned().unwrap_or_default()).map_err(|e| Erro::Msg(format!("Resposta inesperada: {e}")))?;
        Ok(PaginaContatos { contatos, tem_mais: v.get("temMais").and_then(|x| x.as_bool()).unwrap_or(false) })
    }

    /// O numero (so digitos, com o 55) tem WhatsApp? Devolve o jid para abrir a conversa.
    pub async fn verificar(&self, sessao: &str, numero: &str) -> Result<Verificacao, Erro> {
        if !numero_valido(numero) {
            return Err(Erro::Msg("Número inválido.".into()));
        }
        let caminho = format!("/api/app/{}/verificar?numero={}", enc(sessao), enc(numero));
        let r = self.http.get(self.url(&caminho)).header(COOKIE, self.cookie()).send().await.map_err(erro_rede)?;
        if r.status().as_u16() == 429 {
            let espera = r.headers().get("retry-after").and_then(|v| v.to_str().ok()).and_then(|v| v.trim().parse::<u64>().ok());
            return Err(Erro::Msg(msg_limite(espera)));
        }
        tratar(r).await
    }

    /// `ate`: so para "silenciar" (ISO futura ou "sempre"); sem `ate` o servidor silencia por 8 horas.
    pub async fn estado_conversa(&self, sessao: &str, jid: &str, acao: &str, ate: Option<&str>) -> Result<(), Erro> {
        if !acao_valida(acao) {
            return Err(Erro::Msg("Ação desconhecida.".into()));
        }
        let mut corpo = serde_json::json!({ "acao": acao });
        if let (Some(a), "silenciar") = (ate, acao) {
            corpo["ate"] = serde_json::Value::String(a.to_string());
        }
        let _: serde_json::Value = self.post_json(&format!("/api/app/{}/conversas/{}/estado", enc(sessao), enc(jid)), corpo).await?;
        Ok(())
    }

    /// Foto de perfil (None quando a conversa nao tem foto). `grande` e para o painel de informacoes.
    pub async fn foto(&self, sessao: &str, jid: &str, grande: bool) -> Result<Option<Vec<u8>>, Erro> {
        let mut r = self.http.get(self.url(&caminho_foto(sessao, jid, grande))).header(COOKIE, self.cookie()).send().await.map_err(erro_rede)?;
        match r.status().as_u16() {
            200 => {}
            401 => return Err(Erro::Sessao),
            404 | 403 | 204 => return Ok(None),
            c => return Err(Erro::Msg(format!("O servidor não entregou a foto ({c})."))),
        }
        let imagem = r.headers().get(CONTENT_TYPE).and_then(|v| v.to_str().ok()).map(|t| t.starts_with("image/")).unwrap_or(false);
        if !imagem {
            return Ok(None);
        }
        let mut dados = Vec::new();
        while let Some(parte) = r.chunk().await.map_err(erro_rede)? {
            if dados.len() + parte.len() > LIMITE_FOTO {
                return Ok(None);
            }
            dados.extend_from_slice(&parte);
        }
        Ok(Some(dados))
    }

    pub async fn info(&self, sessao: &str, jid: &str) -> Result<Info, Erro> {
        self.get(&format!("/api/app/{}/conversas/{}/info", enc(sessao), enc(jid))).await
    }

    // ---------- termos ----------
    pub async fn termos(&self) -> Result<Termos, Erro> {
        let v: serde_json::Value = self.get("/api/me/termos").await?;
        let d = v.get("data").cloned().unwrap_or_default();
        let texto = |k: &str| d.get(k).and_then(|x| x.as_str()).unwrap_or_default().to_string();
        let versao_atual = texto("versaoAtual");
        if versao_atual.is_empty() {
            return Err(Erro::Msg("Resposta inesperada do servidor sobre os termos.".into()));
        }
        Ok(Termos { versao_atual, vigencia: texto("vigencia"), precisa_aceitar: d.get("precisaAceitar").and_then(|x| x.as_bool()).unwrap_or(true) })
    }

    /// Registra o aceite e renova o login (o servidor guarda a versao aceita dentro do cookie da sessao).
    /// Devolve false se o cookie nao pode ser renovado: a pessoa precisa entrar de novo.
    pub async fn aceitar_termos(&self, versao: &str) -> Result<bool, Erro> {
        let _: serde_json::Value = self.post_json("/api/me/termos", serde_json::json!({ "versao": versao })).await?;
        Ok(self.renovar_sessao(versao).await)
    }

    async fn renovar_sessao(&self, versao: &str) -> bool {
        let Ok(r) = self.http.get(self.url("/api/auth/csrf")).header(COOKIE, self.cookie()).send().await else { return false };
        let cookies_csrf = juntar_cookies(r.headers(), |_| true);
        let csrf: serde_json::Value = r.json().await.unwrap_or_default();
        let token = csrf.get("csrfToken").and_then(|v| v.as_str()).unwrap_or_default().to_string();
        if token.is_empty() {
            return false;
        }
        let cookie = [cookies_csrf, self.cookie()].into_iter().filter(|c| !c.is_empty()).collect::<Vec<_>>().join("; ");
        let Ok(r) = self
            .http
            .post(self.url("/api/auth/session"))
            .header(COOKIE, cookie)
            .header(CONTENT_TYPE, "application/json")
            .body(serde_json::json!({ "csrfToken": token, "data": { "termosVersao": versao } }).to_string())
            .send()
            .await
        else {
            return false;
        };
        let novo = juntar_cookies(r.headers(), |n| n.contains("session-token"));
        if r.status().is_success() && !novo.is_empty() {
            self.usar_cookie(&novo);
            return true;
        }
        false
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn foto_so_pelo_caminho_do_app() {
        let c = caminho_foto("abc", "5541999998888@s.whatsapp.net", false);
        assert_eq!(c, "/api/app/abc/conversas/5541999998888%40s.whatsapp.net/foto");
        assert_eq!(caminho_foto("abc", "g@g.us", true), "/api/app/abc/conversas/g%40g.us/foto?tamanho=grande");
        // jid malicioso nao escapa do caminho
        let c = caminho_foto("s", "../../../etc/passwd?x=1#y", false);
        assert!(c.starts_with("/api/app/s/conversas/") && c.ends_with("/foto"));
        assert!(!c.contains("../") && !c.contains('?') && !c.contains('#'));
        assert_eq!(c.matches('/').count(), 6);
    }

    #[test]
    fn acoes_conhecidas() {
        for a in ACOES {
            assert!(acao_valida(a));
        }
        assert!(!acao_valida("apagar"));
        assert!(!acao_valida(""));
        assert!(!acao_valida("silenciar-8h"));
    }

    #[test]
    fn numero_so_digitos() {
        assert!(numero_valido("5541999998888"));
        assert!(numero_valido("12345678"));
        assert!(!numero_valido("1234567"));
        assert!(!numero_valido("1234567890123456"));
        assert!(!numero_valido("55 41 99999"));
        assert!(!numero_valido("+5541999998888"));
    }

    #[test]
    fn mensagem_do_limite() {
        assert!(msg_limite(Some(12)).contains("12 s"));
        assert!(msg_limite(None).contains("instantes"));
        assert!(msg_limite(Some(0)).contains("instantes"));
    }

    #[test]
    fn le_as_respostas_do_servidor() {
        let v = serde_json::json!({"ok": true, "contatos": [{"jid": "1@s.whatsapp.net", "nome": "Ana", "numero": "+55 41 99999-8888", "temConversa": true}, {"jid": "2@s.whatsapp.net"}], "temMais": true});
        let l: Vec<Contato> = serde_json::from_value(v["contatos"].clone()).unwrap();
        assert!(l[0].tem_conversa && l[0].nome.as_deref() == Some("Ana"));
        assert!(!l[1].tem_conversa && l[1].nome.is_none());
        let v: Verificacao = serde_json::from_value(serde_json::json!({"ok": true, "existe": false, "jid": null})).unwrap();
        assert!(!v.existe && v.jid.is_none());
        let i: Info = serde_json::from_value(serde_json::json!({"ok": true, "nome": "Time", "numero": null, "grupo": true, "descricao": "<b>oi</b>", "participantes": [{"jid": "1@s.whatsapp.net", "nome": "Ana", "admin": true}, {"jid": "2@lid", "nome": null}]})).unwrap();
        assert!(i.grupo && i.numero.is_none());
        let p = i.participantes.unwrap();
        assert!(p[0].admin && !p[1].admin && p[1].nome.is_none());
        let i: Info = serde_json::from_value(serde_json::json!({"ok": true, "nome": "Ana", "numero": "+55 41", "grupo": false})).unwrap();
        assert!(i.participantes.is_none());
    }
}
