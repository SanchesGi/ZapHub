//! Midia da conversa: miniatura das fotos, nome original para baixar, abrir com o programa padrao do Windows
//! (bloqueando executaveis) e o tipo de envio de cada arquivo escolhido.

use slint::{Rgba8Pixel, SharedPixelBuffer};
use std::path::{Path, PathBuf};

/// O servidor so serve midia em /api/media/<nome>. Qualquer outra coisa nao e baixada (o cookie do login
/// nunca vai para outro caminho/servidor por causa de um mediaUrl estranho).
pub fn caminho_valido(media_url: &str) -> bool {
    let Some(nome) = media_url.strip_prefix("/api/media/") else { return false };
    !nome.is_empty() && !nome.contains("..") && !nome.contains('/') && !nome.contains('\\') && !nome.contains('?') && !nome.contains('#')
}

/// Extensoes que o Windows executa ou que rodam codigo: nunca "Abrir" direto, so "Salvar".
const PERIGOSAS: &[&str] = &[
    "exe", "com", "scr", "pif", "bat", "cmd", "msi", "msp", "mst", "msix", "msixbundle", "appx", "appxbundle", "appinstaller",
    "js", "jse", "vbs", "vbe", "wsf", "wsh", "wsc", "ps1", "psm1", "psd1", "ps1xml", "psc1", "hta", "lnk", "url", "reg", "cpl",
    "jar", "dll", "sys", "drv", "ocx", "inf", "scf", "chm", "application", "gadget", "settingcontent-ms", "iso", "img", "vhd",
    "vhdx", "xll", "xlam", "ppam", "docm", "xlsm", "pptm", "dotm", "xltm", "potm", "library-ms", "search-ms", "diagcab", "msc",
    "mht", "mhtml", "website", "theme", "themepack", "rdp", "ade", "adp", "mde", "accde", "py", "pyw", "rb", "pl", "sh", "elf",
];

pub fn perigoso(nome: &str) -> bool {
    let ext = nome.rsplit_once('.').map(|(_, e)| e.trim().to_ascii_lowercase()).unwrap_or_default();
    PERIGOSAS.contains(&ext.as_str()) || nome.ends_with(' ') || nome.ends_with('.')
}

/// Lista de PERMITIDAS: so estes tipos abrem direto com o programa padrao (documentos, imagens, audio, video
/// e texto simples). Todo o resto (inclusive o que nao conhecemos) so pode ser salvo.
const PERMITIDAS: &[&str] = &[
    "pdf", "jpg", "jpeg", "png", "webp", "gif", "mp4", "mov", "3gp", "mp3", "m4a", "ogg", "opus", "wav", "txt", "csv", "docx", "xlsx", "pptx",
];

pub fn pode_abrir(nome: &str) -> bool {
    if perigoso(nome) {
        return false;
    }
    let ext = nome.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    PERMITIDAS.contains(&ext.as_str())
}

pub const AVISO_SO_SALVAR: &str = "Por segurança este tipo de arquivo não abre direto. Use Salvar e confira antes de abrir.";

fn extensao(media_url: &str) -> String {
    let base = media_url.split(['?', '#']).next().unwrap_or("");
    match base.rsplit_once('.') {
        Some((_, e)) if (1..=10).contains(&e.len()) && e.chars().all(|c| c.is_ascii_alphanumeric()) => format!(".{}", e.to_ascii_lowercase()),
        _ => String::new(),
    }
}

/// Mesmo nome que o painel usa ao baixar (lib/nome-download.ts): documento com o nome original; o resto
/// com tipo + data/hora; a extensao e sempre a do arquivo guardado.
pub fn nome_download(tipo: &str, conteudo: Option<&str>, media_url: &str, quando: Option<&str>) -> String {
    let ext = extensao(media_url);
    if tipo == "DOCUMENT" {
        if let Some(original) = conteudo.map(limpar_nome).filter(|n| !n.is_empty()) {
            return if extensao(&original).is_empty() { original + &ext } else { original };
        }
    }
    let rotulo = match tipo {
        "IMAGE" => "foto",
        "VIDEO" => "video",
        "AUDIO" => "audio",
        "STICKER" => "figurinha",
        "DOCUMENT" => "documento",
        _ => "arquivo",
    };
    let data = quando
        .and_then(|q| chrono::DateTime::parse_from_rfc3339(q).ok())
        .map(|d| d.with_timezone(&chrono::Local).format(" %Y-%m-%d %H-%M-%S").to_string())
        .unwrap_or_default();
    format!("{rotulo}{data}{ext}")
}

/// Caracteres que nao devem aparecer num nome de arquivo: controles (inclusive C1), marcas de direcao (bidi)
/// e invisiveis (largura zero, joiners, word joiner, BOM) que enganam quem le o nome.
fn invisivel_ou_controle(c: char) -> bool {
    let k = c as u32;
    k < 32
        || k == 127
        || (0x80..=0x9f).contains(&k)
        || (0x202a..=0x202e).contains(&k)
        || (0x2066..=0x2069).contains(&k)
        || matches!(k, 0x200e | 0x200f | 0x061c | 0xfeff)
        || (0x200b..=0x200d).contains(&k)
        || (0x2060..=0x2064).contains(&k)
}

/// Nomes que o Windows reserva a dispositivos (CON, PRN, AUX, NUL, COM1-9, LPT1-9, CONIN$, CONOUT$), mesmo com
/// extensao ("con.txt") e com digitos sobrescritos (COM¹, LPT²).
pub fn nome_reservado(nome: &str) -> bool {
    let antes_do_ponto = nome.split('.').next().unwrap_or("");
    let normal: String = antes_do_ponto
        .chars()
        .filter(|c| !c.is_whitespace())
        .map(|c| match c {
            '¹' => '1',
            '²' => '2',
            '³' => '3',
            c => c.to_ascii_uppercase(),
        })
        .collect();
    match normal.as_str() {
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$" => true,
        n => {
            let mut letras = n.chars();
            let digito = letras.next_back();
            matches!(letras.as_str(), "COM" | "LPT") && digito.is_some_and(|d| ('1'..='9').contains(&d))
        }
    }
}

/// Sem pastas, sem caracteres que o Windows recusa, sem controle/bidi/invisiveis, espacos repetidos juntos,
/// sem nome reservado do Windows; tamanho limitado.
pub fn limpar_nome(nome: &str) -> String {
    let base = nome.rsplit(['\\', '/']).next().unwrap_or("");
    let limpo: String = base.chars().filter(|&c| !invisivel_ou_controle(c) && !"<>:\"|?*".contains(c)).collect();
    let limpo = limpo.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut limpo = limpo.trim().trim_start_matches('.').trim_end_matches(['.', ' ']).to_string();
    if limpo.chars().count() > 150 {
        let ext = extensao(&limpo);
        let corpo: String = limpo.chars().take(150 - ext.chars().count()).collect();
        limpo = corpo + &ext;
    }
    if nome_reservado(&limpo) {
        limpo.insert(0, '_');
    }
    limpo
}

/// Lado maior das miniaturas na tela.
pub const LADO_MINIATURA: u32 = 320;

/// Decodifica uma imagem do servidor com limites: no maximo 8192x8192 e 64 MB de memoria. Imagem gigante
/// ("bomba de descompressao") ou corrompida vira `None`.
pub fn decodificar(dados: &[u8]) -> Option<image::DynamicImage> {
    let mut leitor = image::ImageReader::new(std::io::Cursor::new(dados)).with_guessed_format().ok()?;
    let mut limites = image::Limits::default();
    limites.max_image_width = Some(8192);
    limites.max_image_height = Some(8192);
    limites.max_alloc = Some(64 * 1024 * 1024);
    leitor.limits(limites);
    leitor.decode().ok()
}

/// Miniatura para a tela (lado maior ate `LADO_MINIATURA`).
pub fn miniatura(dados: &[u8]) -> Option<SharedPixelBuffer<Rgba8Pixel>> {
    let img = decodificar(dados)?;
    let img = if img.width() > LADO_MINIATURA || img.height() > LADO_MINIATURA { img.thumbnail(LADO_MINIATURA, LADO_MINIATURA) } else { img };
    let rgba = img.to_rgba8();
    Some(SharedPixelBuffer::clone_from_slice(rgba.as_raw(), rgba.width(), rgba.height()))
}

/// Pasta temporaria do programa para abrir arquivos (apagada a cada inicio).
pub fn pasta_temporaria() -> PathBuf {
    PASTA_TEMP.get_or_init(|| base_temporaria().join(nome_aleatorio())).clone()
}

static PASTA_TEMP: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

/// %LOCALAPPDATA%\ZapHub[-perfil]\tmp: area do proprio usuario, nao o TEMP compartilhado.
fn base_temporaria() -> PathBuf {
    crate::config::pasta_local().unwrap_or_else(|| std::env::temp_dir().join("ZapHub")).join("tmp")
}

/// Nome imprevisivel (sementes aleatorias do proprio sistema), para ninguem adivinhar a pasta.
fn nome_aleatorio() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let a = RandomState::new().build_hasher().finish();
    let b = RandomState::new().build_hasher().finish();
    format!("{a:016x}{b:016x}")
}

/// No inicio: apaga o que execucoes anteriores deixaram (queda, falta de energia).
pub fn limpar_temporarios() {
    let _ = std::fs::remove_dir_all(base_temporaria());
}

/// Ao sair: apaga a pasta desta execucao.
pub fn apagar_temporarios_desta_execucao() {
    if let Some(p) = PASTA_TEMP.get() {
        let _ = std::fs::remove_dir_all(p);
    }
}

/// Marca o arquivo como "veio da internet" (Mark of the Web): o Windows e o Office tratam com cuidado
/// (SmartScreen, Modo de Exibicao Protegido).
pub fn marcar_internet(caminho: &Path) {
    let mut ads = caminho.as_os_str().to_owned();
    ads.push(":Zone.Identifier");
    let _ = std::fs::write(PathBuf::from(ads), "[ZoneTransfer]\r\nZoneId=3\r\n");
}

/// Grava num arquivo novo (nunca sobrescreve: acrescenta " (2)", " (3)"...).
pub fn gravar_sem_sobrescrever(pasta: &Path, nome: &str, dados: &[u8]) -> std::io::Result<PathBuf> {
    std::fs::create_dir_all(pasta)?;
    let (corpo, ext) = match nome.rsplit_once('.') {
        Some((c, e)) if !c.is_empty() => (c.to_string(), format!(".{e}")),
        _ => (nome.to_string(), String::new()),
    };
    for i in 1..1000 {
        let n = if i == 1 { format!("{corpo}{ext}") } else { format!("{corpo} ({i}){ext}") };
        let p = pasta.join(n);
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&p) {
            Ok(mut f) => {
                use std::io::Write;
                f.write_all(dados)?;
                drop(f);
                marcar_internet(&p);
                return Ok(p);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    }
    Err(std::io::Error::other("nomes esgotados"))
}

/// Abre com o programa padrao do Windows. Executaveis sao recusados antes (perigoso()).
pub fn abrir_no_windows(caminho: &Path) -> Result<(), String> {
    let nome = caminho.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if !pode_abrir(nome) {
        return Err(AVISO_SO_SALVAR.into());
    }
    if crate::sistema::elevado() {
        return Err(AVISO_ELEVADO.into());
    }
    use std::os::windows::ffi::OsStrExt;
    let largo: Vec<u16> = caminho.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    if crate::sistema::shell_abrir(&largo) {
        Ok(())
    } else {
        Err("Nenhum programa deste computador abre este tipo de arquivo. Use Salvar.".into())
    }
}

pub const AVISO_ELEVADO: &str = "O ZapHub está rodando como administrador e, por segurança, não abre arquivos recebidos assim. Use Salvar, ou feche o ZapHub e abra de novo pelo menu Iniciar, sem \"Executar como administrador\".";

/// Tipo de envio pela extensao (o servidor confere o conteudo de novo em midia-segura).
pub fn tipo_envio(nome: &str) -> (&'static str, &'static str) {
    let ext = nome.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    match ext.as_str() {
        "jpg" | "jpeg" => ("image", "image/jpeg"),
        "png" => ("image", "image/png"),
        "webp" => ("image", "image/webp"),
        "gif" => ("video", "image/gif"),
        "mp4" | "m4v" => ("video", "video/mp4"),
        "mov" => ("video", "video/quicktime"),
        "3gp" => ("video", "video/3gpp"),
        "mp3" => ("audio", "audio/mpeg"),
        "m4a" => ("audio", "audio/mp4"),
        "ogg" | "opus" => ("audio", "audio/ogg"),
        "wav" => ("audio", "audio/wav"),
        "pdf" => ("document", "application/pdf"),
        "txt" => ("document", "text/plain"),
        "csv" => ("document", "text/csv"),
        "zip" => ("document", "application/zip"),
        "docx" => ("document", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        "xlsx" => ("document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        "pptx" => ("document", "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
        "doc" => ("document", "application/msword"),
        "xls" => ("document", "application/vnd.ms-excel"),
        _ => ("document", "application/octet-stream"),
    }
}

/// Imagem da area de transferencia (Ctrl+V) em PNG.
pub fn imagem_colada() -> Option<Vec<u8>> {
    let mut cb = arboard::Clipboard::new().ok()?;
    let img = cb.get_image().ok()?;
    let buf = image::RgbaImage::from_raw(img.width as u32, img.height as u32, img.bytes.into_owned())?;
    let mut png = Vec::new();
    image::DynamicImage::ImageRgba8(buf).write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png).ok()?;
    Some(png)
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn so_baixa_do_proprio_servidor() {
        assert!(caminho_valido("/api/media/abc123.jpg"));
        assert!(!caminho_valido("https://outro.com/x.jpg"));
        assert!(!caminho_valido("/api/media/../.env"));
        assert!(!caminho_valido("/api/media/a/b.jpg"));
        assert!(!caminho_valido("/api/media/"));
        assert!(!caminho_valido("//outro.com/api/media/x"));
    }

    #[test]
    fn executavel_nao_abre() {
        for n in ["virus.exe", "a.EXE", "nota.pdf.exe", "x.js", "atalho.lnk", "s.ps1", "m.docm", "x.exe ", "x.exe."] {
            assert!(perigoso(n), "{n}");
        }
        for n in ["nota.pdf", "foto.jpg", "planilha.xlsx", "texto.txt", "audio.ogg"] {
            assert!(!perigoso(n), "{n}");
        }
    }

    #[test]
    fn nome_como_no_painel() {
        assert_eq!(nome_download("DOCUMENT", Some("Contrato final.pdf"), "/api/media/x.pdf", None), "Contrato final.pdf");
        assert_eq!(nome_download("DOCUMENT", Some("..\\..\\boot.ini"), "/api/media/x.ini", None), "boot.ini");
        assert_eq!(nome_download("DOCUMENT", Some("relatorio"), "/api/media/x.pdf", None), "relatorio.pdf");
        assert!(nome_download("IMAGE", None, "/api/media/x.jpg", Some("2026-01-10T12:00:00Z")).starts_with("foto 2026-01-10"));
        assert_eq!(limpar_nome("a\u{202e}gpj.exe"), "agpj.exe");
        assert_eq!(limpar_nome("  ..oculto.txt.. "), "oculto.txt");
    }

    #[test]
    fn so_abre_o_que_esta_na_lista_de_permitidas() {
        for n in ["nota.pdf", "FOTO.JPG", "a.jpeg", "b.png", "c.webp", "d.gif", "v.mp4", "v.mov", "v.3gp", "a.mp3", "a.m4a", "a.ogg", "a.opus", "a.wav", "t.txt", "p.csv", "d.docx", "p.xlsx", "s.pptx"] {
            assert!(pode_abrir(n), "{n}");
        }
        // o que nao esta na lista so salva, inclusive tipos "desconhecidos" e sem extensao
        for n in ["a.exe", "a.zip", "a.doc", "a.xls", "a.html", "a.svg", "a.rtf", "a.xml", "a.bin", "semextensao", "a.pdf.exe", "a.pdf ", "a.pdf."] {
            assert!(!pode_abrir(n), "{n}");
        }
    }

    #[test]
    fn nomes_reservados_do_windows() {
        for n in ["CON", "con", "Prn.txt", "aux.tar.gz", "NUL", "com1", "COM9.txt", "lpt3", "LPT9.log", "CONIN$", "conout$.txt", "COM¹", "lpt²", "COM³.txt", "con .txt", " nul", "C o n"] {
            assert!(nome_reservado(n), "{n}");
        }
        for n in ["console.txt", "com0", "com10", "lpt", "comum.txt", "aux1", "relatorio.pdf", "x.con", ""] {
            assert!(!nome_reservado(n), "{n}");
        }
        assert_eq!(limpar_nome("con.txt"), "_con.txt");
        assert_eq!(limpar_nome("COM¹.pdf"), "_COM¹.pdf");
        assert_eq!(limpar_nome("normal.txt"), "normal.txt");
    }

    #[test]
    fn limpar_nome_tira_invisiveis_e_junta_espacos() {
        assert_eq!(limpar_nome("a\u{200b}b\u{200d}c\u{2060}d\u{feff}e\u{061c}f\u{0085}g\u{009f}h.txt"), "abcdefgh.txt");
        assert_eq!(limpar_nome("relatorio    final \t  v2.pdf"), "relatorio final v2.pdf");
        assert_eq!(limpar_nome("a\u{00a0}\u{00a0}b.txt"), "a b.txt");
        assert_eq!(limpar_nome("..\\..\\x\u{0007}y.txt"), "xy.txt");
        assert_eq!(limpar_nome("a<b>:c|d?e*f.txt"), "abcdef.txt");
    }

    #[test]
    fn imagem_enorme_ou_corrompida_nao_decodifica() {
        let png = |l: u32, a: u32| {
            let mut v = Vec::new();
            image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(l, a, image::Rgba([1, 2, 3, 255])))
                .write_to(&mut std::io::Cursor::new(&mut v), image::ImageFormat::Png)
                .unwrap();
            v
        };
        assert!(decodificar(&png(64, 64)).is_some());
        assert!(decodificar(&png(8192, 1)).is_some());
        assert!(decodificar(&png(8193, 1)).is_none(), "largura acima do limite");
        assert!(decodificar(&png(1, 8193)).is_none(), "altura acima do limite");
        assert!(decodificar(b"isto nao e uma imagem").is_none());
        let mini = miniatura(&png(1000, 500)).unwrap();
        assert_eq!((mini.width(), mini.height()), (LADO_MINIATURA, LADO_MINIATURA / 2));
    }

    #[test]
    fn pasta_temporaria_e_propria_da_execucao() {
        let p = pasta_temporaria();
        assert_eq!(p, pasta_temporaria());
        assert!(p.starts_with(base_temporaria()));
        assert_eq!(nome_aleatorio().len(), 32);
        assert_ne!(nome_aleatorio(), nome_aleatorio());
    }

    #[test]
    fn grava_sem_sobrescrever() {
        let d = std::env::temp_dir().join(format!("zaphub-teste-{}", std::process::id()));
        let a = gravar_sem_sobrescrever(&d, "x.txt", b"1").unwrap();
        let b = gravar_sem_sobrescrever(&d, "x.txt", b"2").unwrap();
        assert_ne!(a, b);
        assert_eq!(std::fs::read(&a).unwrap(), b"1");
        assert!(b.to_string_lossy().ends_with("x (2).txt"));
        let _ = std::fs::remove_dir_all(d);
    }
}
