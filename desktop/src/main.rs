// ZapHub para Windows: programa nativo (Rust + Slint) que conversa com o servidor ZapHub da empresa.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod api;
mod cofre;
mod config;
mod servidor;
mod tempo_real;
mod tls;
mod formato;
mod midia;
mod audio;
mod sistema;
mod acoes;
mod painel;
mod cache;
mod logica;

use api::{Cliente, Erro, Login};
use slint::{ModelRc, VecModel, Weak};
use std::sync::{Arc, Mutex};
use tokio::runtime::Handle;
use tokio::sync::mpsc;

slint::include_modules!();

/// Identidade do servidor mostrada para a pessoa confirmar (ainda nao gravada no config).
struct CertPendente {
    origem: String,
    impressao: String,
    chave_publica: Option<String>,
    /// ja havia uma identidade confirmada para esta mesma origem e ela nao bate
    mudou: bool,
    /// o que a pessoa digitou no alerta (os 4 primeiros pares da impressao nova)
    digitado: String,
}

/// Miniaturas das fotos das mensagens: teto de ~80 MB em memoria.
const TETO_MINIATURAS: usize = 80 * 1024 * 1024;
/// Uma foto que acabou de ser pedida (e falhou ou foi despejada) so e pedida de novo depois disto.
const REPETIR_FOTO_APOS: std::time::Duration = std::time::Duration::from_secs(60);
/// Soma maxima dos arquivos escolhidos para enviar de uma vez.
const TETO_ANEXOS: usize = 200 * 1024 * 1024;
/// Arquivo maior que isto nao vai.
const TETO_ARQUIVO: u64 = 100 * 1024 * 1024;

#[derive(Default)]
struct Estado {
    cfg: config::Config,
    cliente: Option<Arc<Cliente>>,
    cert_pendente: Option<CertPendente>,
    sessoes: Vec<api::SessaoWa>,
    sessao: Option<String>,
    conversas: Vec<api::Conversa>,
    busca: String,
    filtro: usize,
    carregando_conversas: bool,
    fim_conversas: bool,
    jid: Option<String>,
    mensagens: Vec<api::Mensagem>,
    tem_mais: bool,
    carregando: bool,
    conexao: Option<tempo_real::Conexao>,
    /// a tarefa que repassa os avisos do tempo real para a tela
    ouvindo: Option<tokio::task::AbortHandle>,
    ao_vivo: bool,
    /// ja conectou ao menos uma vez (a volta depois de uma queda recarrega o que se perdeu)
    ja_conectou: bool,
    /// muda a cada troca de sessao, busca ou filtro da LISTA de conversas: resposta atrasada e descartada
    ger_lista: u64,
    /// muda a cada troca de sessao ou de conversa aberta (nao com busca/filtro da lista)
    ger_conversa: u64,
    /// muda ao encerrar o login: tarefas de um login antigo nao mexem no novo (ver `lancar`)
    login_ger: u64,
    recarregar_agendado: bool,
    /// miniaturas das fotos ja baixadas (por keyId), com teto em bytes, e as que estao baixando
    imagens: cache::Lru<slint::SharedPixelBuffer<slint::Rgba8Pixel>>,
    baixando: std::collections::HashSet<String>,
    /// quando cada foto foi pedida a ultima vez (nao repetir o pedido em laco)
    pedidas: std::collections::HashMap<String, std::time::Instant>,
    /// arquivos escolhidos para enviar (nome, conteudo)
    anexos: Vec<(String, bytes::Bytes)>,
    enviando: bool,
    /// chegou mensagem na conversa aberta com a janela escondida ou atras: marcar lida quando aparecer
    pendente_lida: bool,
    /// audios sendo baixados (clique duplo nao baixa duas vezes)
    baixando_audio: std::collections::HashSet<String>,
    gravacao: Option<audio::Gravacao>,
    inicio_gravacao: Option<std::time::Instant>,
    /// audios ja baixados (keyId -> arquivo temporario)
    audios: std::collections::HashMap<String, std::path::PathBuf>,
    /// responder, encaminhar e buscar na conversa (acoes.rs)
    acoes: acoes::EstadoAcoes,
    /// painel: fotos de perfil, nova conversa, informacoes, termos (src/painel.rs)
    painel: painel::Dados,
}

thread_local! {
    static RELOGIO_GRAVACAO: slint::Timer = slint::Timer::default();
    static RELOGIO_AUDIO: slint::Timer = slint::Timer::default();
}

type E = Arc<Mutex<Estado>>;

const FILTROS: [&str; 4] = ["all", "private", "groups", "archived"];
/// quantas conversas o servidor manda por pagina
const PAGINA_CONVERSAS: usize = 50;

tokio::task_local! {
    /// de qual login e a tarefa que esta rodando (ver `App2::lancar`)
    static LOGIN_DA_TAREFA: u64;
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum ModoLista {
    /// recomeca a lista (troca de sessao, busca, filtro)
    Inicio,
    /// proxima pagina, ao rolar ate o fim
    Pagina,
    /// atualiza por baixo dos panos, mantendo as paginas ja carregadas
    Atualizar,
}

#[derive(Clone)]
struct App2 {
    ui: Weak<App>,
    e: E,
    rt: Handle,
    /// no maximo 4 fotos baixando ao mesmo tempo
    fila_fotos: Arc<tokio::sync::Semaphore>,
}

impl App2 {
    fn tela(&self, f: impl FnOnce(&App) + Send + 'static) {
        let _ = self.ui.upgrade_in_event_loop(move |ui| f(&ui));
    }

    fn est<R>(&self, f: impl FnOnce(&mut Estado) -> R) -> R {
        let mut g = self.e.lock().expect("estado");
        f(&mut g)
    }

    fn cliente(&self) -> Option<Arc<Cliente>> {
        self.est(|e| e.cliente.clone())
    }

    /// Roda uma tarefa guardando de qual login ela e. Se o login acabar (Sair, sessao expirada) antes de ela
    /// terminar, o erro dela (`falhou`) e ignorado e nao derruba um login novo.
    fn lancar<F>(&self, f: F) -> tokio::task::JoinHandle<()>
    where
        F: std::future::Future<Output = ()> + Send + 'static,
    {
        let g = self.est(|e| e.login_ger);
        self.rt.spawn(LOGIN_DA_TAREFA.scope(g, f))
    }

    /// A tarefa que esta rodando (se for uma `lancar`) ainda e do login atual?
    fn login_atual(&self) -> bool {
        let agora = self.est(|e| e.login_ger);
        LOGIN_DA_TAREFA.try_with(|g| *g == agora).unwrap_or(true)
    }

    // ---------- servidor ----------
    fn verificar(&self, entrada: String) {
        let origem = match servidor::validar(&entrada) {
            Ok(o) => o,
            Err(m) => return self.tela(move |ui| ui.set_erro_servidor(m.into())),
        };
        self.tela(|ui| {
            ui.set_erro_servidor("".into());
            ui.set_ocupado(true);
        });
        if origem.starts_with("http://") {
            // so no proprio computador (servidor::validar); sem certificado
            return self.aceitar_servidor(origem, None);
        }
        let a = self.clone();
        self.lancar(async move {
            let o = origem.clone();
            let r = tokio::task::spawn_blocking(move || tls::ler(&o)).await.unwrap_or_else(|_| Err("Falha interna.".into()));
            match r {
                Err(m) => a.tela(move |ui| {
                    ui.set_ocupado(false);
                    ui.set_erro_servidor(m.into());
                }),
                Ok(c) => {
                    // ja havia identidade confirmada para ESTA origem?
                    let anterior = a.est(|e| (e.cfg.servidor.as_deref() == Some(&origem)).then(|| tls::Fixacao::de_config(&e.cfg)).filter(|f| !f.vazia()));
                    if anterior.as_ref().is_some_and(|f| f.confere(&c.impressao, c.chave_publica.as_deref())) {
                        return a.aceitar_servidor(origem, Some((c.impressao, c.chave_publica)));
                    }
                    let mudou = anterior.is_some();
                    let prefixo = tls::prefixo_confirmacao(&c.impressao);
                    a.est(|e| e.cert_pendente = Some(CertPendente { origem, impressao: c.impressao.clone(), chave_publica: c.chave_publica.clone(), mudou, digitado: String::new() }));
                    a.tela(move |ui| {
                        ui.set_ocupado(false);
                        ui.set_cert_impressao(c.impressao.into());
                        ui.set_cert_titular(c.titular.into());
                        ui.set_cert_emissor(c.emissor.into());
                        ui.set_cert_validade(c.valido_ate.into());
                        ui.set_cert_mudou(mudou);
                        ui.set_cert_liberado(!mudou);
                        ui.set_cert_prefixo(prefixo.into());
                        ui.set_mostrar_cert(true);
                    });
                }
            }
        });
    }

    /// A pessoa digitou algo no alerta de identidade mudada: libera o botao so se for o inicio da impressao nova.
    fn cert_digitado(&self, texto: String) {
        let liberado = self.est(|e| match e.cert_pendente.as_mut() {
            Some(p) => {
                p.digitado = texto;
                !p.mudou || tls::confirmacao_ok(&p.digitado, &p.impressao)
            }
            None => false,
        });
        self.tela(move |ui| ui.set_cert_liberado(liberado));
    }

    fn confiar(&self) {
        // identidade que mudou so passa depois de digitar os 4 primeiros pares (a tela ja trava o botao; aqui de novo)
        let pendente = self.est(|e| match e.cert_pendente.take() {
            Some(p) if p.mudou && !tls::confirmacao_ok(&p.digitado, &p.impressao) => {
                e.cert_pendente = Some(p);
                None
            }
            outro => outro,
        });
        if let Some(p) = pendente {
            self.aceitar_servidor(p.origem, Some((p.impressao, p.chave_publica)));
        }
    }

    /// `identidade` = (impressao do certificado, impressao da chave publica); None para http no proprio computador.
    fn aceitar_servidor(&self, origem: String, identidade: Option<(String, Option<String>)>) {
        let fixacao = identidade.map(|(cert, chave)| tls::Fixacao { chave_publica: chave, certificado: Some(cert) });
        let cliente = match Cliente::novo(&origem, fixacao.as_ref()) {
            Ok(c) => c,
            Err(m) => {
                let t = m.to_string();
                return self.tela(move |ui| {
                    ui.set_ocupado(false);
                    ui.set_erro_servidor(t.into());
                });
            }
        };
        let trocou = self.est(|e| {
            let anterior = tls::Fixacao::de_config(&e.cfg);
            let nova = fixacao.clone().unwrap_or_default();
            // outro servidor, ou o mesmo endereco com outra identidade: o login guardado nao vale mais
            let trocou = e.cfg.servidor.as_deref() != Some(&origem) || (!anterior.vazia() && !nova.vazia() && anterior.chave_publica != nova.chave_publica && anterior.certificado != nova.certificado);
            e.cfg.servidor = Some(origem.clone());
            e.cfg.certificado = nova.certificado;
            e.cfg.chave_publica = nova.chave_publica;
            if trocou {
                e.cfg.sessao_whatsapp = None;
            }
            let _ = config::salvar(&e.cfg);
            e.cliente = Some(cliente);
            trocou
        });
        if trocou {
            config::guardar_sessao("");
        }
        self.tela(move |ui| {
            ui.set_ocupado(false);
            ui.set_mostrar_cert(false);
            ui.set_servidor(origem.into());
            ui.set_erro_entrar("".into());
            ui.set_pede_codigo(false);
            ui.set_tela(1);
        });
    }

    fn trocar_servidor(&self) {
        self.encerrar_login();
        self.tela(|ui| {
            ui.set_mostrar_cert(false);
            ui.set_erro_servidor("".into());
            ui.set_tela(0);
        });
    }

    // ---------- entrar ----------
    fn entrar(&self, email: String, senha: String, codigo: String) {
        let Some(c) = self.cliente() else { return };
        if email.trim().is_empty() || senha.is_empty() {
            return self.tela(|ui| ui.set_erro_entrar("Informe e-mail e senha.".into()));
        }
        self.tela(|ui| {
            ui.set_ocupado(true);
            ui.set_erro_entrar("".into());
        });
        let a = self.clone();
        self.lancar(async move {
            match c.entrar(email.trim(), &senha, &codigo).await {
                Ok(Login::PrecisaCodigo) => a.tela(|ui| {
                    ui.set_ocupado(false);
                    ui.set_pede_codigo(true);
                    ui.set_erro_entrar("Digite o código de 6 dígitos do seu aplicativo autenticador.".into());
                }),
                Ok(Login::Ok) => {
                    config::guardar_sessao(&c.cookie());
                    a.est(|e| {
                        e.cfg.email = Some(email.trim().to_string());
                        let _ = config::salvar(&e.cfg);
                    });
                    a.tela(|ui| ui.set_pede_codigo(false));
                    a.iniciar_atendimento().await;
                }
                Err(m) => a.erro_login(m),
            }
        });
    }

    fn erro_login(&self, m: Erro) {
        if matches!(m, Erro::Termos) {
            return self.pedir_termos();
        }
        let t = m.to_string();
        self.tela(move |ui| {
            ui.set_ocupado(false);
            ui.set_erro_entrar(t.into());
            ui.set_tela(1);
        });
    }

    fn encerrar_login(&self) {
        self.acoes_ao_abrir();
        config::guardar_sessao("");
        let c = self.est(|e| {
            e.conexao = None; // fecha o canal: a conexao em tempo real termina
            if let Some(o) = e.ouvindo.take() {
                o.abort();
            }
            e.ao_vivo = false;
            e.ja_conectou = false;
            e.sessoes.clear();
            e.conversas.clear();
            e.mensagens.clear();
            e.jid = None;
            e.sessao = None;
            e.carregando = false;
            e.carregando_conversas = false;
            e.pendente_lida = false;
            e.ger_lista += 1;
            e.ger_conversa += 1;
            e.login_ger += 1;
            e.cliente.clone()
        });
        if let Some(c) = c {
            c.usar_cookie("");
        }
        self.zerar_contagem();
        self.fechar_termos();
        self.tela(|ui| {
            ui.set_conversa_jid("".into());
            ui.set_conversas(ModelRc::default());
            ui.set_mensagens(ModelRc::default());
            ui.set_carregando(false);
            ui.set_carregando_conversas(false);
            ui.set_ao_vivo(false);
        });
    }

    /// "Sair": o login acaba neste computador na hora; em seguida pede ao servidor para encerrar a sessao
    /// (o cookie e um JWT: sem isso ele continuaria valendo no servidor ate expirar).
    fn sair(&self) {
        let remoto = self.cliente().map(|c| {
            let cookie = c.cookie();
            (c, cookie)
        });
        self.encerrar_login();
        if let Some((c, cookie)) = remoto {
            self.rt.spawn(async move { c.encerrar_no_servidor(&cookie).await });
        }
        self.tela(|ui| {
            ui.set_erro_entrar("".into());
            ui.set_tela(1);
        });
    }

    /// Falha numa chamada: login expirado volta para "Entrar"; o resto aparece na barra de aviso.
    /// Erro de uma tarefa de um login que ja acabou e ignorado.
    fn falhou(&self, m: Erro) {
        if !self.login_atual() {
            return;
        }
        match m {
            Erro::Sessao => {
                self.encerrar_login();
                self.erro_login(Erro::Sessao);
            }
            Erro::Certificado => {
                self.encerrar_login();
                let t = Erro::Certificado.to_string();
                self.tela(move |ui| {
                    ui.set_erro_servidor((t + " Não continue se você não esperava essa troca: avise o administrador do servidor por outro meio. Para conectar de novo, digite o endereço e confira a identidade que o programa mostrar.").into());
                    ui.set_tela(0);
                });
            }
            Erro::Termos => self.pedir_termos(),
            Erro::Msg(t) => self.avisar(t),
        }
    }

    /// aviso flutuante no topo; some sozinho depois de alguns segundos
    fn avisar(&self, t: String) {
        self.tela(move |ui| {
            ui.set_aviso(t.clone().into());
            let w = ui.as_weak();
            slint::Timer::single_shot(std::time::Duration::from_secs(8), move || {
                if let Some(ui) = w.upgrade() {
                    if ui.get_aviso() == t.as_str() {
                        ui.set_aviso("".into());
                    }
                }
            });
        });
    }

    // ---------- atendimento ----------
    async fn iniciar_atendimento(&self) {
        let Some(c) = self.cliente() else { return };
        let sessoes = match c.sessoes().await {
            Ok(s) => s,
            Err(m) => return self.erro_login(m),
        };
        let email = self.est(|e| e.cfg.email.clone().unwrap_or_default());
        let preferida = self.est(|e| e.cfg.sessao_whatsapp.clone());
        let idx = preferida.and_then(|p| sessoes.iter().position(|s| s.session_id == p)).unwrap_or(0);
        let nomes: Vec<SessaoItem> = sessoes.iter().map(formato::sessao_item).collect();
        let vazia = sessoes.is_empty();
        self.est(|e| e.sessoes = sessoes);

        // tempo real com o mesmo login (canal com limite; a conexao e a tarefa que ouve sao abortadas ao encerrar o login)
        let (tx, rx) = mpsc::channel(tempo_real::CAPACIDADE_AVISOS);
        let fixacao = self.est(|e| Some(tls::Fixacao::de_config(&e.cfg)).filter(|f| !f.vazia()));
        let conexao = tempo_real::iniciar(c.origem.clone(), fixacao, c.cookie(), tx);
        let a = self.clone();
        let ouvindo = self.lancar(async move { a.ouvir(rx).await }).abort_handle();
        self.est(|e| {
            e.conexao = Some(conexao);
            if let Some(velho) = e.ouvindo.replace(ouvindo) {
                velho.abort();
            }
        });

        self.tela(move |ui| {
            ui.set_ocupado(false);
            ui.set_usuario(email.into());
            ui.set_sessoes(ModelRc::new(VecModel::from(nomes)));
            ui.set_sessao_atual(idx as i32);
            if vazia {
                ui.set_aviso("Você ainda não tem acesso a nenhuma sessão do WhatsApp. Peça ao administrador.".into());
            }
            ui.set_tela(2);
        });
        if !vazia {
            self.escolher_sessao(idx);
        }
    }

    fn escolher_sessao(&self, idx: usize) {
        let Some(s) = self.est(|e| e.sessoes.get(idx).cloned()) else { return };
        let assinar = self.est(|e| {
            e.sessao = Some(s.session_id.clone());
            e.jid = None;
            e.mensagens.clear();
            e.conversas.clear();
            e.fim_conversas = false;
            e.busca.clear();
            e.carregando = false;
            e.carregando_conversas = false;
            e.pendente_lida = false;
            e.ger_lista += 1;
            e.ger_conversa += 1;
            e.cfg.sessao_whatsapp = Some(s.session_id.clone());
            let _ = config::salvar(&e.cfg);
            if let Some(c) = &e.conexao {
                c.entrar_na_sala(s.session_id.clone());
            }
            !s.privada && e.cfg.assinar.get(&s.session_id).copied().unwrap_or_else(|| s.assina_por_padrao())
        });
        self.acoes_ao_abrir();
        let estado = formato::estado_sessao(&s);
        let privada = s.privada;
        self.tela(move |ui| {
            ui.set_estado_sessao(estado.into());
            ui.set_busca("".into());
            ui.set_pode_assinar(!privada);
            ui.set_assinar(assinar);
            ui.set_conversa_jid("".into());
            ui.set_mensagens(ModelRc::default());
            ui.set_conversas(ModelRc::default());
            // nenhum spinner da sessao anterior fica ligado
            ui.set_carregando(false);
            ui.set_carregando_conversas(false);
            ui.set_tem_mais(false);
        });
        self.carregar_conversas(true);
    }

    fn trocar_assinar(&self, v: bool) {
        self.est(|e| {
            if let Some(s) = e.sessao.clone() {
                e.cfg.assinar.insert(s, v);
                let _ = config::salvar(&e.cfg);
            }
        });
    }

    /// Buscar na lista de conversas mexe so na lista (ger_lista); a conversa aberta continua como esta.
    fn buscar(&self, t: String) {
        let g = self.est(|e| {
            e.busca = t;
            e.ger_lista += 1;
            e.ger_lista
        });
        let a = self.clone();
        self.lancar(async move {
            tokio::time::sleep(std::time::Duration::from_millis(350)).await;
            if a.est(|e| e.ger_lista) == g {
                a.carregar_conversas(true);
            }
        });
    }

    fn filtrar(&self, f: usize) {
        self.est(|e| {
            e.filtro = f.min(3);
            e.ger_lista += 1;
        });
        self.carregar_conversas(true);
    }

    /// `true` = recomeca a lista (mostra o spinner e troca tudo); `false` = proxima pagina, no fim da rolagem.
    fn carregar_conversas(&self, do_inicio: bool) {
        self.pedir_conversas(if do_inicio { ModoLista::Inicio } else { ModoLista::Pagina });
    }

    /// Atualiza a lista por baixo dos panos (mensagem nova, leitura, arquivar): mescla a primeira pagina e mantem
    /// as paginas que a pessoa ja rolou.
    fn atualizar_conversas(&self) {
        self.pedir_conversas(ModoLista::Atualizar);
    }

    fn pedir_conversas(&self, modo: ModoLista) {
        let Some(c) = self.cliente() else { return };
        let pedido = self.est(|e| {
            if modo == ModoLista::Pagina && (e.carregando_conversas || e.fim_conversas) {
                return None;
            }
            if modo == ModoLista::Atualizar && !e.busca.trim().is_empty() {
                return None; // com busca na lista nao ha o que atualizar por baixo
            }
            if modo != ModoLista::Atualizar {
                e.carregando_conversas = true;
            }
            let antes = if modo == ModoLista::Pagina { e.conversas.last().and_then(|x| x.last_message.as_ref()).and_then(|m| m.timestamp.clone()) } else { None };
            Some((e.sessao.clone()?, e.busca.clone(), FILTROS[e.filtro.min(3)], antes, e.ger_lista))
        });
        let Some((sessao, busca, filtro, antes, g)) = pedido else { return };
        if modo == ModoLista::Inicio {
            self.tela(|ui| ui.set_carregando_conversas(true));
        }
        let a = self.clone();
        self.lancar(async move {
            let r = c.conversas(&sessao, &busca, filtro, antes.as_deref()).await;
            // resposta de outra sessao, ou de uma busca/filtro que ja mudou, nunca entra na lista
            let atual = a.est(|e| {
                let atual = e.ger_lista == g && e.sessao.as_deref() == Some(sessao.as_str());
                if atual && modo != ModoLista::Atualizar {
                    e.carregando_conversas = false;
                }
                atual
            });
            if !atual {
                return;
            }
            if modo != ModoLista::Atualizar {
                a.tela(|ui| ui.set_carregando_conversas(false));
            }
            match r {
                Ok(lista) => {
                    a.est(|e| {
                        let cheia = lista.len() >= PAGINA_CONVERSAS;
                        match modo {
                            ModoLista::Inicio => {
                                e.fim_conversas = !cheia || !busca.trim().is_empty();
                                e.conversas = lista;
                            }
                            ModoLista::Pagina => {
                                e.fim_conversas = !cheia || !busca.trim().is_empty();
                                for x in lista {
                                    if !e.conversas.iter().any(|y| y.jid == x.jid) {
                                        e.conversas.push(x);
                                    }
                                }
                            }
                            ModoLista::Atualizar => {
                                if !cheia {
                                    e.fim_conversas = true;
                                }
                                logica::mesclar_conversas(&mut e.conversas, lista, cheia);
                            }
                        }
                    });
                    a.mostrar_conversas();
                }
                Err(m) => a.falhou(m),
            }
        });
    }

    fn mostrar_conversas(&self) {
        // com fotos de perfil, cabecalho e contador de nao lidas (src/painel.rs)
        self.mostrar_conversas_painel();
    }

    fn abrir(&self, jid: String) {
        let Some(c) = self.cliente() else { return };
        // audio e gravacao pertencem a thread da tela (relogios e player): `abrir` pode ser chamada de qualquer
        // thread, entao isso sempre passa pelo laco de eventos
        let a_tela = self.clone();
        let _ = slint::invoke_from_event_loop(move || {
            audio::parar_tudo();
            a_tela.cancelar_gravacao();
        });
        let dados = self.est(|e| {
            e.jid = Some(jid.clone());
            e.anexos.clear();
            e.mensagens.clear();
            e.tem_mais = false;
            e.carregando = true;
            e.pendente_lida = false;
            e.ger_conversa += 1;
            if let Some(x) = e.conversas.iter_mut().find(|x| x.jid == jid) {
                x.unread = 0;
                x.nao_lida = false;
            }
            let conv = e.conversas.iter().find(|x| x.jid == jid).cloned();
            Some((e.sessao.clone()?, e.ger_conversa, conv))
        });
        let Some((sessao, g, conv)) = dados else { return };
        let nome = conv.as_ref().map(formato::nome_conversa).unwrap_or_else(|| formato::numero(&jid));
        self.acoes_ao_abrir();
        let info = formato::info_conversa(&jid);
        let inicial = formato::inicial_de(&nome);
        let cor = formato::cor(&jid);
        let j = jid.clone();
        self.tela(move |ui| {
            ui.set_conversa_jid(j.into());
            ui.set_conversa_inicial(inicial.into());
            ui.set_conversa_cor(cor);
            ui.set_carregando(true);
            ui.invoke_focar_compositor();
            ui.set_conversa_nome(nome.into());
            ui.set_conversa_info(info.into());
            ui.set_mensagens(ModelRc::default());
            ui.set_tem_mais(false);
            ui.set_rascunho("".into());
        });
        self.mostrar_conversas();
        self.mostrar_anexos();
        let a = self.clone();
        self.lancar(async move {
            let r = c.mensagens(&sessao, &jid, None).await;
            // so vale se a conversa aberta ainda e esta (busca/filtro da lista nao contam). Resposta atrasada nao
            // pode deixar o spinner ligado se a conversa e a mesma.
            let (atual, zerou) = a.est(|e| {
                let atual = e.ger_conversa == g;
                let zerou = !atual && e.jid.as_deref() == Some(jid.as_str());
                if zerou {
                    e.carregando = false;
                }
                (atual, zerou)
            });
            if !atual {
                if zerou {
                    a.tela(|ui| ui.set_carregando(false));
                }
                return;
            }
            match r {
                Ok((lista, mais)) => {
                    a.est(|e| {
                        // o que chegou ao vivo enquanto a pagina carregava nao se perde
                        let vivas = std::mem::take(&mut e.mensagens);
                        e.mensagens = logica::juntar_ao_vivo(lista, vivas);
                        e.tem_mais = mais;
                        e.carregando = false;
                    });
                    a.tela(|ui| ui.set_carregando(false));
                    a.mostrar_mensagens(true);
                    a.marcar_lida_se_visivel(sessao, jid);
                }
                Err(m) => {
                    a.est(|e| e.carregando = false);
                    a.tela(|ui| ui.set_carregando(false));
                    a.falhou(m)
                }
            }
        });
    }

    /// Marca a conversa aberta como lida no servidor, mas so com a janela visivel e na frente. Se estiver
    /// escondida ou atras, fica pendente e um relogio marca quando a pessoa voltar (ver `vigiar_leitura`).
    fn marcar_lida_se_visivel(&self, sessao: String, jid: String) {
        let a = self.clone();
        self.tela(move |ui| {
            if ui.window().is_visible() && sistema::janela_na_frente(ui.window()) {
                a.marcar_lida_agora(sessao, jid);
            } else {
                a.est(|e| e.pendente_lida = true);
            }
        });
    }

    fn marcar_lida_agora(&self, sessao: String, jid: String) {
        let Some(c) = self.cliente() else { return };
        self.lancar(async move {
            let _ = c.marcar_lida(&sessao, &jid).await;
        });
    }

    /// Baixa a ultima pagina da conversa aberta e mescla com o que ja esta na tela (sem perder o historico
    /// rolado). Serve para enviar sem tempo real e para voltar de uma queda de conexao.
    fn sincronizar_conversa(&self) {
        let Some(c) = self.cliente() else { return };
        let Some((sessao, jid, g)) = self.est(|e| Some((e.sessao.clone()?, e.jid.clone()?, e.ger_conversa))) else { return };
        let a = self.clone();
        self.lancar(async move {
            match c.mensagens(&sessao, &jid, None).await {
                Ok((lista, _)) => {
                    // so mescla se ainda e a mesma conversa; a pessoa pode ter trocado enquanto isso
                    let mudou = a.est(|e| {
                        if e.jid.as_deref() != Some(jid.as_str()) || e.ger_conversa != g {
                            return false;
                        }
                        logica::mesclar_mensagens(&mut e.mensagens, lista);
                        true
                    });
                    if mudou {
                        a.mostrar_mensagens_modo(Rolagem::SeNoFim);
                    }
                }
                Err(m) => a.falhou(m),
            }
        });
    }

    fn mais_antigas(&self) {
        let Some(c) = self.cliente() else { return };
        let pedido = self.est(|e| {
            if e.carregando || !e.tem_mais {
                return None;
            }
            e.carregando = true;
            // a pagina anterior comeca antes da primeira mensagem COM data (a primeira da lista pode nao ter)
            let antes = e.mensagens.iter().find_map(|m| m.timestamp.clone())?;
            Some((e.sessao.clone()?, e.jid.clone()?, antes, e.ger_conversa))
        });
        let Some((sessao, jid, antes, g)) = pedido else { return };
        self.tela(|ui| ui.set_carregando(true));
        let a = self.clone();
        self.lancar(async move {
            let r = c.mensagens(&sessao, &jid, Some(&antes)).await;
            let atual = a.est(|e| {
                let atual = e.ger_conversa == g;
                if atual {
                    e.carregando = false;
                }
                atual
            });
            if !atual {
                return;
            }
            a.tela(|ui| ui.set_carregando(false));
            match r {
                Ok((lista, mais)) => {
                    a.est(|e| {
                        let mut novas: Vec<_> = lista.into_iter().filter(|m| !e.mensagens.iter().any(|x| x.key_id == m.key_id)).collect();
                        novas.append(&mut e.mensagens);
                        e.mensagens = novas;
                        e.tem_mais = mais;
                    });
                    a.mostrar_mensagens(false);
                }
                Err(m) => a.falhou(m),
            }
        });
    }

    fn mostrar_mensagens(&self, rolar: bool) {
        self.mostrar_mensagens_modo(if rolar { Rolagem::Sempre } else { Rolagem::Nunca });
    }

    /// Remonta a lista de mensagens na tela. `SeNoFim` so rola para o fim se a pessoa ja estava no fim (quem
    /// esta lendo mensagens antigas nao e puxado para baixo por uma mensagem nova).
    fn mostrar_mensagens_modo(&self, rolagem: Rolagem) {
        let (dados, imagens, mais) = self.est(|e| {
            let dados = formato::mensagens(&e.mensagens, e.jid.as_deref().unwrap_or(""));
            let imagens: Vec<_> = dados.iter().map(|d| if d.foto { e.imagens.obter(&d.id).cloned() } else { None }).collect();
            (dados, imagens, e.tem_mais)
        });
        let faltam: Vec<String> = dados.iter().zip(&imagens).filter(|(d, i)| d.foto && i.is_none()).map(|(d, _)| d.id.clone()).collect();
        self.baixar_fotos(faltam);
        self.tela(move |ui| {
            let estava_no_fim = ui.invoke_esta_no_fim();
            let som = audio::situacao();
            let itens: Vec<Mensagem> = dados.iter().zip(&imagens).map(|(d, i)| d.para_tela(i.as_ref(), som.as_ref())).collect();
            ui.set_mensagens(ModelRc::new(VecModel::from(itens)));
            ui.set_tem_mais(mais);
            if rolagem.rolar(estava_no_fim) {
                // depois do layout da lista nova
                let w = ui.as_weak();
                slint::Timer::single_shot(std::time::Duration::from_millis(30), move || {
                    if let Some(ui) = w.upgrade() {
                        ui.invoke_rolar_fim();
                    }
                });
            }
        });
    }

    // ---------- midia ----------
    /// Baixa as miniaturas que faltam (ate 4 ao mesmo tempo). Foto pedida ha menos de 1 minuto nao e pedida de
    /// novo (cache cheio nao vira laco de baixar e despejar).
    fn baixar_fotos(&self, ids: Vec<String>) {
        let Some(c) = self.cliente() else { return };
        for id in ids {
            let pedido = self.est(|e| {
                if e.baixando.contains(&id) || e.imagens.contem(&id) {
                    return None;
                }
                let agora = std::time::Instant::now();
                if e.pedidas.get(&id).is_some_and(|t| agora.saturating_duration_since(*t) < REPETIR_FOTO_APOS) {
                    return None;
                }
                let u = e.mensagens.iter().find(|m| m.key_id == id)?.media_url.clone()?;
                e.baixando.insert(id.clone());
                e.pedidas.insert(id.clone(), agora);
                if e.pedidas.len() > 2000 {
                    e.pedidas.retain(|_, t| agora.saturating_duration_since(*t) < REPETIR_FOTO_APOS);
                }
                Some((u, e.sessao.clone()?, e.jid.clone()?))
            });
            let Some((url, sessao, jid)) = pedido else { continue };
            let (a, c, fila) = (self.clone(), c.clone(), self.fila_fotos.clone());
            self.lancar(async move {
                let _vaga = fila.acquire_owned().await;
                // depois da espera na fila, a conversa pode ter mudado: nao baixa foto de conversa que ninguem ve
                if !a.est(|e| e.sessao.as_deref() == Some(sessao.as_str()) && e.jid.as_deref() == Some(jid.as_str())) {
                    a.est(|e| {
                        e.baixando.remove(&id);
                        e.pedidas.remove(&id);
                    });
                    return;
                }
                let baixada = c.baixar(&url).await;
                let rede_falhou = baixada.is_err();
                let buf = match baixada {
                    Ok(dados) => tokio::task::spawn_blocking(move || midia::miniatura(&dados)).await.ok().flatten(),
                    Err(_) => None,
                };
                // a conversa pode ter mudado durante o download
                let ainda = a.est(|e| {
                    e.baixando.remove(&id);
                    e.sessao.as_deref() == Some(sessao.as_str()) && e.jid.as_deref() == Some(jid.as_str())
                });
                if !ainda {
                    return;
                }
                match buf {
                    Some(b) => {
                        let bytes = b.width() as usize * b.height() as usize * 4;
                        a.est(|e| e.imagens.inserir(id.clone(), b.clone(), bytes, false));
                        // so a linha desta foto muda na tela; a lista nao e remontada
                        // (se a linha ainda nao existe, a proxima montagem da lista ja usa o cache)
                        a.tela(move |ui| {
                            let _ = atualizar_foto_na_tela(ui, &id, &b);
                        });
                    }
                    // falha de rede (ou do servidor): tenta de novo mais tarde; so vira cartao de arquivo se a
                    // imagem baixou e NAO decodifica
                    None if rede_falhou => {}
                    None => {
                        a.est(|e| {
                            if let Some(m) = e.mensagens.iter_mut().find(|m| m.key_id == id) {
                                m.tipo = Some("DOCUMENT".into());
                            }
                        });
                        a.mostrar_mensagens(false);
                    }
                }
            });
        }
    }

    fn info_midia(&self, id: &str) -> Option<(String, String)> {
        self.est(|e| {
            let m = e.mensagens.iter().find(|m| m.key_id == id)?;
            let url = m.media_url.clone()?;
            let nome = midia::nome_download(m.tipo.as_deref().unwrap_or(""), m.content.as_deref(), &url, m.timestamp.as_deref());
            Some((url, nome))
        })
    }

    fn abrir_midia(&self, id: String) {
        let (Some(c), Some((url, nome))) = (self.cliente(), self.info_midia(&id)) else { return };
        // so abre o que esta na lista de permitidas, e nunca como administrador; o resto so salva
        if !midia::pode_abrir(&nome) {
            return self.avisar(midia::AVISO_SO_SALVAR.into());
        }
        if sistema::elevado() {
            return self.avisar(midia::AVISO_ELEVADO.into());
        }
        let a = self.clone();
        self.lancar(async move {
            match c.baixar(&url).await {
                Ok(dados) => {
                    // gravar o arquivo e chamar o shell (ShellExecute precisa do COM) ficam fora da thread assincrona
                    let r = tokio::task::spawn_blocking(move || {
                        midia::gravar_sem_sobrescrever(&midia::pasta_temporaria(), &nome, &dados).map_err(|e| e.to_string()).and_then(|p| midia::abrir_no_windows(&p))
                    })
                    .await
                    .unwrap_or_else(|_| Err("Falha interna ao abrir o arquivo.".into()));
                    if let Err(m) = r {
                        a.avisar(m);
                    }
                }
                Err(m) => a.falhou(m),
            }
        });
    }

    fn salvar_midia(&self, id: String) {
        let (Some(c), Some((url, nome))) = (self.cliente(), self.info_midia(&id)) else { return };
        let pasta = std::env::var_os("USERPROFILE").map(|u| std::path::PathBuf::from(u).join("Downloads"));
        let mut dlg = rfd::FileDialog::new().set_title("Salvar arquivo").set_file_name(&nome);
        if let Some(p) = pasta {
            dlg = dlg.set_directory(p);
        }
        let Some(destino) = dlg.save_file() else { return };
        let a = self.clone();
        self.lancar(async move {
            match c.baixar(&url).await {
                Ok(dados) => {
                    // arquivo grande: a gravacao nao trava a thread assincrona
                    let r = tokio::task::spawn_blocking(move || {
                        std::fs::write(&destino, &dados)?;
                        midia::marcar_internet(&destino);
                        Ok::<(), std::io::Error>(())
                    })
                    .await;
                    match r {
                        Ok(Ok(())) => {}
                        Ok(Err(e)) => a.avisar(format!("Não consegui salvar: {e}")),
                        Err(_) => a.avisar("Falha interna ao salvar o arquivo.".into()),
                    }
                }
                Err(m) => a.falhou(m),
            }
        });
    }

    // ---------- audio ----------
    fn tocar(&self, id: String) {
        if let Some(p) = self.est(|e| e.audios.get(&id).cloned()) {
            return self.tocar_arquivo(id, p);
        }
        let (Some(c), Some((url, nome))) = (self.cliente(), self.info_midia(&id)) else { return };
        // clique duplo nao baixa o mesmo audio duas vezes; guarda de qual conversa o pedido saiu
        let origem = self.est(|e| {
            let origem = (e.sessao.clone()?, e.jid.clone()?);
            e.baixando_audio.insert(id.clone()).then_some(origem)
        });
        let Some((sessao, jid)) = origem else { return };
        let a = self.clone();
        self.lancar(async move {
            let baixado = c.baixar(&url).await;
            let gravado = match baixado {
                Ok(dados) => {
                    let r = tokio::task::spawn_blocking(move || midia::gravar_sem_sobrescrever(&midia::pasta_temporaria(), &nome, &dados).map_err(|e| e.to_string())).await;
                    r.unwrap_or_else(|_| Err("falha interna".into()))
                }
                Err(m) => {
                    a.est(|e| e.baixando_audio.remove(&id));
                    return a.falhou(m);
                }
            };
            // um audio que chega depois de a pessoa trocar de conversa fica guardado, mas nao toca
            let ainda_aqui = a.est(|e| {
                e.baixando_audio.remove(&id);
                e.sessao.as_deref() == Some(sessao.as_str()) && e.jid.as_deref() == Some(jid.as_str()) && e.mensagens.iter().any(|m| m.key_id == id)
            });
            match gravado {
                Ok(p) => {
                    a.est(|e| e.audios.insert(id.clone(), p.clone()));
                    if ainda_aqui {
                        let a2 = a.clone();
                        let _ = slint::invoke_from_event_loop(move || a2.tocar_arquivo(id, p));
                    }
                }
                Err(e) => a.avisar(format!("Não consegui preparar o áudio: {e}")),
            }
        });
    }

    /// thread da tela
    fn tocar_arquivo(&self, id: String, p: std::path::PathBuf) {
        if let Err(e) = audio::tocar(&id, &p) {
            return self.avisar(format!("Não consegui tocar o áudio ({e})."));
        }
        let w = self.ui.clone();
        RELOGIO_AUDIO.with(|t| {
            t.start(slint::TimerMode::Repeated, std::time::Duration::from_millis(200), move || {
                let Some(ui) = w.upgrade() else { return };
                let som = audio::situacao();
                atualizar_audio_na_tela(&ui, som.as_ref());
                if som.as_ref().map(|s| !s.1).unwrap_or(true) {
                    RELOGIO_AUDIO.with(|t| t.stop());
                }
            });
        });
    }

    fn gravar(&self) {
        if self.est(|e| e.gravacao.is_some()) {
            return;
        }
        audio::parar_tudo();
        match audio::Gravacao::iniciar() {
            Ok(g) => {
                let nivel = g.nivel.clone();
                self.est(|e| {
                    e.gravacao = Some(g);
                    e.inicio_gravacao = Some(std::time::Instant::now());
                });
                let inicio = std::time::Instant::now();
                let w = self.ui.clone();
                if let Some(ui) = self.ui.upgrade() {
                    ui.set_gravando(true);
                    ui.set_tempo_gravacao("0:00".into());
                    ui.set_nivel(0.0);
                }
                RELOGIO_GRAVACAO.with(|t| {
                    t.start(slint::TimerMode::Repeated, std::time::Duration::from_millis(100), move || {
                        if let Some(ui) = w.upgrade() {
                            ui.set_tempo_gravacao(audio::mmss(inicio.elapsed().as_secs_f64()).into());
                            ui.set_nivel(nivel.load(std::sync::atomic::Ordering::Relaxed) as f32 / 1000.0);
                        }
                    });
                });
            }
            Err(m) => self.avisar(m),
        }
    }

    fn fim_gravacao(&self) -> Option<audio::Gravacao> {
        RELOGIO_GRAVACAO.with(|t| t.stop());
        if let Some(ui) = self.ui.upgrade() {
            ui.set_gravando(false);
        }
        self.est(|e| {
            e.inicio_gravacao = None;
            e.gravacao.take()
        })
    }

    fn cancelar_gravacao(&self) {
        if let Some(g) = self.fim_gravacao() {
            std::thread::spawn(move || drop(g.parar()));
        }
    }

    fn enviar_gravacao(&self) {
        let Some(g) = self.fim_gravacao() else { return };
        let (Some(c), Some((sessao, jid))) = (self.cliente(), self.est(|e| Some((e.sessao.clone()?, e.jid.clone()?)))) else { return };
        self.est(|e| e.enviando = true);
        self.mostrar_anexos();
        let a = self.clone();
        self.lancar(async move {
            let r = tokio::task::spawn_blocking(move || g.parar()).await.unwrap_or_else(|_| Err("Falha na gravação.".into()));
            let fim = |a: &App2| {
                a.est(|e| e.enviando = false);
                a.mostrar_anexos();
            };
            match r {
                Err(m) => {
                    fim(&a);
                    a.avisar(m)
                }
                Ok(g) if g.mudo => {
                    fim(&a);
                    a.avisar("O microfone não captou som, então o áudio não foi enviado. Confira se ele não está mudo, se é o microfone padrão do Windows e se outro programa não está usando.".into())
                }
                Ok(g) if g.segundos < 0.8 => {
                    fim(&a);
                    a.avisar("Gravação curta demais. Segure mais um pouco.".into())
                }
                Ok(g) => {
                    let r = c.enviar_midia(&sessao, &jid, bytes::Bytes::from(g.wav), "voz.wav", "audio/wav", "voice", "", Some(g.segundos)).await;
                    fim(&a);
                    if let Err(m) = r {
                        a.falhou(m);
                    }
                }
            }
        });
    }

    fn mostrar_anexos(&self) {
        let (nomes, enviando): (Vec<slint::SharedString>, bool) = self.est(|e| (e.anexos.iter().map(|(n, d)| format!("{n}  ·  {}", tamanho(d.len())).into()).collect(), e.enviando));
        self.tela(move |ui| {
            ui.set_anexos(ModelRc::new(VecModel::from(nomes)));
            ui.set_enviando(enviando);
        });
    }

    /// Escolhe os arquivos no seletor do Windows (na thread da tela) e le o conteudo fora dela, um a um, respeitando
    /// o limite de 100 MB por arquivo e de 200 MB no total.
    fn anexar(&self) {
        let Some(arquivos) = rfd::FileDialog::new().set_title("Anexar arquivos").pick_files() else { return };
        let a = self.clone();
        self.lancar(async move {
            let mut recusados = Vec::new();
            for p in arquivos.into_iter().take(10) {
                let nome = midia::limpar_nome(&p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default());
                let total = a.est(|e| e.anexos.iter().map(|(_, d)| d.len()).sum::<usize>());
                let lido = tokio::task::spawn_blocking(move || -> Result<bytes::Bytes, String> {
                    let tamanho = std::fs::metadata(&p).map_err(|e| e.to_string())?.len();
                    if tamanho > TETO_ARQUIVO {
                        return Err("passa de 100 MB".into());
                    }
                    if !logica::cabe_nos_anexos(total, tamanho as usize, TETO_ANEXOS) {
                        return Err("o total passaria de 200 MB".into());
                    }
                    std::fs::read(&p).map(bytes::Bytes::from).map_err(|e| e.to_string())
                })
                .await
                .unwrap_or_else(|_| Err("falha interna".into()));
                match lido {
                    // confere de novo ao guardar: outro arquivo pode ter entrado enquanto este era lido
                    Ok(dados) => {
                        let entrou = a.est(|e| {
                            let soma: usize = e.anexos.iter().map(|(_, d)| d.len()).sum();
                            let cabe = logica::cabe_nos_anexos(soma, dados.len(), TETO_ANEXOS);
                            if cabe {
                                e.anexos.push((nome.clone(), dados));
                            }
                            cabe
                        });
                        if !entrou {
                            recusados.push(format!("{nome} (o total passaria de 200 MB)"));
                        }
                    }
                    Err(motivo) => recusados.push(format!("{nome} ({motivo})")),
                }
            }
            a.mostrar_anexos();
            if !recusados.is_empty() {
                a.avisar(format!("Não anexei: {}", recusados.join("; ")));
            }
        });
    }

    fn colar(&self) -> bool {
        match midia::imagem_colada() {
            Some(png) => {
                let colou = self.est(|e| {
                    let soma: usize = e.anexos.iter().map(|(_, d)| d.len()).sum();
                    if !logica::cabe_nos_anexos(soma, png.len(), TETO_ANEXOS) {
                        return false;
                    }
                    let n = e.anexos.iter().filter(|(x, _)| x.starts_with("imagem colada")).count() + 1;
                    e.anexos.push((if n == 1 { "imagem colada.png".into() } else { format!("imagem colada {n}.png") }, bytes::Bytes::from(png)));
                    true
                });
                if !colou {
                    self.avisar("Os arquivos escolhidos já passam de 200 MB; envie estes antes de colar outra imagem.".into());
                }
                self.mostrar_anexos();
                true
            }
            None => false,
        }
    }

    fn remover_anexo(&self, i: usize) {
        self.est(|e| {
            if i < e.anexos.len() {
                e.anexos.remove(i);
            }
        });
        self.mostrar_anexos();
    }

    fn enviar_anexos(&self, legenda: String) {
        let Some(c) = self.cliente() else { return };
        let Some((sessao, jid, anexos)) = self.est(|e| {
            if e.enviando {
                return None;
            }
            let s = (e.sessao.clone()?, e.jid.clone()?, std::mem::take(&mut e.anexos));
            e.enviando = true;
            Some(s)
        }) else {
            return;
        };
        self.mostrar_anexos();
        self.tela(|ui| ui.set_rascunho("".into()));
        // anexos nao levam resposta (citada): a faixa "Respondendo a" fecha
        self.limpar_resposta();
        let a = self.clone();
        self.lancar(async move {
            let mut falhas = Vec::new();
            let mut fila = anexos.into_iter().enumerate();
            while let Some((i, (nome, dados))) = fila.next() {
                let (tipo, mime) = midia::tipo_envio(&nome);
                let leg = if i == 0 { legenda.as_str() } else { "" };
                // `Bytes` e contado por referencia: guardar uma copia para tentar de novo nao duplica o arquivo
                if let Err(m) = c.enviar_midia(&sessao, &jid, dados.clone(), &nome, mime, tipo, leg, None).await {
                    if matches!(m, Erro::Sessao | Erro::Certificado) {
                        // login/identidade: nada se perde. Este e os que faltavam voltam para a faixa de anexos
                        a.est(|e| {
                            e.enviando = false;
                            e.anexos.push((nome, dados));
                            for (_, (n, d)) in fila {
                                e.anexos.push((n, d));
                            }
                            for (n, d, _) in falhas {
                                e.anexos.push((n, d));
                            }
                        });
                        a.mostrar_anexos();
                        return a.falhou(m);
                    }
                    falhas.push((nome, dados, m.to_string()));
                }
            }
            let msg = falhas.first().map(|(n, _, m)| format!("Não consegui enviar {n}: {m}"));
            a.est(|e| {
                e.enviando = false;
                // o que falhou volta para a faixa, para tentar de novo
                for (n, d, _) in falhas {
                    e.anexos.push((n, d));
                }
            });
            a.mostrar_anexos();
            if let Some(m) = msg {
                a.avisar(m);
            }
        });
    }

    fn enviar(&self, texto: String) {
        if let Some(id) = self.est(|e| e.acoes.editando.clone()) {
            return self.salvar_edicao(id, texto);
        }
        if self.est(|e| !e.anexos.is_empty()) {
            return self.enviar_anexos(texto);
        }
        if texto.trim().is_empty() {
            return;
        }
        let Some(c) = self.cliente() else { return };
        let Some((sessao, jid, ao_vivo)) = self.est(|e| Some((e.sessao.clone()?, e.jid.clone()?, e.ao_vivo))) else { return };
        let citada = self.est(|e| e.acoes.resposta.clone());
        let assinar = self.ui.upgrade().map(|ui| ui.get_assinar() && ui.get_pode_assinar()).unwrap_or(false);
        self.tela(|ui| ui.set_rascunho("".into()));
        let a = self.clone();
        self.lancar(async move {
            let resultado = c.enviar_texto_citando(&sessao, &jid, &texto, assinar, citada.as_deref()).await;
            if resultado.is_ok() {
                // a faixa so fecha se ainda e a mesma resposta (a pessoa pode ter escolhido outra enquanto enviava)
                a.limpar_resposta_se(citada.as_deref());
            }
            match resultado {
                Ok(()) => {
                    if !ao_vivo {
                        // sem tempo real a mensagem enviada nao chega sozinha: busca a ultima pagina e mescla
                        // (nada de reabrir a conversa de dentro de uma tarefa: isso mexe na tela e no audio)
                        a.sincronizar_conversa();
                    }
                }
                Err(m) => {
                    // devolve o texto para nao perder o que foi digitado
                    a.tela(move |ui| {
                        if ui.get_rascunho().is_empty() {
                            ui.set_rascunho(texto.into());
                        }
                    });
                    a.falhou(m);
                }
            }
        });
    }

    // ---------- tempo real ----------
    async fn ouvir(&self, mut rx: mpsc::Receiver<tempo_real::Aviso>) {
        while let Some(av) = rx.recv().await {
            match av {
                tempo_real::Aviso::Conectado => {
                    // voltou depois de uma queda: o que chegou enquanto isso nao veio pelo socket
                    let voltou = self.est(|e| {
                        e.ao_vivo = true;
                        std::mem::replace(&mut e.ja_conectou, true)
                    });
                    self.tela(|ui| ui.set_ao_vivo(true));
                    if voltou {
                        self.atualizar_conversas();
                        self.sincronizar_conversa();
                    }
                }
                tempo_real::Aviso::Desconectado => {
                    self.est(|e| e.ao_vivo = false);
                    self.tela(|ui| ui.set_ao_vivo(false));
                }
                tempo_real::Aviso::SemLogin => {
                    self.falhou(Erro::Sessao);
                    return;
                }
                tempo_real::Aviso::Evento(nome, dados) => self.evento(&nome, dados),
            }
        }
    }

    fn evento(&self, nome: &str, dados: serde_json::Value) {
        let sessao = self.est(|e| e.sessao.clone()).unwrap_or_default();
        let desta = |v: &serde_json::Value| v.get("sessionKey").and_then(|x| x.as_str()) == Some(sessao.as_str());
        match nome {
            "message.update" => {
                let lista: Vec<api::Mensagem> = match dados {
                    serde_json::Value::Array(a) => a.into_iter().filter(|v| desta(v)).filter_map(|v| serde_json::from_value(v).ok()).collect(),
                    _ => Vec::new(),
                };
                if lista.is_empty() {
                    return;
                }
                let r = self.est(|e| {
                    // lista de conversas: so a conversa afetada tem a previa trocada e sobe (as paginas ja
                    // carregadas continuam); conversa que nao esta na lista pede uma atualizacao
                    let aberta = e.jid.clone();
                    let mut desconhecida = false;
                    for m in &lista {
                        let e_a_aberta = aberta.as_deref() == Some(m.remote_jid.as_str());
                        desconhecida |= !logica::subir_conversa(&mut e.conversas, m, e_a_aberta);
                    }
                    // conversa aberta: mescla (nada de reordenar por texto) e diz se chegou algo novo
                    let mut mudou = false;
                    let mut nova_recebida = false;
                    let mut minha_nova = false;
                    if let Some(jid) = aberta {
                        let desta_conversa: Vec<api::Mensagem> = lista.iter().filter(|m| m.remote_jid == jid).cloned().collect();
                        for m in desta_conversa.iter().filter(|m| !e.mensagens.iter().any(|x| x.key_id == m.key_id)) {
                            nova_recebida |= !m.from_me && m.live;
                            minha_nova |= m.from_me;
                        }
                        mudou = !desta_conversa.is_empty();
                        logica::mesclar_mensagens(&mut e.mensagens, desta_conversa);
                    }
                    (mudou, nova_recebida, minha_nova, desconhecida)
                });
                let (mudou, nova_recebida, minha_nova, desconhecida) = r;
                if mudou {
                    // mensagem minha sempre leva ao fim; a de fora so se a pessoa ja estava no fim
                    self.mostrar_mensagens_modo(if minha_nova { Rolagem::Sempre } else { Rolagem::SeNoFim });
                }
                self.notificar_novas(&lista);
                if nova_recebida {
                    if let Some((s, j)) = self.est(|e| Some((e.sessao.clone()?, e.jid.clone()?))) {
                        self.marcar_lida_se_visivel(s, j);
                    }
                }
                self.mostrar_conversas();
                if desconhecida {
                    self.recarregar_conversas_em_breve();
                }
            }
            "message.status" if desta(&dados) => {
                let key = dados.get("keyId").and_then(|x| x.as_str()).unwrap_or_default().to_string();
                let st = dados.get("status").and_then(|x| x.as_str()).map(String::from);
                let mudou = self.est(|e| match e.mensagens.iter_mut().find(|m| m.key_id == key) {
                    Some(m) => {
                        m.status = st;
                        true
                    }
                    None => false,
                });
                if mudou {
                    self.mostrar_mensagens(false);
                }
            }
            "message.removed" if desta(&dados) => {
                let key = dados.get("keyId").and_then(|x| x.as_str()).unwrap_or_default().to_string();
                self.est(|e| e.mensagens.retain(|m| m.key_id != key));
                self.mostrar_mensagens(false);
            }
            "message.reaction" if desta(&dados) => self.reacao_recebida(dados),
            "chat.lida" | "chat.naoLida" | "chat.estado" if desta(&dados) => self.recarregar_conversas_em_breve(),
            _ => {}
        }
    }

    /// Notificacao do Windows para mensagem recebida agora, a menos que a conversa esteja aberta com a janela
    /// na frente, ou silenciada.
    fn notificar_novas(&self, lista: &[api::Mensagem]) {
        let (ligadas, com_som) = self.est(|e| (!e.cfg.sem_notificacoes, !e.cfg.sem_som));
        if !ligadas {
            return;
        }
        let avisos: Vec<(String, String, String, String)> = self.est(|e| {
            let sessao = e.sessao.clone().unwrap_or_default();
            lista
                .iter()
                .filter(|m| m.live && !m.from_me)
                .filter_map(|m| {
                    let conv = e.conversas.iter().find(|c| c.jid == m.remote_jid);
                    if conv.map(|c| c.silenciada).unwrap_or(false) {
                        return None;
                    }
                    let nome = conv.map(formato::nome_conversa).unwrap_or_else(|| m.push_name.clone().unwrap_or_else(|| formato::numero(&m.remote_jid)));
                    let mut texto = m.content.clone().filter(|t| !t.trim().is_empty()).unwrap_or_else(|| formato::previa_tipo(m.tipo.as_deref()).to_string());
                    if m.remote_jid.ends_with("@g.us") {
                        if let Some(autor) = m.sender_name.clone().or_else(|| m.push_name.clone()) {
                            texto = format!("{autor}: {texto}");
                        }
                    }
                    Some((m.remote_jid.clone(), nome, texto, format!("{sessao}|{}", m.remote_jid)))
                })
                .collect()
        });
        if avisos.is_empty() {
            return;
        }
        let aberta = self.est(|e| e.jid.clone()).unwrap_or_default();
        self.tela(move |ui| {
            let na_frente = ui.window().is_visible() && sistema::janela_na_frente(ui.window());
            for (jid, nome, texto, chave) in avisos {
                if na_frente && jid == aberta {
                    continue;
                }
                sistema::notificar_com(&nome, &texto, &chave, com_som);
            }
        });
    }

    /// varias mensagens chegando juntas -> um recarregamento so da lista
    fn recarregar_conversas_em_breve(&self) {
        let ja = self.est(|e| std::mem::replace(&mut e.recarregar_agendado, true));
        if ja {
            return;
        }
        let a = self.clone();
        self.lancar(async move {
            tokio::time::sleep(std::time::Duration::from_millis(600)).await;
            a.est(|e| e.recarregar_agendado = false);
            // atualiza por baixo dos panos: mescla a primeira pagina e mantem as ja carregadas
            a.atualizar_conversas();
        });
    }

    /// Com a janela visivel e na frente, marca como lida a conversa aberta que recebeu mensagem enquanto a pessoa
    /// estava longe. Roda num relogio da thread da tela (ver `main`).
    fn vigiar_leitura(&self, ui: &App) {
        if !self.est(|e| e.pendente_lida) {
            return;
        }
        if ui.window().is_visible() && sistema::janela_na_frente(ui.window()) {
            if let Some((s, j)) = self.est(|e| {
                e.pendente_lida = false;
                Some((e.sessao.clone()?, e.jid.clone()?))
            }) {
                self.marcar_lida_agora(s, j);
            }
        }
    }
}

/// O que fazer com a rolagem da conversa ao remontar a lista de mensagens.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Rolagem {
    Sempre,
    /// so se a pessoa ja estava no fim da conversa
    SeNoFim,
    Nunca,
}

impl Rolagem {
    fn rolar(self, estava_no_fim: bool) -> bool {
        match self {
            Rolagem::Sempre => true,
            Rolagem::SeNoFim => estava_no_fim,
            Rolagem::Nunca => false,
        }
    }
}

const ICONE: &[u8] = include_bytes!("../ui/icone.png");

fn mostrar_janela(ui: &App) {
    let _ = ui.show();
    sistema::trazer_para_frente(ui.window());
}

fn main() -> Result<(), slint::PlatformError> {
    if !sistema::primeira_copia() {
        return Ok(()); // a copia que ja estava aberta aparece
    }
    let oculto = std::env::args().any(|a| a == "--oculto");
    let rt = tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_all().build().expect("runtime");
    let ui = App::new()?;
    ui.set_versao(format!("Versão {}", env!("CARGO_PKG_VERSION")).into());

    let cfg = config::ler();
    let a = App2 {
        ui: ui.as_weak(),
        e: Arc::new(Mutex::new(Estado { cfg: cfg.clone(), imagens: cache::Lru::novo(TETO_MINIATURAS), ..Default::default() })),
        rt: rt.handle().clone(),
        fila_fotos: Arc::new(tokio::sync::Semaphore::new(4)),
    };
    midia::limpar_temporarios();

    let c = a.clone();
    ui.on_verificar(move |e| c.verificar(e.to_string()));
    let c = a.clone();
    ui.on_confiar(move || c.confiar());
    let c = a.clone();
    ui.on_cancelar_cert(move || {
        c.est(|e| e.cert_pendente = None);
        c.tela(|ui| ui.set_mostrar_cert(false));
    });
    let c = a.clone();
    ui.on_cert_digitado(move |t| c.cert_digitado(t.to_string()));
    let c = a.clone();
    ui.on_entrar(move |e, s, k| c.entrar(e.to_string(), s.to_string(), k.to_string()));
    let c = a.clone();
    ui.on_trocar_servidor(move || c.trocar_servidor());
    let c = a.clone();
    ui.on_escolher_sessao(move |i| c.escolher_sessao(i.max(0) as usize));
    let c = a.clone();
    ui.on_buscar(move |t| c.buscar(t.to_string()));
    let c = a.clone();
    ui.on_filtrar(move |f| c.filtrar(f.max(0) as usize));
    let c = a.clone();
    ui.on_abrir(move |j| c.abrir(j.to_string()));
    let c = a.clone();
    ui.on_enviar(move |t| c.enviar(t.to_string()));
    let c = a.clone();
    ui.on_mais_antigas(move || c.mais_antigas());
    let c = a.clone();
    ui.on_mais_conversas(move || c.carregar_conversas(false));
    let c = a.clone();
    ui.on_sair(move || c.sair());
    let c = a.clone();
    ui.on_trocar_assinar(move |v| c.trocar_assinar(v));
    let c = a.clone();
    ui.on_anexar(move || c.anexar());
    let c = a.clone();
    ui.on_colar(move || c.colar());
    let c = a.clone();
    ui.on_remover_anexo(move |i| c.remover_anexo(i.max(0) as usize));
    let c = a.clone();
    ui.on_abrir_midia(move |id| c.abrir_midia(id.to_string()));
    let c = a.clone();
    ui.on_tocar(move |id| c.tocar(id.to_string()));
    let c = a.clone();
    ui.on_gravar(move || c.gravar());
    let c = a.clone();
    ui.on_cancelar_gravacao(move || c.cancelar_gravacao());
    let c = a.clone();
    ui.on_enviar_gravacao(move || c.enviar_gravacao());
    let c = a.clone();
    ui.on_salvar_midia(move |id| c.salvar_midia(id.to_string()));
    a.ligar_acoes(&ui);

    // abre de onde parou: servidor confirmado + login guardado -> direto no atendimento
    ui.set_endereco(cfg.servidor.clone().unwrap_or_default().into());
    ui.set_email(cfg.email.clone().unwrap_or_default().into());
    // o endereco guardado no config e revalidado (esquema, host, sem usuario/senha): arquivo adulterado nao passa
    let fixacao = tls::Fixacao::de_config(&cfg);
    let guardado = cfg.servidor.as_deref().and_then(|o| servidor::validar(o).ok().filter(|v| v == o));
    match guardado {
        Some(o) if o.starts_with("http://") || !fixacao.vazia() => {
            ui.set_servidor(o.clone().into());
            match Cliente::novo(&o, Some(&fixacao).filter(|f| !f.vazia())) {
                Ok(c) => {
                    a.est(|e| e.cliente = Some(c.clone()));
                    if let Some(cookie) = config::ler_sessao() {
                        c.usar_cookie(&cookie);
                        ui.set_ocupado(true);
                        ui.set_tela(1);
                        let a2 = a.clone();
                        rt.spawn(async move { a2.iniciar_atendimento().await });
                    } else {
                        ui.set_tela(1);
                    }
                }
                Err(_) => ui.set_tela(0),
            }
        }
        _ => ui.set_tela(0),
    }

    // ---- Windows: notificacoes, bandeja, iniciar com o Windows, segunda copia ----
    {
        let w = ui.as_weak();
        let a2 = a.clone();
        sistema::preparar_notificacoes(ICONE, move |chave| {
            let a3 = a2.clone();
            let _ = w.upgrade_in_event_loop(move |ui| {
                mostrar_janela(&ui);
                if let Some((sessao, jid)) = chave.split_once('|') {
                    if a3.est(|e| e.sessao.as_deref() == Some(sessao)) {
                        a3.abrir(jid.to_string());
                    }
                }
            });
        });
        let w = ui.as_weak();
        sistema::ouvir_outra_copia(move || {
            let _ = w.upgrade_in_event_loop(|ui| mostrar_janela(&ui));
        });
    }
    if !a.est(|e| e.cfg.inicio_definido) && config::perfil().is_none() {
        // primeira vez: liga o "iniciar com o Windows" (desliga pelo menu da bandeja); perfil de teste nao mexe
        let _ = sistema::definir_inicio(true);
        a.est(|e| {
            e.cfg.inicio_definido = true;
            let _ = config::salvar(&e.cfg);
        });
    }
    painel::guardar_bandeja(criar_bandeja(&ui));
    painel::ligar(&ui, &a);
    {
        let a2 = a.clone();
        let w = ui.as_weak();
        ui.window().on_close_requested(move || {
            // fechar a janela deixa o programa na bandeja (as notificacoes continuam); Sair fica no menu dela
            let avisar = a2.est(|e| {
                let primeira = !e.cfg.avisou_bandeja;
                if primeira {
                    e.cfg.avisou_bandeja = true;
                    let _ = config::salvar(&e.cfg);
                }
                primeira
            });
            if avisar {
                sistema::notificar("O ZapHub continua aberto", "Ele fica no ícone perto do relógio e avisa quando chegar mensagem. Para fechar de vez, use Sair no menu do ícone.", "");
            }
            let _ = w;
            slint::CloseRequestResponse::HideWindow
        });
    }
    if sistema::elevado() {
        // rodando como administrador: tudo o que o programa abrisse subiria com privilegio; por isso nao abre arquivos
        ui.set_aviso(
            "O ZapHub está rodando como administrador. Por segurança ele não abre arquivos nem o navegador neste modo (use Salvar). Feche e abra de novo pelo menu Iniciar, sem \"Executar como administrador\"."
                .into(),
        );
    }
    // a cada segundo: se chegou mensagem na conversa aberta enquanto a janela estava escondida/atras, marca lida ao voltar
    let relogio_leitura = slint::Timer::default();
    {
        let (a2, w) = (a.clone(), ui.as_weak());
        relogio_leitura.start(slint::TimerMode::Repeated, std::time::Duration::from_secs(1), move || {
            if let Some(ui) = w.upgrade() {
                a2.vigiar_leitura(&ui);
            }
        });
    }
    if !oculto {
        ui.show()?;
    }
    slint::run_event_loop_until_quit()?;
    drop(relogio_leitura);
    audio::parar_tudo();
    // sem tempo real nem tarefas: nada mais usa os arquivos temporarios
    a.est(|e| {
        e.conexao = None;
        if let Some(o) = e.ouvindo.take() {
            o.abort();
        }
    });
    midia::apagar_temporarios_desta_execucao();
    Ok(())
}

/// Icone perto do relogio: clique abre; menu com Abrir, Iniciar com o Windows e Sair.
fn criar_bandeja(ui: &App) -> Option<tray_icon::TrayIcon> {
    use tray_icon::menu::{CheckMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem};
    use tray_icon::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    let img = image::load_from_memory(ICONE).ok()?.to_rgba8();
    let (w, h) = img.dimensions();
    let icone = tray_icon::Icon::from_rgba(img.into_raw(), w, h).ok()?;
    let menu = Menu::new();
    let abrir = MenuItem::new("Abrir o ZapHub", true, None);
    let inicio = CheckMenuItem::new("Iniciar junto com o Windows", true, sistema::inicia_com_windows(), None);
    let sair = MenuItem::new("Sair", true, None);
    menu.append_items(&[&abrir, &PredefinedMenuItem::separator(), &inicio, &PredefinedMenuItem::separator(), &sair]).ok()?;
    let bandeja = TrayIconBuilder::new().with_tooltip("ZapHub").with_icon(icone).with_menu(Box::new(menu)).build().ok()?;
    let (id_abrir, id_inicio, id_sair) = (abrir.id().clone(), inicio.id().clone(), sair.id().clone());
    let weak = ui.as_weak();
    let relogio = slint::Timer::default();
    relogio.start(slint::TimerMode::Repeated, std::time::Duration::from_millis(120), move || {
        let Some(ui) = weak.upgrade() else { return };
        while let Ok(ev) = TrayIconEvent::receiver().try_recv() {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev {
                mostrar_janela(&ui);
            }
        }
        while let Ok(ev) = MenuEvent::receiver().try_recv() {
            if ev.id == id_abrir {
                mostrar_janela(&ui);
            } else if ev.id == id_inicio {
                let ligado = inicio.is_checked();
                if sistema::definir_inicio(ligado).is_err() {
                    inicio.set_checked(!ligado);
                }
            } else if ev.id == id_sair {
                let _ = slint::quit_event_loop();
            }
        }
    });
    // o relogio vive enquanto o programa roda
    std::mem::forget(relogio);
    Some(bandeja)
}

fn tamanho(n: usize) -> String {
    match n {
        n if n >= 1024 * 1024 => format!("{:.1} MB", n as f64 / 1024.0 / 1024.0),
        n if n >= 1024 => format!("{} KB", n / 1024),
        n => format!("{n} B"),
    }
}


/// Troca so a linha da foto que acabou de chegar (a lista de mensagens nao e remontada). false = nao achou a linha.
fn atualizar_foto_na_tela(ui: &App, id: &str, buf: &slint::SharedPixelBuffer<slint::Rgba8Pixel>) -> bool {
    use slint::Model;
    let modelo = ui.get_mensagens();
    for i in 0..modelo.row_count() {
        let Some(mut m) = modelo.row_data(i) else { continue };
        if m.id.as_str() != id {
            continue;
        }
        let (l, a) = formato::dimensoes_imagem(buf.width() as f32, buf.height() as f32, !m.texto.is_empty());
        m.imagem = slint::Image::from_rgba8(buf.clone());
        m.carregando_imagem = false;
        m.img_largura = l;
        m.img_altura = a;
        modelo.set_row_data(i, m);
        return true;
    }
    false
}

/// So as linhas de audio da lista: botao tocar/pausar, barra e tempo (sem remontar a lista inteira).
fn atualizar_audio_na_tela(ui: &App, som: Option<&(String, bool, f32, String)>) {
    use slint::Model;
    let modelo = ui.get_mensagens();
    for i in 0..modelo.row_count() {
        let Some(mut m) = modelo.row_data(i) else { continue };
        if !m.eh_audio {
            continue;
        }
        let deste = som.filter(|s| s.0 == m.id.as_str());
        let (tocando, prog, tempo) = match deste {
            Some(s) => (s.1, s.2, s.3.clone()),
            None => (false, 0.0, String::new()),
        };
        if m.tocando != tocando || (m.progresso - prog).abs() > 0.001 || m.tempo.as_str() != tempo {
            m.tocando = tocando;
            m.progresso = prog;
            m.tempo = tempo.into();
            modelo.set_row_data(i, m);
        }
    }
}
