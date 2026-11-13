//! Integracao com o Windows: notificacoes nativas (central de notificacoes), iniciar com o Windows,
//! uma copia so do programa e saber se a janela esta em primeiro plano.

use std::sync::OnceLock;
use windows::core::HSTRING;
use windows::Data::Xml::Dom::XmlDocument;
use windows::Foundation::TypedEventHandler;
use windows::UI::Notifications::{ToastActivatedEventArgs, ToastNotification, ToastNotificationManager, ToastNotifier};
use windows_sys::Win32::Foundation::{GetLastError, ERROR_ALREADY_EXISTS, HANDLE};
use windows_sys::Win32::System::Threading::{CreateEventW, CreateMutexW, OpenEventW, SetEvent, WaitForSingleObject, EVENT_MODIFY_STATE, INFINITE};

const AUMID: &str = "ZapHub.Desktop";
const CHAVE_INICIO: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";

fn largo(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

// ---------- uma copia so ----------
/// true = esta e a primeira copia. Se ja houver outra aberta, pede para ela aparecer e devolve false.
fn nome_trava(tipo: &str) -> Vec<u16> {
    let sufixo = crate::config::perfil().map(|p| format!(".{p}")).unwrap_or_default();
    largo(&format!("Local\\ZapHub.Desktop.{tipo}{sufixo}"))
}

pub fn primeira_copia() -> bool {
    let nome = nome_trava("Instancia");
    // SAFETY: nome terminado em zero; o mutex fica aberto ate o processo acabar (de proposito).
    unsafe {
        CreateMutexW(std::ptr::null(), 0, nome.as_ptr());
        if GetLastError() == ERROR_ALREADY_EXISTS {
            let ev = OpenEventW(EVENT_MODIFY_STATE, 0, nome_trava("Mostrar").as_ptr());
            if !ev.is_null() {
                SetEvent(ev);
            }
            return false;
        }
    }
    true
}

/// Fica esperando a segunda copia pedir "aparece" e chama `mostrar`.
pub fn ouvir_outra_copia(mostrar: impl Fn() + Send + 'static) {
    let nome = nome_trava("Mostrar");
    // SAFETY: evento de reset automatico, nome terminado em zero.
    let ev: HANDLE = unsafe { CreateEventW(std::ptr::null(), 0, 0, nome.as_ptr()) };
    if ev.is_null() {
        return;
    }
    let ev = ev as usize;
    std::thread::spawn(move || loop {
        // SAFETY: handle valido durante toda a vida do processo.
        let r = unsafe { WaitForSingleObject(ev as HANDLE, INFINITE) };
        if r != 0 {
            return;
        }
        mostrar();
    });
}

// ---------- iniciar com o Windows ----------
pub fn inicia_com_windows() -> bool {
    winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER)
        .open_subkey(CHAVE_INICIO)
        .and_then(|k| k.get_value::<String, _>("ZapHub"))
        .is_ok()
}

pub fn definir_inicio(ligado: bool) -> Result<(), String> {
    let (k, _) = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER).create_subkey(CHAVE_INICIO).map_err(|e| e.to_string())?;
    if ligado {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        k.set_value("ZapHub", &format!("\"{}\" --oculto", exe.display())).map_err(|e| e.to_string())
    } else {
        match k.delete_value("ZapHub") {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

// ---------- notificacoes ----------
static NOTIFICADOR: OnceLock<Option<ToastNotifier>> = OnceLock::new();
static AO_CLICAR: OnceLock<Box<dyn Fn(String) + Send + Sync>> = OnceLock::new();

/// Registra o programa como remetente de notificacoes (nome e icone na central do Windows).
pub fn preparar_notificacoes(icone_png: &[u8], ao_clicar: impl Fn(String) + Send + Sync + 'static) {
    let _ = AO_CLICAR.set(Box::new(ao_clicar));
    let icone = crate::config::pasta().map(|p| p.join("icone.png"));
    if let Some(i) = &icone {
        let _ = std::fs::create_dir_all(i.parent().unwrap_or(i));
        let _ = std::fs::write(i, icone_png);
    }
    if let Ok((k, _)) = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER).create_subkey(format!(r"Software\Classes\AppUserModelId\{AUMID}")) {
        let _ = k.set_value("DisplayName", &"ZapHub");
        if let Some(i) = &icone {
            let _ = k.set_value("IconUri", &i.display().to_string());
        }
    }
    // SAFETY: string terminada em zero.
    unsafe {
        let _ = windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID(&HSTRING::from(AUMID));
    }
    let _ = NOTIFICADOR.set(ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(AUMID)).ok());
}

fn som_xml(com_som: bool) -> &'static str {
    if com_som {
        r#"<audio src="ms-winsoundevent:Notification.IM"/>"#
    } else {
        r#"<audio silent="true"/>"#
    }
}

/// O programa esta rodando como administrador (token elevado)? Elevado, tudo o que ele abre tambem sobe com
/// privilegio; por isso ele nao abre arquivos nem o navegador nesse modo.
pub fn elevado() -> bool {
    static ELEVADO: OnceLock<bool> = OnceLock::new();
    *ELEVADO.get_or_init(|| {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
        use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
        let mut token: HANDLE = std::ptr::null_mut();
        let mut dados = TOKEN_ELEVATION { TokenIsElevated: 0 };
        let mut tamanho = 0u32;
        // SAFETY: token do proprio processo, so leitura; `dados` tem o tamanho informado e o handle e fechado em seguida.
        unsafe {
            if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
                return false;
            }
            let ok = GetTokenInformation(token, TokenElevation, (&mut dados as *mut TOKEN_ELEVATION).cast(), std::mem::size_of::<TOKEN_ELEVATION>() as u32, &mut tamanho);
            CloseHandle(token);
            ok != 0 && dados.TokenIsElevated != 0
        }
    })
}

/// ShellExecute "open" num alvo (caminho ou URL em UTF-16 terminado em zero). Deve rodar FORA da thread da tela
/// (spawn_blocking): inicia o COM da thread (apartamento unico), como o shell exige, e desfaz no fim.
pub fn shell_abrir(alvo: &[u16]) -> bool {
    use windows_sys::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};
    let verbo = largo("open");
    // SAFETY: strings terminadas em zero e vivas durante a chamada; o CoUninitialize so acontece se o CoInitializeEx deu certo.
    unsafe {
        let com = CoInitializeEx(std::ptr::null(), COINIT_APARTMENTTHREADED as u32);
        let r = windows_sys::Win32::UI::Shell::ShellExecuteW(
            std::ptr::null_mut(),
            verbo.as_ptr(),
            alvo.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL,
        );
        if com >= 0 {
            CoUninitialize();
        }
        (r as isize) > 32
    }
}

/// Abre uma pagina no navegador padrao. So https (ou http no proprio computador) e sem espacos/controles.
pub fn abrir_url(url: &str) -> Result<(), String> {
    if !url_segura(url) {
        return Err("Endereço não permitido.".into());
    }
    if elevado() {
        return Err(format!("O ZapHub está rodando como administrador e, por segurança, não abre o navegador. Abra este endereço você mesmo: {url}"));
    }
    let alvo = largo(url);
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(shell_abrir(&alvo));
    });
    match rx.recv_timeout(std::time::Duration::from_secs(3)) {
        Ok(false) => Err("Não consegui abrir o navegador.".into()),
        _ => Ok(()),
    }
}

/// So https, ou http apenas no proprio computador (localhost, 127.0.0.1, ::1 exatos); sem usuario/senha,
/// sem espacos/controles. Confere o host depois de interpretar a URL (nao por prefixo de texto).
fn url_segura(url: &str) -> bool {
    use std::net::{Ipv4Addr, Ipv6Addr};
    if url.len() >= 500 || url.chars().any(|c| c.is_control() || c.is_whitespace() || matches!(c, '"' | '<' | '>' | '\\')) {
        return false;
    }
    let Ok(u) = url::Url::parse(url) else { return false };
    if !u.username().is_empty() || u.password().is_some() {
        return false;
    }
    match (u.scheme(), u.host()) {
        ("https", Some(_)) => true,
        ("http", Some(url::Host::Domain("localhost"))) => true,
        ("http", Some(url::Host::Ipv4(ip))) => ip == Ipv4Addr::LOCALHOST,
        ("http", Some(url::Host::Ipv6(ip))) => ip == Ipv6Addr::LOCALHOST,
        _ => false,
    }
}

fn xml(s: &str) -> String {
    s.chars()
        .filter(|c| !c.is_control() || *c == '\n')
        .map(|c| match c {
            '&' => "&amp;".to_string(),
            '<' => "&lt;".to_string(),
            '>' => "&gt;".to_string(),
            '"' => "&quot;".to_string(),
            '\'' => "&apos;".to_string(),
            c => c.to_string(),
        })
        .collect()
}

/// Mostra a notificacao. `chave` volta no clique (ex.: "sessao|jid") e agrupa: nova mensagem da mesma
/// conversa substitui a anterior.
pub fn notificar(titulo: &str, texto: &str, chave: &str) {
    notificar_com(titulo, texto, chave, true)
}

/// Igual a `notificar`, escolhendo se toca o som do Windows junto.
pub fn notificar_com(titulo: &str, texto: &str, chave: &str, com_som: bool) {
    let Some(Some(n)) = NOTIFICADOR.get() else { return };
    let titulo: String = titulo.chars().take(80).collect();
    let texto: String = texto.chars().take(240).collect();
    let corpo = format!(
        r#"<toast launch="{}"><visual><binding template="ToastGeneric"><text>{}</text><text>{}</text></binding></visual>{}</toast>"#,
        xml(chave),
        xml(&titulo),
        xml(&texto),
        som_xml(com_som)
    );
    let r = (|| -> windows::core::Result<()> {
        let doc = XmlDocument::new()?;
        doc.LoadXml(&HSTRING::from(corpo))?;
        let t = ToastNotification::CreateToastNotification(&doc)?;
        let tag: String = format!("{:x}", chave.bytes().fold(5381u64, |h, b| h.wrapping_mul(33) ^ b as u64));
        t.SetTag(&HSTRING::from(tag))?;
        t.SetGroup(&HSTRING::from("conversas"))?;
        let c = chave.to_string();
        t.Activated(&TypedEventHandler::<ToastNotification, windows::core::IInspectable>::new(move |_, _args| {
            let _ = _args.as_ref().and_then(|a| windows::core::Interface::cast::<ToastActivatedEventArgs>(a).ok());
            if let Some(f) = AO_CLICAR.get() {
                f(c.clone());
            }
            Ok(())
        }))?;
        n.Show(&t)
    })();
    if let Err(e) = r {
        eprintln!("notificacao: {e}");
    }
}

// ---------- foco ----------
/// A janela do programa e a que esta na frente agora?
pub fn janela_na_frente(janela: &slint::Window) -> bool {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    let alca = janela.window_handle();
    let Ok(h) = alca.window_handle() else { return false };
    let RawWindowHandle::Win32(w) = h.as_raw() else { return false };
    // SAFETY: so le qual janela esta em primeiro plano.
    let frente = unsafe { windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow() };
    frente as isize == w.hwnd.get()
}

/// Traz a janela para a frente (depois de mostrar).
pub fn trazer_para_frente(janela: &slint::Window) {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    let alca = janela.window_handle();
    let Ok(h) = alca.window_handle() else { return };
    let RawWindowHandle::Win32(w) = h.as_raw() else { return };
    // SAFETY: hwnd da propria janela.
    unsafe {
        use windows_sys::Win32::UI::WindowsAndMessaging::{IsIconic, SetForegroundWindow, ShowWindow, SW_RESTORE};
        let hwnd = w.hwnd.get() as _;
        if IsIconic(hwnd) != 0 {
            ShowWindow(hwnd, SW_RESTORE);
        }
        SetForegroundWindow(hwnd);
    }
}

#[cfg(test)]
mod testes {
    /// Mostra uma notificacao de verdade: cargo test -- --ignored notificacao_real
    #[test]
    #[ignore]
    fn notificacao_real() {
        super::preparar_notificacoes(include_bytes!("../ui/icone.png"), |_| {});
        super::notificar("Teste do ZapHub", "Notificação nativa do programa do Windows <funcionando> & ok", "teste|x");
        std::thread::sleep(std::time::Duration::from_secs(2));
        assert!(matches!(super::NOTIFICADOR.get(), Some(Some(_))), "notificador nao foi criado");
    }

    #[test]
    fn inicio_com_windows_ida_e_volta() {
        let antes = super::inicia_com_windows();
        super::definir_inicio(true).unwrap();
        assert!(super::inicia_com_windows());
        super::definir_inicio(false).unwrap();
        assert!(!super::inicia_com_windows());
        super::definir_inicio(antes).unwrap();
    }

    #[test]
    fn som_do_aviso() {
        assert!(super::som_xml(true).contains("ms-winsoundevent"));
        assert!(super::som_xml(false).contains("silent"));
    }

    #[test]
    fn so_abre_endereco_seguro() {
        assert!(super::url_segura("https://zap.empresa.com/terms"));
        assert!(super::url_segura("http://localhost:3100/terms"));
        assert!(!super::url_segura("http://zap.empresa.com/terms"));
        assert!(!super::url_segura("file:///C:/Windows/system32/calc.exe"));
        assert!(!super::url_segura("calc.exe"));
        assert!(!super::url_segura("https://a.com/x y"));
        assert!(!super::url_segura("https://a.com/\\x"));
        // o host e conferido de verdade, nao por prefixo de texto
        assert!(!super::url_segura("http://localhost.evil.com/x"));
        assert!(!super::url_segura("http://127.0.0.1.evil.com/x"));
        assert!(!super::url_segura("http://localhost@evil.com/x"));
        assert!(!super::url_segura("http://127.0.0.10/x"));
        assert!(!super::url_segura("https://user:senha@zap.empresa.com/x"));
        assert!(super::url_segura("http://127.0.0.1:3100/terms"));
        assert!(super::url_segura("http://[::1]:3100/terms"));
        assert!(super::url_segura("HTTPS://Zap.Empresa.com/x"));
        assert!(!super::url_segura(&format!("https://a.com/{}", "x".repeat(600))));
    }

    #[test]
    fn elevacao_e_consultavel() {
        // nao importa o valor (depende de como o teste roda); so nao pode travar nem mudar entre chamadas
        assert_eq!(super::elevado(), super::elevado());
    }

    #[test]
    fn escapa_xml() {
        assert_eq!(super::xml("a<b>&\"c'"), "a&lt;b&gt;&amp;&quot;c&apos;");
        assert_eq!(super::xml("x\u{0007}y"), "xy");
    }
}
