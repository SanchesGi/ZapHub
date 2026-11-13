//! Converte os dados do servidor no que a tela mostra (nomes, previas, horas, separador de dia).

use crate::api;
use crate::{Conversa, Mensagem, ReacaoItem, SessaoItem};
use chrono::{DateTime, Local, NaiveDate};

pub fn sessao_item(s: &api::SessaoWa) -> SessaoItem {
    SessaoItem { nome: s.name.clone().into(), conectada: s.status == "CONNECTED", privada: s.privada }
}

/// cor fixa por pessoa/conversa (indice na paleta do tema)
pub fn cor(chave: &str) -> i32 {
    (chave.bytes().fold(7u32, |h, b| h.wrapping_mul(31).wrapping_add(b as u32)) % 10) as i32
}

pub fn inicial_de(nome: &str) -> String {
    inicial(nome)
}

pub fn estado_sessao(s: &api::SessaoWa) -> String {
    match s.status.as_str() {
        "CONNECTED" => String::new(),
        "LOGGED_OUT" => "Sessão desconectada do celular. Leia o QR de novo no painel.".into(),
        _ => "Sessão sem conexão com o WhatsApp agora. As mensagens chegam quando ela voltar.".into(),
    }
}

/// so os digitos do numero (ou "Contato" para identificador interno @lid)
pub fn numero(jid: &str) -> String {
    let (n, dominio) = jid.split_once('@').unwrap_or((jid, ""));
    if dominio == "lid" {
        return "Contato".into();
    }
    let n = n.split(':').next().unwrap_or(n);
    if dominio == "s.whatsapp.net" && n.len() >= 12 && n.starts_with("55") {
        // +55 41 98888-7777 / +55 41 8888-7777
        let (ddd, resto) = (&n[2..4], &n[4..]);
        let corte = resto.len().saturating_sub(4);
        return format!("+55 {ddd} {}-{}", &resto[..corte], &resto[corte..]);
    }
    if dominio == "s.whatsapp.net" {
        return format!("+{n}");
    }
    n.to_string()
}

pub fn nome_conversa(c: &api::Conversa) -> String {
    c.name.clone().filter(|s| !s.trim().is_empty()).or_else(|| c.notify.clone().filter(|s| !s.trim().is_empty())).unwrap_or_else(|| numero(&c.jid))
}

pub fn info_conversa(jid: &str) -> String {
    if jid.ends_with("@g.us") {
        "Grupo".into()
    } else {
        numero(jid)
    }
}

fn inicial(nome: &str) -> String {
    nome.chars().find(|c| c.is_alphanumeric()).map(|c| c.to_uppercase().collect()).unwrap_or_else(|| "#".into())
}

pub fn previa_tipo(tipo: Option<&str>) -> &'static str {
    match tipo.unwrap_or("") {
        "IMAGE" => "📷 Foto",
        "VIDEO" => "🎬 Vídeo",
        "AUDIO" => "🎤 Áudio",
        "DOCUMENT" => "📄 Documento",
        "STICKER" => "Figurinha",
        "LOCATION" => "📍 Localização",
        "CONTACT" => "👤 Contato",
        _ => "",
    }
}

fn texto_mensagem(conteudo: Option<&str>, tipo: Option<&str>) -> String {
    let t = conteudo.unwrap_or("").trim();
    let rotulo = previa_tipo(tipo);
    match (t.is_empty(), rotulo.is_empty()) {
        (false, true) => t.to_string(),
        (false, false) => format!("{rotulo}\n{t}"),
        (true, false) => rotulo.to_string(),
        (true, true) => "Mensagem sem texto".into(),
    }
}

fn quando(iso: Option<&str>) -> Option<DateTime<Local>> {
    DateTime::parse_from_rfc3339(iso?).ok().map(|d| d.with_timezone(&Local))
}

/// "13/11/26 14:05", para resultados de busca
pub fn data_hora(iso: Option<&str>) -> String {
    quando(iso).map(|d| d.format("%d/%m/%y %H:%M").to_string()).unwrap_or_default()
}

fn hora_lista(iso: Option<&str>, hoje: NaiveDate) -> String {
    let Some(d) = quando(iso) else { return String::new() };
    let dia = d.date_naive();
    if dia == hoje {
        d.format("%H:%M").to_string()
    } else if Some(dia) == hoje.pred_opt() {
        "Ontem".into()
    } else {
        d.format("%d/%m/%y").to_string()
    }
}

fn nome_dia(dia: NaiveDate, hoje: NaiveDate) -> String {
    if dia == hoje {
        "Hoje".into()
    } else if Some(dia) == hoje.pred_opt() {
        "Ontem".into()
    } else {
        dia.format("%d/%m/%Y").to_string()
    }
}

pub fn conversa(c: &api::Conversa, _aberta: Option<&str>) -> Conversa {
    let nome = nome_conversa(c);
    let hoje = Local::now().date_naive();
    let previa = c
        .last_message
        .as_ref()
        .map(|m| {
            let t = texto_mensagem(m.content.as_deref(), m.tipo.as_deref()).replace('\n', " ");
            t
        })
        .unwrap_or_default();
    Conversa {
        jid: c.jid.clone().into(),
        inicial: inicial(&nome).into(),
        nome: nome.into(),
        previa: previa.chars().take(120).collect::<String>().into(),
        hora: hora_lista(c.last_message.as_ref().and_then(|m| m.timestamp.as_deref()), hoje).into(),
        nao_lidas: c.unread.clamp(0, 999) as i32,
        marcada: c.nao_lida,
        grupo: c.jid.ends_with("@g.us"),
        fixada: c.fixada,
        silenciada: c.silenciada,
        minha: c.last_message.as_ref().map(|m| m.from_me).unwrap_or(false),
        status: c.last_message.as_ref().and_then(|m| m.status.clone()).unwrap_or_default().into(),
        cor: cor(&c.jid),
        foto: Default::default(),
        tem_foto: false,
    }
}

/// Dados de uma mensagem prontos para a tela, sem a imagem (a imagem do Slint so existe na thread da tela).
#[derive(Clone)]
pub struct MsgDados {
    pub id: String,
    pub minha: bool,
    pub texto: String,
    pub rotulo: String,
    pub nova: bool,
    pub cor: i32,
    pub hora: String,
    pub autor: String,
    pub status: String,
    pub dia: String,
    /// foto/figurinha com arquivo no servidor
    pub foto: bool,
    /// documento, video ou audio: cartao com nome e botoes
    pub arquivo: String,
    pub indisponivel: bool,
    /// audio/voz com arquivo: player
    pub audio: bool,
    /// resposta: a mensagem citada (id, autor, trecho)
    pub citada: Option<(String, String, String)>,
    pub reacoes: Vec<crate::acoes::Grupo>,
    pub extra: crate::acoes::Extra,
}

/// Tamanho (largura, altura) com que uma foto aparece no balao: cabe em 300x320 e nunca aumenta; com legenda a
/// largura minima e 200 px (senao o texto fica espremido em coluna).
pub fn dimensoes_imagem(largura: f32, altura: f32, com_legenda: bool) -> (f32, f32) {
    let k = (300.0 / largura.max(1.0)).min(320.0 / altura.max(1.0)).min(1.0);
    let minimo = if com_legenda { 200.0 } else { 60.0 };
    ((largura * k).max(minimo), (altura * k).max(60.0))
}

impl MsgDados {
    pub fn para_tela(&self, img: Option<&slint::SharedPixelBuffer<slint::Rgba8Pixel>>, som: Option<&(String, bool, f32, String)>) -> Mensagem {
        let som = som.filter(|s| s.0 == self.id);
        let (l, a) = match img {
            Some(b) => dimensoes_imagem(b.width() as f32, b.height() as f32, !self.texto.is_empty()),
            None => (260.0, 180.0),
        };
        Mensagem {
            id: self.id.clone().into(),
            minha: self.minha,
            texto: self.texto.clone().into(),
            rotulo: self.rotulo.clone().into(),
            nova: self.nova,
            cor: self.cor,
            hora: self.hora.clone().into(),
            autor: self.autor.clone().into(),
            status: self.status.clone().into(),
            dia: self.dia.clone().into(),
            tem_imagem: self.foto,
            imagem: img.map(|b| slint::Image::from_rgba8(b.clone())).unwrap_or_default(),
            carregando_imagem: self.foto && img.is_none(),
            img_largura: l,
            img_altura: a,
            arquivo: self.arquivo.clone().into(),
            tem_arquivo: !self.arquivo.is_empty(),
            indisponivel: self.indisponivel,
            eh_audio: self.audio,
            tocando: som.map(|s| s.1).unwrap_or(false),
            progresso: som.map(|s| s.2).unwrap_or(0.0),
            tempo: som.map(|s| s.3.clone()).unwrap_or_default().into(),
            citada: self.citada.is_some(),
            citada_id: self.citada.as_ref().map(|c| c.0.clone()).unwrap_or_default().into(),
            citada_autor: self.citada.as_ref().map(|c| c.1.clone()).unwrap_or_default().into(),
            citada_texto: self.citada.as_ref().map(|c| c.2.clone()).unwrap_or_default().into(),
            reacoes: slint::ModelRc::new(slint::VecModel::from(
                self.reacoes.iter().map(|g| ReacaoItem { emoji: g.emoji.clone().into(), quantidade: g.quantidade as i32, minha: g.minha }).collect::<Vec<_>>(),
            )),
            encaminhada: self.extra.encaminhada,
            editada: self.extra.editada,
            apagada: self.extra.apagada,
        }
    }
}

fn tem_midia(tipo: &str) -> bool {
    matches!(tipo, "IMAGE" | "STICKER" | "VIDEO" | "AUDIO" | "DOCUMENT")
}

pub fn mensagens(lista: &[api::Mensagem], jid: &str) -> Vec<MsgDados> {
    let grupo = jid.ends_with("@g.us");
    let hoje = Local::now().date_naive();
    let mut dia_anterior: Option<NaiveDate> = None;
    lista
        .iter()
        .map(|m| {
            let d = quando(m.timestamp.as_deref());
            let dia = d.map(|x| x.date_naive());
            let separador = match dia {
                Some(x) if Some(x) != dia_anterior => nome_dia(x, hoje),
                _ => String::new(),
            };
            if dia.is_some() {
                dia_anterior = dia;
            }
            let autor = if m.from_me {
                m.sent_by.clone().unwrap_or_default()
            } else if grupo {
                m.sender_name.clone().or_else(|| m.push_name.clone()).unwrap_or_default()
            } else {
                String::new()
            };
            let chave_autor = if m.from_me { String::new() } else { autor.clone() };
            let tipo = m.tipo.as_deref().unwrap_or("TEXT");
            let url = m.media_url.as_deref().filter(|u| crate::midia::caminho_valido(u));
            let foto = matches!(tipo, "IMAGE" | "STICKER") && url.is_some();
            let arquivo = match (tipo, url) {
                ("DOCUMENT" | "VIDEO", Some(u)) => crate::midia::nome_download(tipo, m.content.as_deref(), u, m.timestamp.as_deref()),
                _ => String::new(),
            };
            let indisponivel = tem_midia(tipo) && url.is_none();
            let audio = tipo == "AUDIO" && url.is_some();
            // documento: o conteudo e o nome do arquivo (ja aparece no cartao), nao uma legenda
            let texto = if tipo == "DOCUMENT" { String::new() } else { m.content.clone().unwrap_or_default().trim().to_string() };
            let rotulo = if indisponivel {
                format!("{} · indisponível", previa_tipo(Some(tipo)))
            } else if foto || audio || !arquivo.is_empty() {
                String::new()
            } else {
                match previa_tipo(Some(tipo)) {
                    "" if texto.is_empty() => "Mensagem sem texto".to_string(),
                    r => r.to_string(),
                }
            };
            MsgDados {
                id: m.key_id.clone(),
                minha: m.from_me,
                texto,
                rotulo,
                nova: m.live,
                cor: cor(&chave_autor),
                hora: d.map(|x| x.format("%H:%M").to_string()).unwrap_or_default(),
                autor,
                status: m.status.clone().unwrap_or_default(),
                dia: separador,
                foto,
                arquivo,
                indisponivel,
                audio,
                citada: m.quoted.as_ref().map(|c| (c.key_id.clone().unwrap_or_default(), crate::acoes::autor_citacao(c), crate::acoes::trecho_citacao(c))),
                reacoes: crate::acoes::agrupar(&m.reacoes),
                extra: m.extra.clone(),
            }
        })
        .collect()
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn formata_numeros() {
        assert_eq!(numero("5541988887777@s.whatsapp.net"), "+55 41 98888-7777");
        assert_eq!(numero("554188887777@s.whatsapp.net"), "+55 41 8888-7777");
        assert_eq!(numero("14155550123@s.whatsapp.net"), "+14155550123");
        assert_eq!(numero("1234@lid"), "Contato");
    }

    #[test]
    fn tamanho_da_foto_no_balao() {
        // larga: limitada pela largura 300; nunca aumenta; minimo 60
        assert_eq!(dimensoes_imagem(600.0, 300.0, false), (300.0, 150.0));
        assert_eq!(dimensoes_imagem(100.0, 100.0, false), (100.0, 100.0));
        assert_eq!(dimensoes_imagem(10.0, 10.0, false), (60.0, 60.0));
        // alta: limitada pela altura 320
        assert_eq!(dimensoes_imagem(200.0, 640.0, false), (100.0, 320.0));
        // com legenda a largura minima e 200
        assert_eq!(dimensoes_imagem(100.0, 100.0, true).0, 200.0);
        // medida zero nao divide por zero
        let (l, a) = dimensoes_imagem(0.0, 0.0, false);
        assert!(l.is_finite() && a.is_finite());
    }

    #[test]
    fn texto_por_tipo() {
        assert_eq!(texto_mensagem(Some("oi"), Some("TEXT")), "oi");
        assert_eq!(texto_mensagem(None, Some("IMAGE")), "📷 Foto");
        assert_eq!(texto_mensagem(Some("legenda"), Some("IMAGE")), "📷 Foto\nlegenda");
    }

    #[test]
    fn separa_os_dias() {
        let m = |id: &str, ts: &str| api::Mensagem {
            key_id: id.into(), remote_jid: "x@s.whatsapp.net".into(), from_me: false, content: Some("a".into()),
            tipo: Some("TEXT".into()), timestamp: Some(ts.into()), status: None, media_url: None,
            sender_name: None, push_name: None, sent_by: None, live: false,
            quoted: None, reacoes: Vec::new(), extra: Default::default(),
        };
        let v = mensagens(&[m("1", "2026-01-10T12:00:00Z"), m("2", "2026-01-10T13:00:00Z"), m("3", "2026-01-12T12:00:00Z")], "x@s.whatsapp.net");
        assert_ne!(v[0].dia, "");
        assert_eq!(v[1].dia, "");
        assert_ne!(v[2].dia, "");
    }
}
