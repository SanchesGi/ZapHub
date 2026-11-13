//! Painel do programa: nova conversa, menu da conversa (arquivar, silenciar, fixar, nao lida), fotos de perfil,
//! informacoes do contato/grupo, termos do servidor, configuracoes e contador de nao lidas.
//! A parte visual esta em ui/painel.slint; o estado chega pelo global `Painel`.

use crate::api::painel_api as pa;
use crate::api::{self, Erro};
use crate::{config, formato, sistema, App, App2, ContatoItem, Conversa, ParticipanteItem};
use crate::Painel as TelaPainel;
use slint::{ComponentHandle, Model, ModelRc, Rgba8Pixel, SharedPixelBuffer, VecModel};
use std::cell::RefCell;
use crate::cache::Lru;
use std::collections::HashSet;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Semaphore;

/// no maximo 4 fotos de perfil baixando ao mesmo tempo
const FOTOS_AO_MESMO_TEMPO: usize = 4;
/// teto das fotos de perfil em memoria (LRU em bytes; as marcas "sem foto" saem primeiro)
const TETO_FOTOS: usize = 48 * 1024 * 1024;
/// o que uma marca "sem foto" ocupa na conta
const BYTES_MARCA: usize = 128;
/// quem nao tem foto (ou deu erro) so e consultado de novo depois deste tempo
const REVER_SEM_FOTO: Duration = Duration::from_secs(10 * 60);
const LADO_MINIATURA: u32 = 160;
const LADO_GRANDE: u32 = 320;
const MAX_PARTICIPANTES: usize = 1500;

enum Foto {
    Tem(SharedPixelBuffer<Rgba8Pixel>),
    Nao(Instant),
}

/// Estado do painel (fica dentro do `Estado` do programa).
pub struct Dados {
    fotos: Lru<Foto>,
    baixando: HashSet<String>,
    fila: Arc<Semaphore>,
    contatos: Vec<pa::Contato>,
    contatos_busca: String,
    contatos_pagina: u32,
    contatos_mais: bool,
    contatos_carregando: bool,
    contatos_geracao: u64,
    info_aberto: bool,
    info_jid: Option<String>,
    info_geracao: u64,
    nao_lidas: i64,
    termos_aberto: bool,
    termos_versao: String,
}

impl Default for Dados {
    fn default() -> Self {
        Dados {
            fotos: Lru::novo(TETO_FOTOS),
            baixando: HashSet::new(),
            fila: Arc::new(Semaphore::new(FOTOS_AO_MESMO_TEMPO)),
            contatos: Vec::new(),
            contatos_busca: String::new(),
            contatos_pagina: 0,
            contatos_mais: true,
            contatos_carregando: false,
            contatos_geracao: 0,
            info_aberto: false,
            info_jid: None,
            info_geracao: 0,
            nao_lidas: 0,
            termos_aberto: false,
            termos_versao: String::new(),
        }
    }
}

fn chave(sessao: &str, jid: &str, grande: bool) -> String {
    format!("{}|{sessao}|{jid}", if grande { "g" } else { "p" })
}

impl Dados {
    fn foto(&self, sessao: &str, jid: &str, grande: bool) -> Option<SharedPixelBuffer<Rgba8Pixel>> {
        match self.fotos.obter(&chave(sessao, jid, grande)) {
            Some(Foto::Tem(b)) => Some(b.clone()),
            _ => None,
        }
    }

    fn precisa_baixar(&self, k: &str, agora: Instant) -> bool {
        if self.baixando.contains(k) {
            return false;
        }
        match self.fotos.espiar(k) {
            None => true,
            Some(Foto::Tem(_)) => false,
            Some(Foto::Nao(desde)) => agora.saturating_duration_since(*desde) >= REVER_SEM_FOTO,
        }
    }

    /// Guarda a foto (ou a marca "sem foto"); o que passar do teto de memoria sai do menos recente, as marcas primeiro.
    fn guardar(&mut self, k: String, f: Foto) {
        let (bytes, marca) = match &f {
            Foto::Tem(b) => (b.width() as usize * b.height() as usize * 4, false),
            Foto::Nao(_) => (BYTES_MARCA, true),
        };
        self.fotos.inserir(k, f, bytes, marca);
    }
}

// ---------- regras puras (testadas) ----------
/// Foto de perfil para a tela: quadrada, no tamanho pedido. Roda fora da thread da tela.
pub fn avatar(dados: &[u8], lado: u32) -> Option<SharedPixelBuffer<Rgba8Pixel>> {
    // com limites (8192x8192, 64 MB): foto enorme ou corrompida vira "sem foto"
    let img = crate::midia::decodificar(dados)?;
    let img = img.resize_to_fill(lado, lado, image::imageops::FilterType::Triangle);
    let rgba = img.to_rgba8();
    Some(SharedPixelBuffer::clone_from_slice(rgba.as_raw(), rgba.width(), rgba.height()))
}

/// Quantas mensagens nao lidas mostrar no icone da bandeja: conversas silenciadas nao contam;
/// conversa marcada como nao lida conta como 1.
pub fn total_nao_lidas(conversas: &[api::Conversa]) -> i64 {
    conversas.iter().filter(|c| !c.silenciada).map(|c| if c.unread > 0 { c.unread } else { i64::from(c.nao_lida) }).sum()
}

pub fn texto_bandeja(n: i64) -> String {
    match n {
        n if n <= 0 => "ZapHub".into(),
        1 => "ZapHub — 1 não lida".into(),
        n => format!("ZapHub — {n} não lidas"),
    }
}

pub fn titulo_janela(n: i64) -> String {
    if n <= 0 {
        "ZapHub".into()
    } else {
        format!("ZapHub ({})", if n > 99 { "99+".to_string() } else { n.to_string() })
    }
}

const ERRO_NUMERO: &str = "Digite o número com DDD, por exemplo (41) 99999-8888.";

/// Deixa o numero digitado so com digitos e com o 55: aceita (41) 99999-8888, 041 99999-8888,
/// 5541999998888 e, com "+", numeros de outros paises.
pub fn normalizar_numero(entrada: &str) -> Result<String, &'static str> {
    let texto = entrada.trim();
    let digitos: String = texto.chars().filter(|c| c.is_ascii_digit()).collect();
    let numero = if texto.starts_with('+') {
        digitos
    } else {
        let sem_zero = digitos.trim_start_matches('0').to_string();
        match sem_zero.len() {
            10 | 11 => format!("55{sem_zero}"),
            12 | 13 if sem_zero.starts_with("55") => sem_zero,
            _ => return Err(ERRO_NUMERO),
        }
    };
    if pa::numero_valido(&numero) {
        Ok(numero)
    } else {
        Err(ERRO_NUMERO)
    }
}

/// jid de pessoa devolvido pelo servidor: so aceita o formato esperado.
pub fn jid_pessoa_valido(jid: &str) -> bool {
    match jid.strip_suffix("@s.whatsapp.net") {
        Some(n) => (8..=20).contains(&n.len()) && n.bytes().all(|b| b.is_ascii_digit()),
        None => false,
    }
}

/// Acao do menu -> (acao do servidor, `ate`). "sempre" vai como texto; 8 h e 1 semana como data ISO.
pub fn traduzir_acao(acao: &str, agora: chrono::DateTime<chrono::Utc>) -> Option<(&'static str, Option<String>)> {
    let iso = |d: chrono::Duration| (agora + d).to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    match acao {
        "silenciar-8h" => Some(("silenciar", Some(iso(chrono::Duration::hours(8))))),
        "silenciar-1s" => Some(("silenciar", Some(iso(chrono::Duration::days(7))))),
        "silenciar-sempre" => Some(("silenciar", Some("sempre".into()))),
        outra => pa::ACOES.iter().find(|a| **a == outra).map(|a| (*a, None)),
    }
}

#[derive(Debug, PartialEq)]
pub enum Efeito {
    Alterou,
    /// sai da aba atual (arquivar/desarquivar)
    Remover,
    Nada,
}

/// Mostra o resultado na lista na hora, antes do servidor responder (se falhar, a lista e recarregada).
pub fn aplicar_local(c: &mut api::Conversa, acao: &str) -> Efeito {
    match acao {
        "fixar" => c.fixada = true,
        "desfixar" => c.fixada = false,
        "silenciar" => c.silenciada = true,
        "dessilenciar" => c.silenciada = false,
        "nao-lida" => c.nao_lida = true,
        "arquivar" | "desarquivar" => return Efeito::Remover,
        _ => return Efeito::Nada,
    }
    Efeito::Alterou
}

fn nome_contato(c: &pa::Contato) -> String {
    c.nome.clone().filter(|n| !n.trim().is_empty()).unwrap_or_else(|| formato::numero(&c.jid))
}

fn item_contato(c: &pa::Contato) -> ContatoItem {
    let nome = nome_contato(c);
    ContatoItem {
        jid: c.jid.clone().into(),
        inicial: formato::inicial_de(&nome).into(),
        numero: c.numero.clone().filter(|n| !n.trim().is_empty()).unwrap_or_else(|| formato::numero(&c.jid)).into(),
        cor: formato::cor(&c.jid),
        tem_conversa: c.tem_conversa,
        nome: nome.into(),
    }
}

/// (nome, detalhe): sem nome, o numero vira o nome e nao se repete embaixo.
pub fn rotulos_participante(p: &pa::Participante) -> (String, String) {
    let numero = formato::numero(&p.jid);
    match p.nome.as_deref().map(str::trim).filter(|n| !n.is_empty()) {
        Some(n) => (n.to_string(), if numero == "Contato" { String::new() } else { numero }),
        None => (numero, String::new()),
    }
}

fn item_participante(p: &pa::Participante) -> ParticipanteItem {
    let (nome, detalhe) = rotulos_participante(p);
    ParticipanteItem { inicial: formato::inicial_de(&nome).into(), cor: formato::cor(&p.jid), admin: p.admin, nome: nome.into(), detalhe: detalhe.into() }
}

/// Pagina de termos/privacidade do proprio servidor.
pub fn url_pagina(origem: &str, pagina: &str) -> Option<String> {
    matches!(pagina, "terms" | "privacy").then(|| format!("{}/{pagina}", origem.trim_end_matches('/')))
}

// ---------- bandeja e titulo ----------
thread_local! {
    static BANDEJA: RefCell<Option<tray_icon::TrayIcon>> = const { RefCell::new(None) };
}

/// Guarda o icone da bandeja (thread da tela) para o tooltip acompanhar o contador.
pub fn guardar_bandeja(b: Option<tray_icon::TrayIcon>) {
    BANDEJA.with(|x| *x.borrow_mut() = b);
}

/// thread da tela
fn mostrar_contagem(ui: &App, n: i64) {
    ui.global::<TelaPainel>().set_titulo(titulo_janela(n).into());
    BANDEJA.with(|b| {
        if let Some(t) = b.borrow().as_ref() {
            let _ = t.set_tooltip(Some(texto_bandeja(n)));
        }
    });
}

// ---------- ligacao com a tela ----------
pub fn ligar(ui: &App, a: &App2) {
    let g = ui.global::<TelaPainel>();
    g.set_cfg_versao(env!("CARGO_PKG_VERSION").into());
    let c = a.clone();
    g.on_acao_conversa(move |jid, acao| c.acao_conversa(jid.to_string(), acao.to_string()));
    let c = a.clone();
    g.on_abrir_novo(move || c.abrir_novo());
    let c = a.clone();
    g.on_buscar_contatos(move |t| c.buscar_contatos(t.to_string()));
    let c = a.clone();
    g.on_mais_contatos(move || c.carregar_contatos(false));
    let c = a.clone();
    g.on_escolher_contato(move |j| c.escolher_contato(j.to_string()));
    let c = a.clone();
    g.on_verificar_numero(move |t| c.verificar_numero(t.to_string()));
    let c = a.clone();
    g.on_alternar_info(move || {
        let aberto = c.ui.upgrade().map(|ui| ui.global::<TelaPainel>().get_info_aberto()).unwrap_or(false);
        c.alternar_info(aberto);
    });
    let c = a.clone();
    g.on_aceitar_termos(move || c.aceitar_termos());
    let c = a.clone();
    g.on_recusar_termos(move || c.recusar_termos());
    let c = a.clone();
    g.on_abrir_pagina_termos(move |p| c.abrir_pagina_termos(p.as_str()));
    let c = a.clone();
    g.on_config_aberta(move || c.config_aberta());
    let c = a.clone();
    g.on_definir_inicio(move |v| c.definir_inicio(v));
    let c = a.clone();
    g.on_definir_notificacoes(move |v| c.definir_notificacoes(v));
    let c = a.clone();
    g.on_definir_som(move |v| c.definir_som(v));
    let c = a.clone();
    g.on_testar_notificacao(move || c.testar_notificacao());
    let c = a.clone();
    g.on_trocar_servidor(move || c.trocar_servidor());
    let c = a.clone();
    g.on_sair_conta(move || c.sair());
}

struct Quadro {
    lista: Vec<api::Conversa>,
    fotos: Vec<Option<SharedPixelBuffer<Rgba8Pixel>>>,
    aberta: Option<Cabecalho>,
    pedir: Vec<String>,
    nao_lidas: i64,
}

struct Cabecalho {
    fixada: bool,
    silenciada: bool,
    arquivada: bool,
    nao_lida: bool,
    foto: Option<SharedPixelBuffer<Rgba8Pixel>>,
}

impl App2 {
    // ---------- lista de conversas com fotos, cabecalho e contador ----------
    pub(crate) fn mostrar_conversas_painel(&self) {
        let q = self.est(|e| {
            let sessao = e.sessao.clone().unwrap_or_default();
            let fotos = e.conversas.iter().map(|c| e.painel.foto(&sessao, &c.jid, false)).collect();
            let aberta = e.jid.as_ref().map(|j| {
                let c = e.conversas.iter().find(|c| &c.jid == j);
                Cabecalho {
                    fixada: c.map(|c| c.fixada).unwrap_or(false),
                    silenciada: c.map(|c| c.silenciada).unwrap_or(false),
                    arquivada: e.filtro == 3,
                    nao_lida: c.map(|c| c.unread > 0 || c.nao_lida).unwrap_or(false),
                    foto: e.painel.foto(&sessao, j, false),
                }
            });
            // so a aba "Todas" sem busca representa o total
            if e.filtro == 0 && e.busca.trim().is_empty() {
                e.painel.nao_lidas = total_nao_lidas(&e.conversas);
            }
            let mut pedir: Vec<String> = e.conversas.iter().map(|c| c.jid.clone()).collect();
            if let Some(j) = &e.jid {
                pedir.retain(|x| x != j);
                pedir.insert(0, j.clone());
            }
            Quadro { lista: e.conversas.clone(), fotos, aberta, pedir, nao_lidas: e.painel.nao_lidas }
        });
        self.pedir_fotos(q.pedir, false);
        let jid_aberto = self.est(|e| e.jid.clone());
        self.tela(move |ui| {
            let itens: Vec<Conversa> = q
                .lista
                .iter()
                .zip(q.fotos)
                .map(|(c, f)| {
                    let mut item = formato::conversa(c, jid_aberto.as_deref());
                    if let Some(b) = f {
                        item.foto = slint::Image::from_rgba8(b);
                        item.tem_foto = true;
                    }
                    item
                })
                .collect();
            ui.set_conversas(ModelRc::new(VecModel::from(itens)));
            let g = ui.global::<TelaPainel>();
            let cab = q.aberta;
            g.set_cab_fixada(cab.as_ref().map(|c| c.fixada).unwrap_or(false));
            g.set_cab_silenciada(cab.as_ref().map(|c| c.silenciada).unwrap_or(false));
            g.set_cab_arquivada(cab.as_ref().map(|c| c.arquivada).unwrap_or(false));
            g.set_cab_nao_lida(cab.as_ref().map(|c| c.nao_lida).unwrap_or(false));
            match cab.and_then(|c| c.foto) {
                Some(b) => {
                    g.set_cab_foto(slint::Image::from_rgba8(b));
                    g.set_cab_tem_foto(true);
                }
                None => g.set_cab_tem_foto(false),
            }
            mostrar_contagem(ui, q.nao_lidas);
        });
        self.sincronizar_info();
    }

    /// Chamado ao sair da conta: zera o contador do titulo e da bandeja.
    pub(crate) fn zerar_contagem(&self) {
        self.est(|e| e.painel.nao_lidas = 0);
        self.tela(|ui| {
            mostrar_contagem(ui, 0);
            ui.global::<TelaPainel>().set_info_aberto(false);
        });
        self.est(|e| {
            e.painel.info_aberto = false;
            e.painel.info_jid = None;
        });
    }

    // ---------- fotos de perfil ----------
    fn pedir_fotos(&self, jids: Vec<String>, grande: bool) {
        let Some(c) = self.cliente() else { return };
        let Some(sessao) = self.est(|e| e.sessao.clone()) else { return };
        for jid in jids {
            let k = chave(&sessao, &jid, grande);
            let fila = self.est(|e| {
                if !e.painel.precisa_baixar(&k, Instant::now()) {
                    return None;
                }
                e.painel.baixando.insert(k.clone());
                Some(e.painel.fila.clone())
            });
            let Some(fila) = fila else { continue };
            let (a, c, sessao) = (self.clone(), c.clone(), sessao.clone());
            self.lancar(async move {
                let _vaga = fila.acquire_owned().await;
                // depois de esperar a vez, a sessao pode ter mudado (ou o login acabado): nao baixa foto de quem ninguem ve
                if !a.est(|e| e.sessao.as_deref() == Some(sessao.as_str())) || !a.login_atual() {
                    a.est(|e| e.painel.baixando.remove(&k));
                    return;
                }
                let lado = if grande { LADO_GRANDE } else { LADO_MINIATURA };
                let buf = match c.foto(&sessao, &jid, grande).await {
                    Ok(Some(dados)) => tokio::task::spawn_blocking(move || avatar(&dados, lado)).await.ok().flatten(),
                    Ok(None) => None,
                    Err(m) => {
                        if matches!(m, Erro::Sessao | Erro::Certificado) {
                            a.falhou(m);
                        }
                        None
                    }
                };
                let tem = buf.is_some();
                a.est(|e| {
                    e.painel.baixando.remove(&k);
                    e.painel.guardar(k, buf.map(Foto::Tem).unwrap_or_else(|| Foto::Nao(Instant::now())));
                });
                if tem {
                    a.aplicar_foto(sessao, jid);
                }
            });
        }
    }

    /// Uma foto chegou: atualiza so a linha da lista, o cabecalho e o painel de informacoes (sem remontar a lista).
    fn aplicar_foto(&self, sessao: String, jid: String) {
        let (pequena, grande) = self.est(|e| {
            if e.sessao.as_deref() != Some(sessao.as_str()) {
                return (None, None);
            }
            (e.painel.foto(&sessao, &jid, false), e.painel.foto(&sessao, &jid, true))
        });
        if pequena.is_none() && grande.is_none() {
            return;
        }
        self.tela(move |ui| {
            let g = ui.global::<TelaPainel>();
            if let Some(b) = &pequena {
                let modelo = ui.get_conversas();
                for i in 0..modelo.row_count() {
                    if let Some(mut c) = modelo.row_data(i) {
                        if c.jid.as_str() == jid {
                            c.foto = slint::Image::from_rgba8(b.clone());
                            c.tem_foto = true;
                            modelo.set_row_data(i, c);
                        }
                    }
                }
                if ui.get_conversa_jid().as_str() == jid {
                    g.set_cab_foto(slint::Image::from_rgba8(b.clone()));
                    g.set_cab_tem_foto(true);
                }
            }
            if g.get_info_jid().as_str() == jid {
                if let Some(b) = grande.or(pequena) {
                    g.set_info_foto(slint::Image::from_rgba8(b));
                    g.set_info_tem_foto(true);
                }
            }
        });
    }

    // ---------- menu da conversa ----------
    pub(crate) fn acao_conversa(&self, jid: String, acao: String) {
        let Some(c) = self.cliente() else { return };
        let Some(sessao) = self.est(|e| e.sessao.clone()) else { return };
        if acao == "lida" {
            self.est(|e| {
                if let Some(x) = e.conversas.iter_mut().find(|x| x.jid == jid) {
                    x.unread = 0;
                    x.nao_lida = false;
                }
            });
            self.mostrar_conversas_painel();
            let a = self.clone();
            self.lancar(async move {
                if let Err(m) = c.marcar_lida(&sessao, &jid).await {
                    a.falhou(m);
                    a.carregar_conversas(true);
                }
            });
            return;
        }
        let Some((acao_api, ate)) = traduzir_acao(&acao, chrono::Utc::now()) else { return };
        self.est(|e| {
            if let Some(i) = e.conversas.iter().position(|x| x.jid == jid) {
                if aplicar_local(&mut e.conversas[i], acao_api) == Efeito::Remover {
                    e.conversas.remove(i);
                }
            }
        });
        self.mostrar_conversas_painel();
        let a = self.clone();
        self.lancar(async move {
            match c.estado_conversa(&sessao, &jid, acao_api, ate.as_deref()).await {
                Ok(()) => a.recarregar_conversas_em_breve(),
                Err(m) => {
                    a.falhou(m);
                    a.carregar_conversas(true);
                }
            }
        });
    }

    // ---------- nova conversa ----------
    pub(crate) fn abrir_novo(&self) {
        self.est(|e| {
            e.painel.contatos.clear();
            e.painel.contatos_busca.clear();
        });
        self.tela(|ui| {
            let g = ui.global::<TelaPainel>();
            g.set_contatos(ModelRc::default());
            g.set_contatos_erro("".into());
            g.set_numero_erro("".into());
            g.set_verificando(false);
        });
        self.carregar_contatos(true);
    }

    pub(crate) fn buscar_contatos(&self, texto: String) {
        let g = self.est(|e| {
            e.painel.contatos_busca = texto;
            e.painel.contatos_geracao += 1;
            e.painel.contatos_geracao
        });
        let a = self.clone();
        self.lancar(async move {
            tokio::time::sleep(Duration::from_millis(300)).await;
            if a.est(|e| e.painel.contatos_geracao) == g {
                a.carregar_contatos(true);
            }
        });
    }

    pub(crate) fn carregar_contatos(&self, do_inicio: bool) {
        let Some(c) = self.cliente() else { return };
        let pedido = self.est(|e| {
            let sessao = e.sessao.clone()?;
            let p = &mut e.painel;
            if !do_inicio && (p.contatos_carregando || !p.contatos_mais) {
                return None;
            }
            if do_inicio {
                p.contatos_geracao += 1;
                p.contatos.clear();
                p.contatos_pagina = 0;
                p.contatos_mais = true;
            }
            p.contatos_carregando = true;
            Some((sessao, p.contatos_busca.clone(), p.contatos_pagina + 1, p.contatos_geracao))
        });
        let Some((sessao, busca, pagina, g)) = pedido else { return };
        self.tela(|ui| {
            let t = ui.global::<TelaPainel>();
            t.set_contatos_carregando(true);
            t.set_contatos_erro("".into());
        });
        let a = self.clone();
        self.lancar(async move {
            let r = c.contatos(&sessao, &busca, pagina).await;
            if a.est(|e| e.painel.contatos_geracao) != g {
                return; // uma busca mais nova ja saiu
            }
            a.est(|e| e.painel.contatos_carregando = false);
            match r {
                Ok(p) => {
                    a.est(|e| {
                        for x in p.contatos {
                            if !e.painel.contatos.iter().any(|y| y.jid == x.jid) {
                                e.painel.contatos.push(x);
                            }
                        }
                        e.painel.contatos_pagina = pagina;
                        e.painel.contatos_mais = p.tem_mais;
                    });
                    a.mostrar_contatos(None);
                }
                Err(m) => match m {
                    Erro::Msg(t) => a.mostrar_contatos(Some(t)),
                    outro => {
                        a.mostrar_contatos(None);
                        a.falhou(outro);
                    }
                },
            }
        });
    }

    fn mostrar_contatos(&self, erro: Option<String>) {
        let itens: Vec<ContatoItem> = self.est(|e| e.painel.contatos.iter().map(item_contato).collect());
        self.tela(move |ui| {
            let g = ui.global::<TelaPainel>();
            g.set_contatos(ModelRc::new(VecModel::from(itens)));
            g.set_contatos_carregando(false);
            g.set_contatos_erro(erro.unwrap_or_default().into());
        });
    }

    pub(crate) fn escolher_contato(&self, jid: String) {
        let nome = self.est(|e| e.painel.contatos.iter().find(|c| c.jid == jid).map(nome_contato));
        self.tela(|ui| ui.global::<TelaPainel>().set_novo_aberto(false));
        self.abrir_com_nome(jid, nome);
    }

    /// Abre a conversa (mesmo sem mensagens) mostrando o nome do contato no lugar do numero.
    fn abrir_com_nome(&self, jid: String, nome: Option<String>) {
        self.abrir(jid);
        if let Some(n) = nome {
            self.tela(move |ui| {
                ui.set_conversa_inicial(formato::inicial_de(&n).into());
                ui.set_conversa_nome(n.into());
            });
        }
    }

    pub(crate) fn verificar_numero(&self, texto: String) {
        let numero = match normalizar_numero(&texto) {
            Ok(n) => n,
            Err(m) => return self.tela(move |ui| ui.global::<TelaPainel>().set_numero_erro(m.into())),
        };
        let (Some(c), Some(sessao)) = (self.cliente(), self.est(|e| e.sessao.clone())) else { return };
        self.tela(|ui| {
            let g = ui.global::<TelaPainel>();
            g.set_verificando(true);
            g.set_numero_erro("".into());
        });
        let a = self.clone();
        self.lancar(async move {
            let r = c.verificar(&sessao, &numero).await;
            let erro = |a: &App2, t: String| {
                a.tela(move |ui| {
                    let g = ui.global::<TelaPainel>();
                    g.set_verificando(false);
                    g.set_numero_erro(t.into());
                })
            };
            match r {
                Ok(v) => match v.jid.filter(|j| v.existe && jid_pessoa_valido(j)) {
                    Some(jid) => {
                        a.tela(|ui| {
                            let g = ui.global::<TelaPainel>();
                            g.set_verificando(false);
                            g.set_novo_aberto(false);
                        });
                        let a2 = a.clone();
                        let _ = slint::invoke_from_event_loop(move || a2.abrir_com_nome(jid, None));
                    }
                    None => erro(&a, "Este número não tem WhatsApp.".into()),
                },
                Err(Erro::Msg(t)) => erro(&a, t),
                Err(outro) => {
                    erro(&a, String::new());
                    a.falhou(outro);
                }
            }
        });
    }

    // ---------- informacoes do contato/grupo ----------
    pub(crate) fn alternar_info(&self, aberto: bool) {
        self.est(|e| {
            e.painel.info_aberto = aberto;
            e.painel.info_jid = None;
        });
        if aberto {
            self.carregar_info();
        }
    }

    /// A conversa aberta mudou com o painel aberto: carrega os dados da nova (ou fecha, se nao ha conversa).
    fn sincronizar_info(&self) {
        let (aberto, jid, atual) = self.est(|e| (e.painel.info_aberto, e.jid.clone(), e.painel.info_jid.clone()));
        if !aberto {
            return;
        }
        match jid {
            None => {
                self.est(|e| e.painel.info_aberto = false);
                self.tela(|ui| ui.global::<TelaPainel>().set_info_aberto(false));
            }
            Some(j) if atual.as_deref() != Some(j.as_str()) => self.carregar_info(),
            Some(_) => {}
        }
    }

    fn carregar_info(&self) {
        let Some(c) = self.cliente() else { return };
        let pedido = self.est(|e| {
            let jid = e.jid.clone()?;
            let sessao = e.sessao.clone()?;
            e.painel.info_geracao += 1;
            e.painel.info_jid = Some(jid.clone());
            let nome = e.conversas.iter().find(|x| x.jid == jid).map(formato::nome_conversa).unwrap_or_else(|| formato::numero(&jid));
            let foto = e.painel.foto(&sessao, &jid, true).or_else(|| e.painel.foto(&sessao, &jid, false));
            Some((sessao, jid, e.painel.info_geracao, nome, foto))
        });
        let Some((sessao, jid, g, nome, foto)) = pedido else { return };
        let grupo = jid.ends_with("@g.us");
        let j = jid.clone();
        self.tela(move |ui| {
            let t = ui.global::<TelaPainel>();
            t.set_info_jid(j.clone().into());
            t.set_info_inicial(formato::inicial_de(&nome).into());
            t.set_info_nome(nome.into());
            t.set_info_numero(if grupo { String::new() } else { formato::numero(&j) }.into());
            t.set_info_cor(formato::cor(&j));
            t.set_info_grupo(grupo);
            t.set_info_descricao("".into());
            t.set_info_total(0);
            t.set_info_participantes(ModelRc::default());
            t.set_info_erro("".into());
            t.set_info_carregando(true);
            match foto {
                Some(b) => {
                    t.set_info_foto(slint::Image::from_rgba8(b));
                    t.set_info_tem_foto(true);
                }
                None => t.set_info_tem_foto(false),
            }
        });
        self.pedir_fotos(vec![jid.clone()], true);
        let a = self.clone();
        self.lancar(async move {
            let r = c.info(&sessao, &jid).await;
            if a.est(|e| e.painel.info_geracao) != g {
                return;
            }
            match r {
                Ok(i) => a.mostrar_info(i, &jid),
                Err(Erro::Msg(t)) => a.tela(move |ui| {
                    let t2 = ui.global::<TelaPainel>();
                    t2.set_info_carregando(false);
                    t2.set_info_erro(t.into());
                }),
                Err(outro) => {
                    a.tela(|ui| ui.global::<TelaPainel>().set_info_carregando(false));
                    a.falhou(outro);
                }
            }
        });
    }

    fn mostrar_info(&self, i: pa::Info, jid: &str) {
        let numero = i.numero.clone().filter(|n| !n.trim().is_empty()).unwrap_or_else(|| formato::numero(jid));
        let nome = i.nome.clone().filter(|n| !n.trim().is_empty());
        let participantes = i.participantes.unwrap_or_default();
        let total = participantes.len() as i32;
        let itens: Vec<ParticipanteItem> = participantes.iter().take(MAX_PARTICIPANTES).map(item_participante).collect();
        let descricao = i.descricao.unwrap_or_default().trim().to_string();
        let grupo = i.grupo;
        self.tela(move |ui| {
            let t = ui.global::<TelaPainel>();
            if let Some(n) = nome {
                t.set_info_inicial(formato::inicial_de(&n).into());
                t.set_info_nome(n.into());
            }
            t.set_info_numero(if grupo { String::new() } else { numero }.into());
            t.set_info_grupo(grupo);
            t.set_info_descricao(descricao.into());
            t.set_info_total(total);
            t.set_info_participantes(ModelRc::new(VecModel::from(itens)));
            t.set_info_carregando(false);
        });
    }

    // ---------- termos do servidor ----------
    /// O servidor respondeu "termos_pendentes": mostra a tela de aceite por cima de tudo.
    pub(crate) fn pedir_termos(&self) {
        if self.est(|e| std::mem::replace(&mut e.painel.termos_aberto, true)) {
            return;
        }
        let Some(c) = self.cliente() else {
            return self.est(|e| e.painel.termos_aberto = false);
        };
        self.tela(|ui| ui.set_ocupado(false));
        let a = self.clone();
        self.lancar(async move {
            match c.termos().await {
                Ok(t) if t.precisa_aceitar => {
                    a.est(|e| e.painel.termos_versao = t.versao_atual.clone());
                    let servidor = c.origem.clone();
                    a.tela(move |ui| {
                        let g = ui.global::<TelaPainel>();
                        g.set_termos_versao(t.versao_atual.into());
                        g.set_termos_vigencia(t.vigencia.into());
                        g.set_termos_servidor(servidor.into());
                        g.set_termos_erro("".into());
                        g.set_termos_ocupado(false);
                        g.set_termos_aberto(true);
                    });
                }
                Ok(_) => {
                    // o servidor diz que ja esta aceito, mas o login guardado ainda vale a versao antiga
                    a.fechar_termos();
                    a.encerrar_login();
                    a.erro_login(Erro::Msg("Os termos já estão aceitos, mas o login precisa ser renovado. Entre de novo.".into()));
                }
                Err(m) => {
                    a.fechar_termos();
                    a.falhou(m);
                }
            }
        });
    }

    pub(crate) fn fechar_termos(&self) {
        self.est(|e| e.painel.termos_aberto = false);
        self.tela(|ui| {
            let g = ui.global::<TelaPainel>();
            g.set_termos_aberto(false);
            g.set_termos_ocupado(false);
        });
    }

    pub(crate) fn aceitar_termos(&self) {
        let Some(c) = self.cliente() else { return };
        let versao = self.est(|e| e.painel.termos_versao.clone());
        if versao.is_empty() {
            return;
        }
        self.tela(|ui| {
            let g = ui.global::<TelaPainel>();
            g.set_termos_ocupado(true);
            g.set_termos_erro("".into());
        });
        let a = self.clone();
        self.lancar(async move {
            match c.aceitar_termos(&versao).await {
                Ok(true) => {
                    config::guardar_sessao(&c.cookie());
                    a.fechar_termos();
                    a.iniciar_atendimento().await;
                }
                Ok(false) => {
                    // aceite gravado, mas o cookie nao renovou: um novo login ja traz a versao aceita
                    a.fechar_termos();
                    a.encerrar_login();
                    a.erro_login(Erro::Msg("Termos aceitos. Entre de novo para continuar.".into()));
                }
                Err(Erro::Msg(t)) => a.tela(move |ui| {
                    let g = ui.global::<TelaPainel>();
                    g.set_termos_ocupado(false);
                    g.set_termos_erro(t.into());
                }),
                Err(outro) => {
                    a.fechar_termos();
                    a.falhou(outro);
                }
            }
        });
    }

    pub(crate) fn recusar_termos(&self) {
        self.fechar_termos();
        self.sair();
    }

    pub(crate) fn abrir_pagina_termos(&self, pagina: &str) {
        let Some(url) = self.cliente().and_then(|c| url_pagina(&c.origem, pagina)) else { return };
        if let Err(m) = sistema::abrir_url(&url) {
            self.avisar(m);
        }
    }

    // ---------- configuracoes ----------
    pub(crate) fn config_aberta(&self) {
        let (servidor, cert, usuario, sem_not, sem_som) = self.est(|e| {
            (
                e.cfg.servidor.clone().unwrap_or_default(),
                e.cfg.certificado.clone(),
                e.cfg.email.clone().unwrap_or_default(),
                e.cfg.sem_notificacoes,
                e.cfg.sem_som,
            )
        });
        let inicio = sistema::inicia_com_windows();
        self.tela(move |ui| {
            let g = ui.global::<TelaPainel>();
            g.set_cfg_servidor(servidor.into());
            g.set_cfg_certificado(cert.unwrap_or_else(|| "Sem certificado (servidor neste computador)".into()).into());
            g.set_cfg_usuario(usuario.into());
            g.set_cfg_inicio(inicio);
            g.set_cfg_notificacoes(!sem_not);
            g.set_cfg_som(!sem_som);
        });
    }

    pub(crate) fn definir_inicio(&self, ligado: bool) {
        if let Err(m) = sistema::definir_inicio(ligado) {
            self.avisar(format!("Não consegui mudar isso no Windows: {m}"));
        }
        let real = sistema::inicia_com_windows();
        self.est(|e| {
            e.cfg.inicio_definido = true;
            let _ = config::salvar(&e.cfg);
        });
        self.tela(move |ui| ui.global::<TelaPainel>().set_cfg_inicio(real));
    }

    pub(crate) fn definir_notificacoes(&self, ligado: bool) {
        self.est(|e| {
            e.cfg.sem_notificacoes = !ligado;
            let _ = config::salvar(&e.cfg);
        });
        self.tela(move |ui| ui.global::<TelaPainel>().set_cfg_notificacoes(ligado));
    }

    pub(crate) fn definir_som(&self, ligado: bool) {
        self.est(|e| {
            e.cfg.sem_som = !ligado;
            let _ = config::salvar(&e.cfg);
        });
        self.tela(move |ui| ui.global::<TelaPainel>().set_cfg_som(ligado));
    }

    pub(crate) fn testar_notificacao(&self) {
        let com_som = self.est(|e| !e.cfg.sem_som);
        sistema::notificar_com("ZapHub", "Tudo certo: as notificações estão funcionando.", "", com_som);
    }
}

#[cfg(test)]
mod testes {
    use super::*;
    use chrono::TimeZone;

    fn conversa(jid: &str, unread: i64, nao_lida: bool, silenciada: bool) -> api::Conversa {
        serde_json::from_value(serde_json::json!({"jid": jid, "unread": unread, "naoLida": nao_lida, "silenciada": silenciada})).unwrap()
    }

    #[test]
    fn conta_nao_lidas_sem_as_silenciadas() {
        let l = vec![conversa("a", 3, false, false), conversa("b", 0, true, false), conversa("c", 9, false, true), conversa("d", 0, false, false)];
        assert_eq!(total_nao_lidas(&l), 4);
        assert_eq!(total_nao_lidas(&[]), 0);
    }

    #[test]
    fn textos_do_contador() {
        assert_eq!(texto_bandeja(0), "ZapHub");
        assert_eq!(texto_bandeja(1), "ZapHub — 1 não lida");
        assert_eq!(texto_bandeja(7), "ZapHub — 7 não lidas");
        assert_eq!(titulo_janela(0), "ZapHub");
        assert_eq!(titulo_janela(5), "ZapHub (5)");
        assert_eq!(titulo_janela(250), "ZapHub (99+)");
    }

    #[test]
    fn numero_digitado() {
        assert_eq!(normalizar_numero("(41) 99999-8888").unwrap(), "5541999998888");
        assert_eq!(normalizar_numero("041 99999-8888").unwrap(), "5541999998888");
        assert_eq!(normalizar_numero("(41) 3333-4444").unwrap(), "554133334444");
        assert_eq!(normalizar_numero("+55 41 99999-8888").unwrap(), "5541999998888");
        assert_eq!(normalizar_numero("5541999998888").unwrap(), "5541999998888");
        assert_eq!(normalizar_numero("+1 415 555 0123").unwrap(), "14155550123");
        for ruim in ["", "abc", "99999-8888", "123", "+12", "55419999988889999"] {
            assert!(normalizar_numero(ruim).is_err(), "{ruim}");
        }
    }

    #[test]
    fn so_jid_de_pessoa() {
        assert!(jid_pessoa_valido("5541999998888@s.whatsapp.net"));
        assert!(!jid_pessoa_valido("123@g.us"));
        assert!(!jid_pessoa_valido("abc@s.whatsapp.net"));
        assert!(!jid_pessoa_valido("5541999998888@s.whatsapp.net/../x"));
        assert!(!jid_pessoa_valido(""));
    }

    #[test]
    fn acoes_do_menu_viram_o_pedido_do_servidor() {
        let agora = chrono::Utc.with_ymd_and_hms(2026, 11, 13, 10, 0, 0).unwrap();
        assert_eq!(traduzir_acao("silenciar-8h", agora), Some(("silenciar", Some("2026-11-13T18:00:00.000Z".into()))));
        assert_eq!(traduzir_acao("silenciar-1s", agora), Some(("silenciar", Some("2026-11-20T10:00:00.000Z".into()))));
        assert_eq!(traduzir_acao("silenciar-sempre", agora), Some(("silenciar", Some("sempre".into()))));
        assert_eq!(traduzir_acao("fixar", agora), Some(("fixar", None)));
        assert_eq!(traduzir_acao("nao-lida", agora), Some(("nao-lida", None)));
        assert_eq!(traduzir_acao("apagar-tudo", agora), None);
        assert_eq!(traduzir_acao("silenciar", agora), Some(("silenciar", None))); // sem `ate`: 8 horas no servidor
    }

    #[test]
    fn resultado_na_lista_antes_da_resposta() {
        let mut c = conversa("a", 0, false, false);
        assert_eq!(aplicar_local(&mut c, "fixar"), Efeito::Alterou);
        assert!(c.fixada);
        aplicar_local(&mut c, "desfixar");
        assert!(!c.fixada);
        aplicar_local(&mut c, "silenciar");
        assert!(c.silenciada);
        aplicar_local(&mut c, "dessilenciar");
        assert!(!c.silenciada);
        aplicar_local(&mut c, "nao-lida");
        assert!(c.nao_lida);
        assert_eq!(aplicar_local(&mut c, "arquivar"), Efeito::Remover);
        assert_eq!(aplicar_local(&mut c, "desarquivar"), Efeito::Remover);
        assert_eq!(aplicar_local(&mut c, "qualquer"), Efeito::Nada);
    }

    #[test]
    fn nomes_dos_participantes() {
        let p = |jid: &str, nome: Option<&str>| pa::Participante { jid: jid.into(), nome: nome.map(String::from), admin: false };
        assert_eq!(rotulos_participante(&p("5541988887777@s.whatsapp.net", Some("Ana"))), ("Ana".into(), "+55 41 98888-7777".into()));
        assert_eq!(rotulos_participante(&p("5541988887777@s.whatsapp.net", None)), ("+55 41 98888-7777".into(), String::new()));
        assert_eq!(rotulos_participante(&p("1234@lid", Some("  "))), ("Contato".into(), String::new()));
        assert_eq!(rotulos_participante(&p("1234@lid", Some("<b>Bia</b>"))), ("<b>Bia</b>".into(), String::new()));
    }

    #[test]
    fn paginas_do_servidor() {
        assert_eq!(url_pagina("https://zap.empresa.com", "terms").as_deref(), Some("https://zap.empresa.com/terms"));
        assert_eq!(url_pagina("https://zap.empresa.com/", "privacy").as_deref(), Some("https://zap.empresa.com/privacy"));
        assert_eq!(url_pagina("https://zap.empresa.com", "../admin"), None);
        assert_eq!(url_pagina("https://zap.empresa.com", "https://outro.com"), None);
    }

    #[test]
    fn foto_quadrada_no_tamanho_pedido() {
        let mut png = Vec::new();
        image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(300, 200, image::Rgba([244, 169, 53, 255])))
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        let b = avatar(&png, LADO_MINIATURA).expect("foto");
        assert_eq!((b.width(), b.height()), (LADO_MINIATURA, LADO_MINIATURA));
        assert!(avatar(b"isto nao e uma imagem", LADO_MINIATURA).is_none());
        assert!(avatar(b"<html>404</html>", LADO_MINIATURA).is_none());
    }

    #[test]
    fn quem_nao_tem_foto_so_e_consultado_de_novo_depois_de_um_tempo() {
        let mut d = Dados::default();
        let agora = Instant::now();
        let k = chave("s", "j", false);
        assert!(d.precisa_baixar(&k, agora));
        d.baixando.insert(k.clone());
        assert!(!d.precisa_baixar(&k, agora));
        d.baixando.remove(&k);
        d.guardar(k.clone(), Foto::Nao(agora));
        assert!(!d.precisa_baixar(&k, agora + Duration::from_secs(60)));
        assert!(d.precisa_baixar(&k, agora + REVER_SEM_FOTO + Duration::from_secs(1)));
        d.guardar(k.clone(), Foto::Tem(SharedPixelBuffer::new(1, 1)));
        assert!(!d.precisa_baixar(&k, agora + REVER_SEM_FOTO * 3));
        assert!(d.foto("s", "j", false).is_some() && d.foto("s", "j", true).is_none());
    }

    #[test]
    fn cache_de_fotos_tem_teto_em_bytes_e_marcas_saem_primeiro() {
        let mut d = Dados::default();
        // marcas "sem foto" ocupam pouco; fotos de 320x320 (400 KB) enchem o teto de 48 MB
        for i in 0..50 {
            d.guardar(format!("m{i}"), Foto::Nao(Instant::now()));
        }
        let por_foto = 320 * 320 * 4;
        let cabem = TETO_FOTOS / por_foto;
        for i in 0..(cabem + 40) {
            d.guardar(format!("f{i}"), Foto::Tem(SharedPixelBuffer::new(320, 320)));
        }
        assert!(d.fotos.bytes() <= TETO_FOTOS, "passou do teto: {}", d.fotos.bytes());
        assert!(d.fotos.len() >= cabem - 1, "nao limpou tudo: {}", d.fotos.len());
        // as marcas sairam antes de qualquer foto; as fotos mais recentes continuam
        assert!(!d.fotos.contem("m0"));
        assert!(d.fotos.contem(&format!("f{}", cabem + 39)));
    }
}
