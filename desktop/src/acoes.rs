//! Acoes na mensagem (conversa aberta): responder com citacao, reagir, copiar, encaminhar, apagar,
//! salvar midia e buscar dentro da conversa. A parte de cima do arquivo e logica pura (testada); a de baixo
//! liga a tela (global `Acoes` em ui/acoes.slint) ao servidor.

use crate::api::{self, Erro};
use crate::{formato, Acoes, App, App2, DestinoItem};
use serde::{Deserialize, Deserializer};
use serde_json::Value;
use slint::{ComponentHandle, ModelRc, VecModel};
use std::time::Duration;

/// quantas conversas, no maximo, recebem uma mensagem encaminhada
const MAX_DESTINOS: usize = 5;
/// paginas de historico que "ir para a mensagem" baixa, no maximo, procurando uma mensagem antiga
const MAX_PAGINAS_LOCALIZAR: usize = 40;
const TEXTO_APAGADA: &str = "🚫 Esta mensagem foi apagada";

// ---------- dados que vem do servidor ----------

/// Uma pessoa reagiu com um emoji.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Reacao {
    pub emoji: String,
    pub nome: Option<String>,
    pub minha: bool,
}

/// Reacoes iguais juntas, para os chips embaixo do balao.
#[derive(Debug, Clone, PartialEq)]
pub struct Grupo {
    pub emoji: String,
    pub quantidade: u32,
    pub minha: bool,
}

/// Mensagem citada (resposta).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Citada {
    #[serde(default)]
    pub key_id: Option<String>,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub from_me: bool,
    #[serde(default)]
    pub sender_name: Option<String>,
    #[serde(default)]
    pub push_name: Option<String>,
    #[serde(default)]
    pub sent_by: Option<String>,
    #[serde(default, rename = "type")]
    pub tipo: Option<String>,
}

/// Marcas discretas do balao.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Extra {
    pub encaminhada: bool,
    pub editada: bool,
    pub apagada: bool,
}

pub fn citada_tolerante<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Citada>, D::Error> {
    let v = Value::deserialize(d)?;
    Ok(if v.is_object() { serde_json::from_value(v).ok() } else { None })
}

pub fn reacoes_tolerantes<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<Reacao>, D::Error> {
    Ok(reacoes_de_json(&Value::deserialize(d)?))
}

pub fn extra_tolerante<'de, D: Deserializer<'de>>(d: D) -> Result<Extra, D::Error> {
    Ok(extra_de_json(&Value::deserialize(d)?))
}

/// `reacoes` do servidor: null ou { "<jid ou 'eu'>": { "e": "👍", "n": "Nome" } }. Tambem aceita uma lista
/// de { emoji } / textos, por tolerancia a versoes do servidor.
pub fn reacoes_de_json(v: &Value) -> Vec<Reacao> {
    match v {
        Value::Object(mapa) => mapa
            .iter()
            .filter_map(|(quem, item)| {
                let (emoji, nome) = match item {
                    Value::Object(o) => (
                        o.get("e").or_else(|| o.get("emoji")).and_then(Value::as_str)?.to_string(),
                        o.get("n").or_else(|| o.get("nome")).and_then(Value::as_str).map(String::from),
                    ),
                    Value::String(s) => (s.clone(), None),
                    _ => return None,
                };
                (!emoji.trim().is_empty()).then(|| Reacao { emoji, nome, minha: quem == "eu" })
            })
            .collect(),
        Value::Array(lista) => lista
            .iter()
            .filter_map(|item| {
                let (emoji, minha) = match item {
                    Value::String(s) => (s.clone(), false),
                    Value::Object(o) => (
                        o.get("emoji").or_else(|| o.get("e")).and_then(Value::as_str)?.to_string(),
                        o.get("minha").or_else(|| o.get("fromMe")).and_then(Value::as_bool).unwrap_or(false),
                    ),
                    _ => return None,
                };
                (!emoji.trim().is_empty()).then_some(Reacao { emoji, nome: None, minha })
            })
            .collect(),
        _ => Vec::new(),
    }
}

fn verdadeiro(v: &Value) -> bool {
    match v {
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().unwrap_or(0.0) > 0.0,
        Value::String(s) => !s.is_empty() && s != "false",
        Value::Object(_) | Value::Array(_) => true,
        Value::Null => false,
    }
}

/// `extra` pode vir como objeto ou como texto JSON.
pub fn extra_de_json(v: &Value) -> Extra {
    let objeto = match v {
        Value::String(s) => serde_json::from_str(s).unwrap_or(Value::Null),
        outro => outro.clone(),
    };
    let marca = |nome: &str| objeto.get(nome).map(verdadeiro).unwrap_or(false);
    Extra { encaminhada: marca("encaminhada"), editada: marca("editada"), apagada: marca("apagada") }
}

// ---------- logica pura ----------

/// Junta reacoes iguais (mais votadas primeiro; empate mantem a ordem em que chegaram).
pub fn agrupar(reacoes: &[Reacao]) -> Vec<Grupo> {
    let mut grupos: Vec<Grupo> = Vec::new();
    for r in reacoes {
        match grupos.iter_mut().find(|g| g.emoji == r.emoji) {
            Some(g) => {
                g.quantidade += 1;
                g.minha |= r.minha;
            }
            None => grupos.push(Grupo { emoji: r.emoji.clone(), quantidade: 1, minha: r.minha }),
        }
    }
    grupos.sort_by_key(|g| std::cmp::Reverse(g.quantidade));
    grupos
}

/// O que enviar ao clicar num emoji: repetir o emoji que ja e meu remove a reacao ("").
pub fn nova_reacao(atual: &[Reacao], clicado: &str) -> String {
    if atual.iter().any(|r| r.minha && r.emoji == clicado) {
        String::new()
    } else {
        clicado.to_string()
    }
}

/// Mostra a reacao na hora, antes de o servidor confirmar: troca a minha pelo emoji novo (ou tira).
pub fn aplicar_reacao_local(reacoes: &mut Vec<Reacao>, emoji: &str) {
    reacoes.retain(|r| !r.minha);
    if !emoji.is_empty() {
        reacoes.push(Reacao { emoji: emoji.to_string(), nome: None, minha: true });
    }
}

/// Pode editar esta mensagem? None = pode; senao o motivo. Mesma regra do servidor (src/lib/editar-mensagem.ts):
/// propria, de texto, nao apagada e com ate 15 minutos (limite do WhatsApp).
pub fn motivo_para_nao_editar(m: &api::Mensagem, agora: chrono::DateTime<chrono::Utc>) -> Option<&'static str> {
    if !m.from_me {
        return Some("Só dá para editar mensagens enviadas por você");
    }
    if m.tipo.as_deref().unwrap_or("TEXT") != "TEXT" {
        return Some("Só dá para editar mensagens de texto");
    }
    if m.extra.apagada {
        return Some("A mensagem foi apagada");
    }
    let Some(quando) = m.timestamp.as_deref().and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok()) else {
        return Some("Mensagem sem data");
    };
    if agora.signed_duration_since(quando.with_timezone(&chrono::Utc)) > chrono::Duration::minutes(15) {
        return Some("O WhatsApp só deixa editar até 15 minutos depois de enviar");
    }
    None
}

/// A resposta que a faixa mostra agora e a mesma que acabou de ser enviada? (so ela fecha a faixa)
pub fn mesma_resposta(na_faixa: Option<&str>, enviada: Option<&str>) -> bool {
    enviada.is_some() && na_faixa == enviada
}

/// Uma linha so, espacos juntos, cortada em `max` caracteres com reticencias.
pub fn trecho(texto: &str, max: usize) -> String {
    let junto = texto.split_whitespace().collect::<Vec<_>>().join(" ");
    if junto.chars().count() <= max {
        return junto;
    }
    let corte: String = junto.chars().take(max.saturating_sub(1)).collect();
    format!("{}…", corte.trim_end())
}

fn nao_vazio(s: &Option<String>) -> Option<&str> {
    s.as_deref().map(str::trim).filter(|t| !t.is_empty())
}

/// Trecho da mensagem citada; sem texto, o rotulo do tipo (foto, audio...).
pub fn trecho_citacao(c: &Citada) -> String {
    let t = trecho(c.content.as_deref().unwrap_or(""), 140);
    if !t.is_empty() {
        return t;
    }
    match formato::previa_tipo(c.tipo.as_deref()) {
        "" => "Mensagem".into(),
        p => p.into(),
    }
}

pub fn autor_citacao(c: &Citada) -> String {
    if c.from_me {
        nao_vazio(&c.sent_by).unwrap_or("Você").to_string()
    } else {
        nao_vazio(&c.sender_name).or_else(|| nao_vazio(&c.push_name)).unwrap_or("Contato").to_string()
    }
}

/// Resumo de uma mensagem para a faixa "Respondendo a".
pub fn resumo_mensagem(m: &api::Mensagem) -> String {
    let t = trecho(m.content.as_deref().unwrap_or(""), 140);
    if !t.is_empty() && m.tipo.as_deref() != Some("DOCUMENT") {
        return t;
    }
    match (formato::previa_tipo(m.tipo.as_deref()), t.is_empty()) {
        ("", true) => "Mensagem".into(),
        ("", false) => t,
        (p, true) => p.into(),
        (p, false) => format!("{p} {t}"),
    }
}

/// Janela do texto em volta da primeira ocorrencia da busca (para o resultado mostrar o trecho achado).
pub fn trecho_busca(conteudo: &str, busca: &str, max: usize) -> String {
    let texto: Vec<char> = conteudo.split_whitespace().collect::<Vec<_>>().join(" ").chars().collect();
    if texto.len() <= max {
        return texto.into_iter().collect();
    }
    let baixo = |c: &char| c.to_lowercase().next().unwrap_or(*c);
    let palheiro: Vec<char> = texto.iter().map(baixo).collect();
    let agulha: Vec<char> = busca.trim().chars().map(|c| baixo(&c)).collect();
    let achado = if agulha.is_empty() { None } else { palheiro.windows(agulha.len()).position(|j| j == agulha.as_slice()) };
    let inicio = match achado {
        Some(p) => p.saturating_sub(max / 4).min(texto.len().saturating_sub(max)),
        None => 0,
    };
    let fim = (inicio + max).min(texto.len());
    let meio: String = texto[inicio..fim].iter().collect();
    format!("{}{}{}", if inicio > 0 { "…" } else { "" }, meio.trim(), if fim < texto.len() { "…" } else { "" })
}

/// Conversas (por indice) cujo nome ou numero contem a busca.
pub fn filtrar_destinos(conversas: &[api::Conversa], busca: &str) -> Vec<usize> {
    let q = busca.trim().to_lowercase();
    conversas
        .iter()
        .enumerate()
        .filter(|(_, c)| !c.jid.starts_with("status@"))
        .filter(|(_, c)| {
            q.is_empty() || formato::nome_conversa(c).to_lowercase().contains(&q) || c.jid.split('@').next().unwrap_or("").contains(&q)
        })
        .map(|(i, _)| i)
        .collect()
}

#[derive(Debug, PartialEq)]
pub enum Marcacao {
    Marcado,
    Desmarcado,
    Cheio,
}

pub fn alternar_destino(marcados: &mut Vec<String>, jid: &str, max: usize) -> Marcacao {
    if let Some(i) = marcados.iter().position(|j| j == jid) {
        marcados.remove(i);
        return Marcacao::Desmarcado;
    }
    if marcados.len() >= max {
        return Marcacao::Cheio;
    }
    marcados.push(jid.to_string());
    Marcacao::Marcado
}

// ---------- estado ----------

#[derive(Default)]
pub struct EstadoAcoes {
    /// keyId da mensagem que o proximo texto vai responder
    pub resposta: Option<String>,
    /// keyId da mensagem sendo editada (o proximo "enviar" salva a edicao em vez de mandar mensagem nova)
    pub editando: Option<String>,
    /// mensagem sendo encaminhada e conversas ja escolhidas
    pub encaminhando: Option<String>,
    pub marcados: Vec<String>,
    pub destino_busca: String,
    pub enviando_encaminhar: bool,
    /// busca na conversa: cada digitacao ou fechamento muda a geracao e descarta respostas atrasadas
    pub busca_ger: u64,
    /// ja ha uma pagina da busca sendo pedida (evita pedir a mesma pagina duas vezes)
    pub busca_em_andamento: bool,
    pub busca_q: String,
    pub busca_pagina: u32,
    pub busca_paginas: u32,
    pub resultados: Vec<api::ResultadoBusca>,
}

// ---------- ligacao com a tela e o servidor ----------

impl App2 {
    /// Liga os callbacks do global Acoes aos metodos abaixo.
    pub(crate) fn ligar_acoes(&self, ui: &App) {
        let g = ui.global::<Acoes>();
        let c = self.clone();
        g.on_responder(move |id| c.responder(id.to_string()));
        let c = self.clone();
        g.on_cancelar_resposta(move || c.limpar_resposta());
        let c = self.clone();
        g.on_editar(move |id| c.editar(id.to_string()));
        let c = self.clone();
        g.on_cancelar_edicao(move || c.limpar_edicao());
        let c = self.clone();
        g.on_reagir(move |id, emoji| c.reagir(id.to_string(), emoji.to_string()));
        let c = self.clone();
        g.on_copiar(move |id| c.copiar(id.to_string()));
        let c = self.clone();
        g.on_salvar_midia(move |id| c.salvar_midia(id.to_string()));
        let c = self.clone();
        g.on_apagar(move |id| c.apagar(id.to_string()));
        let c = self.clone();
        g.on_encaminhar_abrir(move |id| c.encaminhar_abrir(id.to_string()));
        let c = self.clone();
        g.on_encaminhar_fechar(move || c.encaminhar_fechar());
        let c = self.clone();
        g.on_destino_buscar(move |t| c.destino_buscar(t.to_string()));
        let c = self.clone();
        g.on_destino_alternar(move |jid| c.destino_alternar(jid.to_string()));
        let c = self.clone();
        g.on_encaminhar_enviar(move || c.encaminhar_enviar());
        let c = self.clone();
        g.on_ir_para(move |id| c.ir_para(id.to_string()));
        let c = self.clone();
        g.on_busca_digitada(move |t| c.busca_digitada(t.to_string()));
        let c = self.clone();
        g.on_busca_mais(move || c.busca_mais());
        let c = self.clone();
        g.on_busca_fechou(move || c.busca_fechou());
    }

    /// Aviso curto e neutro (nao e erro): "Texto copiado".
    pub(crate) fn toast(&self, texto: String) {
        self.tela(move |ui| {
            ui.global::<Acoes>().set_aviso_ultimo(texto.clone().into());
            ui.global::<Acoes>().set_aviso_leve(texto.clone().into());
            let w = ui.as_weak();
            slint::Timer::single_shot(Duration::from_millis(2600), move || {
                if let Some(ui) = w.upgrade() {
                    let g = ui.global::<Acoes>();
                    if g.get_aviso_leve() == texto.as_str() {
                        g.set_aviso_leve("".into());
                    }
                }
            });
        });
    }

    /// Ao trocar de conversa/sessao ou sair: some tudo o que era da conversa anterior.
    pub(crate) fn acoes_ao_abrir(&self) {
        self.est(|e| {
            e.acoes.resposta = None;
            e.acoes.editando = None;
            e.acoes.encaminhando = None;
            e.acoes.marcados.clear();
            e.acoes.destino_busca.clear();
            e.acoes.busca_ger += 1;
            e.acoes.busca_em_andamento = false;
            e.acoes.busca_q.clear();
            e.acoes.resultados.clear();
        });
        self.tela(|ui| {
            let g = ui.global::<Acoes>();
            g.set_resp_id("".into());
            g.set_edit_id("".into());
            g.set_menu_aberto(false);
            g.set_apagar_id("".into());
            g.set_enc_aberto(false);
            g.set_enc_busca("".into());
            g.set_destinos(ModelRc::default());
            g.set_busca_aberta(false);
            g.set_busca_texto("".into());
            g.set_busca_resultados(ModelRc::default());
            g.set_busca_carregando(false);
            g.set_busca_feita(false);
            g.set_busca_erro("".into());
            g.set_alvo_id("".into());
            g.set_alvo_pendente(false);
            g.set_localizando(false);
        });
    }

    // ---------- responder ----------
    fn responder(&self, id: String) {
        let dados = self.est(|e| {
            let m = e.mensagens.iter().find(|m| m.key_id == id)?;
            let autor = if m.from_me {
                "você".to_string()
            } else {
                nao_vazio(&m.sender_name)
                    .or_else(|| nao_vazio(&m.push_name))
                    .map(String::from)
                    .or_else(|| e.conversas.iter().find(|c| c.jid == m.remote_jid).map(formato::nome_conversa))
                    .unwrap_or_else(|| "contato".into())
            };
            Some((autor, resumo_mensagem(m)))
        });
        let Some((autor, texto)) = dados else { return };
        // responder e editar nao andam juntos: escolher um fecha o outro
        let estava_editando = self.est(|e| {
            e.acoes.resposta = Some(id.clone());
            e.acoes.editando.take().is_some()
        });
        self.tela(move |ui| {
            let g = ui.global::<Acoes>();
            if estava_editando {
                g.set_edit_id("".into());
                ui.set_rascunho("".into());
            }
            g.set_resp_id(id.into());
            g.set_resp_autor(autor.into());
            g.set_resp_texto(texto.into());
            ui.invoke_focar_compositor();
        });
    }

    /// Cancela a resposta (X da faixa) ou limpa depois de enviar.
    pub(crate) fn limpar_resposta(&self) {
        self.est(|e| e.acoes.resposta = None);
        self.tela(|ui| ui.global::<Acoes>().set_resp_id("".into()));
    }

    /// Depois de enviar: fecha a faixa so se ela ainda e a resposta que foi enviada (a pessoa pode ter escolhido
    /// outra mensagem para responder enquanto o envio terminava).
    pub(crate) fn limpar_resposta_se(&self, enviada: Option<&str>) {
        if self.est(|e| mesma_resposta(e.acoes.resposta.as_deref(), enviada)) {
            self.limpar_resposta();
        }
    }

    // ---------- editar ----------
    /// "Editar" no menu: confere a regra aqui (o servidor confere de novo) e poe o texto atual na caixa.
    fn editar(&self, id: String) {
        let r = self.est(|e| {
            let m = e.mensagens.iter().find(|m| m.key_id == id)?;
            Some(match motivo_para_nao_editar(m, chrono::Utc::now()) {
                Some(motivo) => Err(motivo),
                None => Ok(m.content.clone().unwrap_or_default()),
            })
        });
        match r {
            None => {}
            Some(Err(motivo)) => self.toast(motivo.to_string()),
            Some(Ok(texto)) => {
                self.est(|e| {
                    e.acoes.editando = Some(id.clone());
                    e.acoes.resposta = None;
                });
                let resumo: String = texto.replace('\n', " ").chars().take(120).collect();
                self.tela(move |ui| {
                    let g = ui.global::<Acoes>();
                    g.set_resp_id("".into());
                    g.set_edit_texto(resumo.into());
                    g.set_edit_id(id.into());
                    ui.set_rascunho(texto.into());
                    ui.invoke_focar_compositor();
                });
            }
        }
    }

    /// X da faixa "Editando": desiste e limpa a caixa.
    pub(crate) fn limpar_edicao(&self) {
        self.est(|e| e.acoes.editando = None);
        self.tela(|ui| {
            ui.global::<Acoes>().set_edit_id("".into());
            ui.set_rascunho("".into());
        });
    }

    /// Enter com uma edicao aberta: salva o texto novo na mensagem (PATCH) em vez de mandar mensagem nova.
    pub(crate) fn salvar_edicao(&self, id: String, texto: String) {
        let novo = texto.trim().to_string();
        if novo.is_empty() {
            return;
        }
        let Some(c) = self.cliente() else { return };
        let Some((sessao, jid)) = self.est(|e| Some((e.sessao.clone()?, e.jid.clone()?))) else { return };
        self.tela(|ui| ui.set_rascunho("".into()));
        let a = self.clone();
        self.lancar(async move {
            match c.editar_mensagem(&sessao, &jid, &id, &novo).await {
                Ok(()) => {
                    let fechou = a.est(|e| {
                        if let Some(m) = e.mensagens.iter_mut().find(|m| m.key_id == id) {
                            m.content = Some(novo.clone());
                            m.extra.editada = true;
                        }
                        // so fecha a faixa se ainda e esta edicao (a pessoa pode ter escolhido outra enquanto salvava)
                        let mesma = e.acoes.editando.as_deref() == Some(id.as_str());
                        if mesma {
                            e.acoes.editando = None;
                        }
                        mesma
                    });
                    if fechou {
                        a.tela(|ui| ui.global::<Acoes>().set_edit_id("".into()));
                    }
                    a.mostrar_mensagens(false);
                    a.toast("Mensagem editada".into());
                }
                Err(m) => {
                    // devolve o texto para nao perder o que foi digitado
                    a.tela(move |ui| {
                        if ui.get_rascunho().is_empty() {
                            ui.set_rascunho(novo.into());
                        }
                    });
                    a.falhou(m);
                }
            }
        });
    }

    // ---------- reagir ----------
    fn reagir(&self, id: String, emoji: String) {
        let Some(c) = self.cliente() else { return };
        // emoji ate 20 caracteres (limite do servidor)
        let emoji: String = emoji.chars().take(20).collect();
        let dados = self.est(|e| {
            let (sessao, jid) = (e.sessao.clone()?, e.jid.clone()?);
            let m = e.mensagens.iter_mut().find(|m| m.key_id == id)?;
            let novo = nova_reacao(&m.reacoes, &emoji);
            let antes = m.reacoes.clone();
            aplicar_reacao_local(&mut m.reacoes, &novo);
            Some((sessao, jid, novo, antes))
        });
        let Some((sessao, jid, novo, antes)) = dados else { return };
        self.mostrar_mensagens(false);
        let a = self.clone();
        self.lancar(async move {
            if let Err(m) = c.reagir(&sessao, &jid, &id, &novo).await {
                // o servidor recusou: volta ao que era
                a.est(|e| {
                    if let Some(x) = e.mensagens.iter_mut().find(|x| x.key_id == id) {
                        x.reacoes = antes;
                    }
                });
                a.mostrar_mensagens(false);
                a.falhou(m);
            }
        });
    }

    /// Evento "message.reaction": {sessionKey, keyId, reacoes}
    pub(crate) fn reacao_recebida(&self, dados: Value) {
        let Some(key) = dados.get("keyId").and_then(Value::as_str) else { return };
        let novas = reacoes_de_json(dados.get("reacoes").unwrap_or(&Value::Null));
        let mudou = self.est(|e| match e.mensagens.iter_mut().find(|m| m.key_id == key) {
            Some(m) => {
                m.reacoes = novas;
                true
            }
            None => false,
        });
        if mudou {
            self.mostrar_mensagens(false);
        }
    }

    // ---------- copiar ----------
    fn copiar(&self, id: String) {
        let texto = self.est(|e| e.mensagens.iter().find(|m| m.key_id == id).and_then(|m| m.content.clone())).filter(|t| !t.trim().is_empty());
        let Some(texto) = texto else { return };
        match arboard::Clipboard::new().and_then(|mut c| c.set_text(texto)) {
            Ok(()) => self.toast("Texto copiado".into()),
            Err(e) => self.avisar(format!("Não consegui copiar o texto: {e}")),
        }
    }

    // ---------- apagar ----------
    fn apagar(&self, id: String) {
        let Some(c) = self.cliente() else { return };
        let Some((sessao, jid)) = self.est(|e| Some((e.sessao.clone()?, e.jid.clone()?))) else { return };
        let a = self.clone();
        self.lancar(async move {
            match c.apagar_mensagem(&sessao, &jid, &id).await {
                Ok(r) => {
                    let para_mim = r.modo == "PARA_MIM";
                    a.est(|e| {
                        if para_mim {
                            e.mensagens.retain(|m| m.key_id != id);
                        } else if let Some(m) = e.mensagens.iter_mut().find(|m| m.key_id == id) {
                            m.content = Some(TEXTO_APAGADA.into());
                            m.tipo = Some("TEXT".into());
                            m.media_url = None;
                            m.reacoes.clear();
                            m.extra.apagada = true;
                        }
                    });
                    a.mostrar_mensagens(false);
                    let padrao = if para_mim { "Mensagem apagada só para você." } else { "Mensagem apagada para todos." };
                    let aviso = r.aviso.as_deref().map(str::trim).filter(|t| !t.is_empty()).map(|t| trecho(t, 160)).unwrap_or_else(|| padrao.into());
                    a.toast(aviso);
                }
                Err(m) => a.falhou(m),
            }
        });
    }

    // ---------- encaminhar ----------
    fn encaminhar_abrir(&self, id: String) {
        self.est(|e| {
            e.acoes.encaminhando = Some(id);
            e.acoes.marcados.clear();
            e.acoes.destino_busca.clear();
        });
        self.atualizar_destinos();
    }

    fn encaminhar_fechar(&self) {
        self.est(|e| {
            e.acoes.encaminhando = None;
            e.acoes.marcados.clear();
            e.acoes.destino_busca.clear();
        });
        self.tela(|ui| {
            let g = ui.global::<Acoes>();
            g.set_enc_aberto(false);
            g.set_enc_busca("".into());
            g.set_destinos(ModelRc::default());
            g.set_enc_marcados(0);
        });
    }

    fn destino_buscar(&self, t: String) {
        self.est(|e| e.acoes.destino_busca = t);
        self.atualizar_destinos();
    }

    fn destino_alternar(&self, jid: String) {
        let r = self.est(|e| alternar_destino(&mut e.acoes.marcados, &jid, MAX_DESTINOS));
        if r == Marcacao::Cheio {
            self.toast(format!("Escolha até {MAX_DESTINOS} conversas."));
        }
        self.atualizar_destinos();
    }

    /// Lista do dialogo: conversas carregadas, filtradas pela busca, com as escolhidas marcadas.
    fn atualizar_destinos(&self) {
        let (itens, marcados) = self.est(|e| {
            let indices = filtrar_destinos(&e.conversas, &e.acoes.destino_busca);
            let itens: Vec<DestinoItem> = indices
                .into_iter()
                .map(|i| {
                    let c = &e.conversas[i];
                    let nome = formato::nome_conversa(c);
                    DestinoItem {
                        jid: c.jid.clone().into(),
                        inicial: formato::inicial_de(&nome).into(),
                        nome: nome.into(),
                        cor: formato::cor(&c.jid),
                        grupo: c.jid.ends_with("@g.us"),
                        marcado: e.acoes.marcados.contains(&c.jid),
                    }
                })
                .collect();
            (itens, e.acoes.marcados.len() as i32)
        });
        self.tela(move |ui| {
            let g = ui.global::<Acoes>();
            g.set_destinos(ModelRc::new(VecModel::from(itens)));
            g.set_enc_marcados(marcados);
        });
    }

    fn encaminhar_enviar(&self) {
        let Some(c) = self.cliente() else { return };
        let dados = self.est(|e| {
            if e.acoes.enviando_encaminhar || e.acoes.marcados.is_empty() {
                return None;
            }
            let chave = e.acoes.encaminhando.clone()?;
            let sessao = e.sessao.clone()?;
            e.acoes.enviando_encaminhar = true;
            Some((sessao, chave, e.acoes.marcados.clone()))
        });
        let Some((sessao, chave, destinos)) = dados else { return };
        self.tela(|ui| ui.global::<Acoes>().set_enc_enviando(true));
        let a = self.clone();
        self.lancar(async move {
            let r = c.encaminhar(&sessao, &chave, &destinos).await;
            a.est(|e| e.acoes.enviando_encaminhar = false);
            a.tela(|ui| ui.global::<Acoes>().set_enc_enviando(false));
            match r {
                Ok(res) if res.falhas.is_empty() && res.enviados > 0 => {
                    a.encaminhar_fechar();
                    a.toast(if res.enviados == 1 { "Mensagem encaminhada.".into() } else { format!("Mensagem encaminhada para {} conversas.", res.enviados) });
                }
                Ok(res) => a.encaminhar_com_falhas(res),
                Err(m) => a.falhou(m),
            }
        });
    }

    /// Algumas (ou todas) as conversas nao receberam: mantem so elas marcadas, para tentar de novo.
    fn encaminhar_com_falhas(&self, res: api::ResultadoEncaminhar) {
        let falhas: Vec<String> = res.falhas.iter().map(|f| f.jid.clone()).collect();
        let primeira = res.falhas.first().map(|f| {
            let nome = self.est(|e| e.conversas.iter().find(|c| c.jid == f.jid).map(formato::nome_conversa)).unwrap_or_else(|| formato::numero(&f.jid));
            let motivo = if f.erro.trim().is_empty() { "erro desconhecido".to_string() } else { trecho(&f.erro, 120) };
            format!("{nome}: {motivo}")
        });
        if !falhas.is_empty() {
            self.est(|e| e.acoes.marcados.retain(|j| falhas.contains(j)));
            self.atualizar_destinos();
        }
        if res.enviados > 0 {
            self.toast(format!("Encaminhada para {} conversa(s); {} falhou.", res.enviados, falhas.len()));
        }
        self.avisar(match primeira {
            Some(p) if falhas.len() > 1 => format!("Não consegui encaminhar para {} conversas. Primeira: {p}", falhas.len()),
            Some(p) => format!("Não consegui encaminhar para {p}"),
            None => "Não consegui encaminhar a mensagem.".into(),
        });
    }

    // ---------- ir para a mensagem ----------
    fn ir_para(&self, id: String) {
        if self.est(|e| e.mensagens.iter().any(|m| m.key_id == id)) {
            self.destacar(id);
        } else {
            self.carregar_ate(id);
        }
    }

    /// Pinta o balao e deixa a tela rolar ate ele (ver Balao e CamadaAcoes no Slint). O indice da mensagem e
    /// calculado AQUI, na thread da tela, pelo id: nao pode ficar velho se a lista mudar no meio do caminho.
    fn destacar(&self, id: String) {
        self.tela(move |ui| {
            use slint::Model;
            let modelo = ui.get_mensagens();
            let Some(indice) = (0..modelo.row_count()).find(|&i| modelo.row_data(i).is_some_and(|m| m.id.as_str() == id)) else { return };
            let g = ui.global::<Acoes>();
            g.set_alvo_tentativas(0);
            g.set_alvo_indice(indice as i32);
            g.set_alvo_id(id.clone().into());
            g.set_alvo_pendente(true);
            let w = ui.as_weak();
            slint::Timer::single_shot(Duration::from_millis(3200), move || {
                if let Some(ui) = w.upgrade() {
                    let g = ui.global::<Acoes>();
                    if g.get_alvo_id() == id.as_str() {
                        g.set_alvo_id("".into());
                        g.set_alvo_pendente(false);
                    }
                }
            });
        });
    }

    /// A mensagem e mais antiga que o carregado: baixa paginas anteriores ate achar (com limite).
    fn carregar_ate(&self, id: String) {
        let Some(c) = self.cliente() else { return };
        // marca "carregando" enquanto procura: "Mensagens anteriores" nao dispara outra carga ao mesmo tempo
        let Some((sessao, jid, g, marcou)) = self.est(|e| {
            let marcou = !e.carregando;
            e.carregando = true;
            Some((e.sessao.clone()?, e.jid.clone()?, e.ger_conversa, marcou))
        }) else {
            return;
        };
        self.tela(|ui| ui.global::<Acoes>().set_localizando(true));
        let a = self.clone();
        self.lancar(async move {
            let mut achada = false;
            let mut falhou = false;
            for _ in 0..MAX_PAGINAS_LOCALIZAR {
                // a pagina anterior comeca antes da primeira mensagem COM data (a primeira da lista pode nao ter)
                let antes = a.est(|e| if e.ger_conversa == g { e.mensagens.iter().find_map(|m| m.timestamp.clone()) } else { None });
                let Some(antes) = antes else { break };
                match c.mensagens(&sessao, &jid, Some(&antes)).await {
                    Ok((lista, mais)) => {
                        let r = a.est(|e| {
                            if e.ger_conversa != g {
                                return None;
                            }
                            crate::logica::mesclar_mensagens(&mut e.mensagens, lista);
                            e.tem_mais = mais;
                            Some((e.mensagens.iter().any(|m| m.key_id == id), mais))
                        });
                        match r {
                            Some((true, _)) => {
                                achada = true;
                                break;
                            }
                            Some((false, true)) => {}
                            _ => break,
                        }
                    }
                    Err(m) => {
                        falhou = true;
                        a.falhou(m);
                        break;
                    }
                }
            }
            a.tela(|ui| ui.global::<Acoes>().set_localizando(false));
            let mesma = a.est(|e| {
                let mesma = e.ger_conversa == g;
                if mesma && marcou {
                    e.carregando = false;
                }
                mesma
            });
            if !mesma {
                return;
            }
            a.mostrar_mensagens(false);
            if achada {
                tokio::time::sleep(Duration::from_millis(120)).await;
                a.destacar(id);
            } else if !falhou {
                a.avisar("Não encontrei essa mensagem no histórico desta conversa.".into());
            }
        });
    }

    // ---------- busca na conversa ----------
    fn busca_digitada(&self, t: String) {
        let q = t.trim().to_string();
        let g = self.est(|e| {
            e.acoes.busca_ger += 1;
            e.acoes.busca_em_andamento = false;
            e.acoes.busca_q = q.clone();
            e.acoes.busca_pagina = 0;
            e.acoes.busca_paginas = 0;
            e.acoes.resultados.clear();
            e.acoes.busca_ger
        });
        if q.is_empty() {
            self.mostrar_resultados_busca(false);
            return;
        }
        let a = self.clone();
        self.lancar(async move {
            tokio::time::sleep(Duration::from_millis(350)).await;
            if a.est(|e| e.acoes.busca_ger) == g {
                a.buscar_pagina(1, g);
            }
        });
    }

    fn busca_mais(&self) {
        // clique repetido em "Ver mais" nao pede a mesma pagina duas vezes
        let proxima = self.est(|e| {
            (!e.acoes.busca_em_andamento && e.acoes.busca_pagina < e.acoes.busca_paginas).then_some((e.acoes.busca_pagina + 1, e.acoes.busca_ger))
        });
        if let Some((p, g)) = proxima {
            self.buscar_pagina(p, g);
        }
    }

    fn busca_fechou(&self) {
        self.est(|e| {
            e.acoes.busca_ger += 1;
            e.acoes.busca_em_andamento = false;
            e.acoes.busca_q.clear();
            e.acoes.resultados.clear();
        });
        self.tela(|ui| {
            let g = ui.global::<Acoes>();
            g.set_busca_texto("".into());
            g.set_busca_resultados(ModelRc::default());
            g.set_busca_carregando(false);
            g.set_busca_feita(false);
            g.set_busca_erro("".into());
        });
    }

    fn buscar_pagina(&self, pagina: u32, g: u64) {
        let Some(c) = self.cliente() else { return };
        let Some((sessao, jid, q)) = self.est(|e| {
            if e.acoes.busca_em_andamento {
                return None;
            }
            e.acoes.busca_em_andamento = true;
            Some((e.sessao.clone()?, e.jid.clone()?, e.acoes.busca_q.clone()))
        }) else {
            return;
        };
        self.tela(|ui| {
            let ui_g = ui.global::<Acoes>();
            ui_g.set_busca_carregando(true);
            ui_g.set_busca_erro("".into());
        });
        let a = self.clone();
        self.lancar(async move {
            let r = c.buscar_na_conversa(&sessao, &jid, &q, pagina).await;
            let atual = a.est(|e| {
                // uma busca nova (outra geracao) ja zerou o "em andamento" e pode ter iniciado a sua
                let atual = e.acoes.busca_ger == g;
                if atual {
                    e.acoes.busca_em_andamento = false;
                }
                atual
            });
            if !atual {
                return;
            }
            match r {
                Ok(p) => {
                    let total = p.total;
                    a.est(|e| {
                        e.acoes.busca_pagina = pagina;
                        e.acoes.busca_paginas = p.paginas;
                        for x in p.resultados {
                            if !e.acoes.resultados.iter().any(|y| y.key_id == x.key_id) {
                                e.acoes.resultados.push(x);
                            }
                        }
                    });
                    a.mostrar_resultados_busca(true);
                    a.tela(move |ui| ui.global::<Acoes>().set_busca_total(total as i32));
                }
                Err(Erro::Msg(m)) => a.tela(move |ui| {
                    let ui_g = ui.global::<Acoes>();
                    ui_g.set_busca_carregando(false);
                    ui_g.set_busca_erro(m.into());
                }),
                Err(m) => {
                    // erro de login/termos: o spinner da busca nao fica ligado
                    a.tela(|ui| ui.global::<Acoes>().set_busca_carregando(false));
                    a.falhou(m);
                }
            }
        });
    }

    fn mostrar_resultados_busca(&self, feita: bool) {
        let (itens, tem_mais) = self.est(|e| {
            let itens: Vec<crate::ResultadoBusca> = e
                .acoes
                .resultados
                .iter()
                .map(|r| {
                    let texto = match r.content.as_deref().map(str::trim).filter(|t| !t.is_empty()) {
                        Some(t) => trecho_busca(t, &e.acoes.busca_q, 160),
                        None => formato::previa_tipo(r.tipo.as_deref()).to_string(),
                    };
                    let autor = if r.from_me { "Você".to_string() } else { nao_vazio(&r.sender_name).unwrap_or("Contato").to_string() };
                    crate::ResultadoBusca { id: r.key_id.clone().into(), texto: texto.into(), quando: formato::data_hora(r.timestamp.as_deref()).into(), autor: autor.into() }
                })
                .collect();
            (itens, e.acoes.busca_pagina < e.acoes.busca_paginas)
        });
        self.tela(move |ui| {
            let g = ui.global::<Acoes>();
            g.set_busca_resultados(ModelRc::new(VecModel::from(itens)));
            g.set_busca_tem_mais(tem_mais);
            g.set_busca_carregando(false);
            g.set_busca_feita(feita);
        });
    }
}

#[cfg(test)]
mod testes {
    use super::*;
    use serde_json::json;

    fn r(emoji: &str, minha: bool) -> Reacao {
        Reacao { emoji: emoji.into(), nome: None, minha }
    }

    #[test]
    fn le_reacoes_no_formato_do_servidor() {
        let v = json!({ "5541999990000@s.whatsapp.net": { "e": "👍", "n": "Ana" }, "eu": { "e": "👍", "n": null }, "x@lid": { "e": "❤️" }, "vazio": { "e": "" } });
        let lista = reacoes_de_json(&v);
        assert_eq!(lista.len(), 3);
        assert!(lista.iter().any(|x| x.minha && x.emoji == "👍"));
        assert!(lista.iter().any(|x| x.nome.as_deref() == Some("Ana")));
        assert!(reacoes_de_json(&Value::Null).is_empty());
        assert!(reacoes_de_json(&json!(42)).is_empty());
    }

    #[test]
    fn le_reacoes_em_lista_por_tolerancia() {
        let lista = reacoes_de_json(&json!([{ "emoji": "😂", "minha": true }, "🙏", { "sem": 1 }]));
        assert_eq!(lista.len(), 2);
        assert!(lista[0].minha && !lista[1].minha);
    }

    #[test]
    fn agrupa_reacoes_iguais_e_ordena_pelas_mais_votadas() {
        let g = agrupar(&[r("❤️", false), r("👍", false), r("👍", true), r("👍", false)]);
        assert_eq!(g.len(), 2);
        assert_eq!(g[0], Grupo { emoji: "👍".into(), quantidade: 3, minha: true });
        assert_eq!(g[1], Grupo { emoji: "❤️".into(), quantidade: 1, minha: false });
        assert!(agrupar(&[]).is_empty());
    }

    #[test]
    fn clicar_no_emoji_que_e_meu_remove() {
        let atual = vec![r("👍", true), r("❤️", false)];
        assert_eq!(nova_reacao(&atual, "👍"), "");
        assert_eq!(nova_reacao(&atual, "❤️"), "❤️");
        assert_eq!(nova_reacao(&atual, "🙏"), "🙏");
    }

    #[test]
    fn reacao_local_troca_a_minha() {
        let mut v = vec![r("👍", true), r("👍", false)];
        aplicar_reacao_local(&mut v, "🙏");
        assert_eq!(v.len(), 2);
        assert!(v.iter().any(|x| x.minha && x.emoji == "🙏"));
        aplicar_reacao_local(&mut v, "");
        assert!(v.iter().all(|x| !x.minha));
    }

    #[test]
    fn regra_de_editar_igual_a_do_servidor() {
        let agora = chrono::DateTime::parse_from_rfc3339("2026-11-14T12:00:00Z").unwrap().with_timezone(&chrono::Utc);
        let msg = |minha: bool, tipo: &str, ts: &str| -> api::Mensagem {
            serde_json::from_value(json!({ "keyId": "K1", "remoteJid": "x@s.whatsapp.net", "fromMe": minha, "type": tipo, "timestamp": ts })).unwrap()
        };
        assert_eq!(motivo_para_nao_editar(&msg(true, "TEXT", "2026-11-14T11:50:00Z"), agora), None);
        assert_eq!(motivo_para_nao_editar(&msg(true, "TEXT", "2026-11-14T11:45:00Z"), agora), None, "15 minutos exatos ainda pode");
        assert!(motivo_para_nao_editar(&msg(true, "TEXT", "2026-11-14T11:44:00Z"), agora).unwrap().contains("15 minutos"));
        assert!(motivo_para_nao_editar(&msg(false, "TEXT", "2026-11-14T11:59:00Z"), agora).unwrap().contains("por você"));
        assert!(motivo_para_nao_editar(&msg(true, "IMAGE", "2026-11-14T11:59:00Z"), agora).unwrap().contains("texto"));
        let mut apagada = msg(true, "TEXT", "2026-11-14T11:59:00Z");
        apagada.extra.apagada = true;
        assert!(motivo_para_nao_editar(&apagada, agora).unwrap().contains("apagada"));
    }

    #[test]
    fn faixa_so_fecha_se_for_a_resposta_enviada() {
        assert!(mesma_resposta(Some("K1"), Some("K1")));
        assert!(!mesma_resposta(Some("K2"), Some("K1")), "a pessoa escolheu outra enquanto enviava");
        assert!(!mesma_resposta(None, Some("K1")));
        assert!(!mesma_resposta(Some("K1"), None), "envio sem resposta nao fecha a faixa");
        assert!(!mesma_resposta(None, None));
    }

    #[test]
    fn trecho_junta_espacos_e_corta_sem_quebrar_caractere() {
        assert_eq!(trecho("  oi\n\n  tudo   bem ", 50), "oi tudo bem");
        assert_eq!(trecho("abcdefghij", 5), "abcd…");
        assert_eq!(trecho("ação ação ação", 6), "ação…");
        assert_eq!(trecho("", 5), "");
    }

    #[test]
    fn citacao_usa_texto_ou_o_tipo() {
        let mut c = Citada { content: Some("Boa tarde,   tudo certo?".into()), ..Default::default() };
        assert_eq!(trecho_citacao(&c), "Boa tarde, tudo certo?");
        c.content = None;
        c.tipo = Some("IMAGE".into());
        assert_eq!(trecho_citacao(&c), "📷 Foto");
        c.tipo = None;
        assert_eq!(trecho_citacao(&c), "Mensagem");
    }

    #[test]
    fn autor_da_citacao() {
        let mut c = Citada { from_me: true, ..Default::default() };
        assert_eq!(autor_citacao(&c), "Você");
        c.sent_by = Some("Carla".into());
        assert_eq!(autor_citacao(&c), "Carla");
        let c = Citada { sender_name: Some("  ".into()), push_name: Some("Bia".into()), ..Default::default() };
        assert_eq!(autor_citacao(&c), "Bia");
        assert_eq!(autor_citacao(&Citada::default()), "Contato");
    }

    #[test]
    fn trecho_da_busca_mostra_onde_achou() {
        let longo = format!("{} PEDIDO 4821 confirmado {}", "a".repeat(200), "b".repeat(200));
        let t = trecho_busca(&longo, "pedido 4821", 60);
        assert!(t.contains("PEDIDO 4821"), "{t}");
        assert!(t.starts_with('…') && t.ends_with('…'));
        assert_eq!(trecho_busca("curto", "x", 60), "curto");
        assert!(trecho_busca(&"z".repeat(300), "nada", 60).ends_with('…'));
    }

    fn conversas() -> Vec<api::Conversa> {
        serde_json::from_value(json!([
            { "jid": "5541988887777@s.whatsapp.net", "name": "Maria Souza" },
            { "jid": "120363@g.us", "name": "Equipe Vendas" },
            { "jid": "status@broadcast", "name": "Status" },
        ]))
        .expect("conversas de teste")
    }

    #[test]
    fn filtra_destinos_por_nome_e_numero() {
        let c = conversas();
        assert_eq!(filtrar_destinos(&c, ""), vec![0, 1]);
        assert_eq!(filtrar_destinos(&c, "maria"), vec![0]);
        assert_eq!(filtrar_destinos(&c, "VENDAS"), vec![1]);
        assert_eq!(filtrar_destinos(&c, "88887777"), vec![0]);
        assert!(filtrar_destinos(&c, "zzz").is_empty());
    }

    #[test]
    fn escolhe_no_maximo_cinco_destinos() {
        let mut m = Vec::new();
        for i in 0..5 {
            assert_eq!(alternar_destino(&mut m, &format!("j{i}"), 5), Marcacao::Marcado);
        }
        assert_eq!(alternar_destino(&mut m, "j9", 5), Marcacao::Cheio);
        assert_eq!(m.len(), 5);
        assert_eq!(alternar_destino(&mut m, "j0", 5), Marcacao::Desmarcado);
        assert_eq!(alternar_destino(&mut m, "j9", 5), Marcacao::Marcado);
    }

    #[test]
    fn mensagem_do_servidor_com_citacao_reacoes_e_extra() {
        let m: api::Mensagem = serde_json::from_value(json!({
            "keyId": "K1", "remoteJid": "x@s.whatsapp.net", "fromMe": false, "content": "oi",
            "quoted": { "keyId": "K0", "content": "antes", "fromMe": true, "sentBy": "Carla", "type": "TEXT" },
            "reacoes": { "eu": { "e": "👍", "n": null } },
            "extra": { "encaminhada": { "vezes": 2 }, "editada": true }
        }))
        .expect("mensagem");
        assert_eq!(m.quoted.as_ref().and_then(|q| q.key_id.as_deref()), Some("K0"));
        assert_eq!(m.reacoes.len(), 1);
        assert!(m.extra.encaminhada && m.extra.editada && !m.extra.apagada);

        // sem os campos, ou com formatos estranhos, a mensagem continua valida
        let simples: api::Mensagem = serde_json::from_value(json!({ "keyId": "K2", "remoteJid": "x@s.whatsapp.net", "quoted": null, "reacoes": null, "extra": "lixo" })).expect("mensagem simples");
        assert!(simples.quoted.is_none() && simples.reacoes.is_empty() && simples.extra == Extra::default());
        let estranha: api::Mensagem = serde_json::from_value(json!({ "keyId": "K3", "remoteJid": "x", "quoted": "texto", "reacoes": 7 })).expect("mensagem estranha");
        assert!(estranha.quoted.is_none() && estranha.reacoes.is_empty());
    }

    #[test]
    fn extra_pode_vir_como_texto_json() {
        let e = extra_de_json(&json!("{\"apagada\":true}"));
        assert!(e.apagada && !e.editada);
    }

    #[test]
    fn resposta_da_rota_de_apagar_e_do_encaminhar() {
        let r: api::RespostaApagar = serde_json::from_value(json!({ "ok": true, "modo": "PARA_MIM", "aviso": "So para voce" })).expect("apagar");
        assert_eq!(r.modo, "PARA_MIM");
        let e: api::ResultadoEncaminhar = serde_json::from_value(json!({ "ok": false, "enviados": 0, "falhas": [{ "jid": "a@s.whatsapp.net", "erro": "x" }] })).expect("encaminhar");
        assert_eq!(e.falhas.len(), 1);
        let b: api::PaginaBusca = serde_json::from_value(json!({ "ok": true, "resultados": [{ "keyId": "K", "content": "c", "fromMe": true, "timestamp": "2026-01-01T10:00:00Z", "type": "TEXT" }], "total": 1, "paginas": 1 })).expect("busca");
        assert_eq!(b.resultados[0].key_id, "K");
    }
}
