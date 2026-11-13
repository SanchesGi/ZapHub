//! Configuracao do programa neste computador:
//! - %APPDATA%\ZapHub\config.json: endereco do servidor, identidade confirmada (chave publica e certificado) e
//!   preferencias. Nada de senha.
//! - %LOCALAPPDATA%\ZapHub\sessao.bin: o login (cookie da sessao), criptografado com o DPAPI do Windows; so este
//!   usuario do Windows abre. Nao viaja com o perfil de rede (roaming), por isso fica no LOCALAPPDATA.
//! - %LOCALAPPDATA%\ZapHub\tmp\<aleatorio>: arquivos abertos da conversa (apagados ao sair).

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Config {
    pub servidor: Option<String>,
    /// SHA-256 do certificado confirmado (formato antigo; continua valendo se for o unico guardado)
    pub certificado: Option<String>,
    /// SHA-256 da chave publica (SubjectPublicKeyInfo) do servidor confirmado: sobrevive a renovar o certificado
    #[serde(default)]
    pub chave_publica: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub sessao_whatsapp: Option<String>,
    /// "Assinar" por sessao do WhatsApp (o cliente ve *Seu Nome* em cima da mensagem)
    #[serde(default)]
    pub assinar: std::collections::HashMap<String, bool>,
    /// ja decidiu (ou o programa ja ligou na 1a vez) o "iniciar com o Windows"
    #[serde(default)]
    pub inicio_definido: bool,
    /// ja avisou que fechar a janela deixa o programa na bandeja
    #[serde(default)]
    pub avisou_bandeja: bool,
    /// notificacoes do Windows desligadas pela pessoa (padrao: ligadas)
    #[serde(default)]
    pub sem_notificacoes: bool,
    /// notificacoes sem som (padrao: com som)
    #[serde(default)]
    pub sem_som: bool,
}

/// Perfil separado (variavel ZAPHUB_PERFIL=nome, so letras/numeros/hifen): outra pasta de dados e outra trava de
/// copia unica, sem mexer no "iniciar com o Windows". Serve para testar sem tocar no ZapHub em uso.
pub fn perfil() -> Option<String> {
    std::env::var("ZAPHUB_PERFIL")
        .ok()
        .filter(|p| !p.is_empty() && p.len() <= 32 && p.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'))
}

fn nome_da_pasta() -> String {
    perfil().map(|p| format!("ZapHub-{p}")).unwrap_or_else(|| "ZapHub".into())
}

pub fn pasta() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(|d| PathBuf::from(d).join(nome_da_pasta()))
}

/// Dados que nao devem andar com o perfil de rede: %LOCALAPPDATA%\ZapHub[-perfil]
pub fn pasta_local() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|d| PathBuf::from(d).join(nome_da_pasta()))
}

pub fn ler() -> Config {
    pasta()
        .and_then(|p| std::fs::read_to_string(p.join("config.json")).ok())
        .and_then(|t| serde_json::from_str(t.trim_start_matches('\u{feff}')).ok())
        .unwrap_or_default()
}

pub fn salvar(cfg: &Config) -> Result<(), String> {
    let p = pasta().ok_or("Pasta de configuração indisponível.")?;
    std::fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    let texto = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(p.join("config.json"), texto).map_err(|e| e.to_string())
}

const ARQUIVO_SESSAO: &str = "sessao.bin";

/// Guarda o login criptografado (DPAPI do usuario do Windows) no LOCALAPPDATA. Vazio apaga (e apaga tambem
/// o arquivo antigo do APPDATA, se ainda existir).
pub fn guardar_sessao(cookie: &str) {
    guardar_sessao_em(pasta_local().as_deref(), pasta().as_deref(), cookie);
}

pub fn ler_sessao() -> Option<String> {
    ler_sessao_de(pasta_local().as_deref()?, pasta().as_deref())
}

fn guardar_sessao_em(local: Option<&Path>, antiga: Option<&Path>, cookie: &str) {
    if let Some(a) = antiga {
        let _ = std::fs::remove_file(a.join(ARQUIVO_SESSAO));
    }
    let Some(p) = local else { return };
    let arq = p.join(ARQUIVO_SESSAO);
    if cookie.is_empty() {
        let _ = std::fs::remove_file(arq);
        return;
    }
    if let Some(dados) = crate::cofre::proteger(cookie.as_bytes()) {
        let _ = std::fs::create_dir_all(p);
        let _ = std::fs::write(arq, dados);
    }
}

/// Le o login do LOCALAPPDATA. Se so existir o arquivo antigo (APPDATA, versoes anteriores), migra: grava no
/// lugar novo e apaga o antigo.
fn ler_sessao_de(local: &Path, antiga: Option<&Path>) -> Option<String> {
    if let Ok(dados) = std::fs::read(local.join(ARQUIVO_SESSAO)) {
        return String::from_utf8(crate::cofre::abrir(&dados)?).ok();
    }
    let velho = antiga?.join(ARQUIVO_SESSAO);
    let dados = std::fs::read(&velho).ok()?;
    let cookie = crate::cofre::abrir(&dados).and_then(|b| String::from_utf8(b).ok());
    match &cookie {
        Some(c) => {
            guardar_sessao_em(Some(local), None, c);
            let _ = std::fs::remove_file(&velho);
        }
        // arquivo velho ilegivel (outro usuario/computador): nao serve mais
        None => {
            let _ = std::fs::remove_file(&velho);
        }
    }
    cookie
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn config_antiga_continua_valida_e_notifica_por_padrao() {
        let c: Config = serde_json::from_str(r#"{"servidor":"https://x","certificado":null}"#).unwrap();
        assert!(!c.sem_notificacoes && !c.sem_som);
        let c = Config { sem_som: true, ..Default::default() };
        let volta: Config = serde_json::from_str(&serde_json::to_string(&c).unwrap()).unwrap();
        assert!(volta.sem_som && !volta.sem_notificacoes);
    }

    #[test]
    fn config_antiga_sem_chave_publica_continua_valida() {
        let c: Config = serde_json::from_str(r#"{"servidor":"https://x","certificado":"AA:BB"}"#).unwrap();
        assert_eq!(c.certificado.as_deref(), Some("AA:BB"));
        assert!(c.chave_publica.is_none());
        let c = Config { chave_publica: Some("CC:DD".into()), ..c };
        let volta: Config = serde_json::from_str(&serde_json::to_string(&c).unwrap()).unwrap();
        assert_eq!(volta.chave_publica.as_deref(), Some("CC:DD"));
        assert_eq!(volta.certificado.as_deref(), Some("AA:BB"));
    }

    fn pasta_de_teste(nome: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("zaphub-cfg-{nome}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        p
    }

    #[test]
    fn sessao_vai_para_o_local_e_o_antigo_e_migrado() {
        let base = pasta_de_teste("migra");
        let (local, roaming) = (base.join("local"), base.join("roaming"));
        std::fs::create_dir_all(&roaming).unwrap();
        // arquivo antigo, no APPDATA
        std::fs::write(roaming.join(ARQUIVO_SESSAO), crate::cofre::proteger(b"cookie-antigo").unwrap()).unwrap();
        assert!(!local.join(ARQUIVO_SESSAO).exists());

        assert_eq!(ler_sessao_de(&local, Some(&roaming)).as_deref(), Some("cookie-antigo"));
        assert!(local.join(ARQUIVO_SESSAO).exists(), "migrou para o LOCALAPPDATA");
        assert!(!roaming.join(ARQUIVO_SESSAO).exists(), "apagou o antigo");
        assert_eq!(ler_sessao_de(&local, Some(&roaming)).as_deref(), Some("cookie-antigo"));

        // guardar de novo nao deixa copia no APPDATA; vazio apaga os dois
        std::fs::write(roaming.join(ARQUIVO_SESSAO), b"qualquer").unwrap();
        guardar_sessao_em(Some(&local), Some(&roaming), "cookie-novo");
        assert!(!roaming.join(ARQUIVO_SESSAO).exists());
        assert_eq!(ler_sessao_de(&local, Some(&roaming)).as_deref(), Some("cookie-novo"));
        guardar_sessao_em(Some(&local), Some(&roaming), "");
        assert!(ler_sessao_de(&local, Some(&roaming)).is_none());
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn sessao_antiga_ilegivel_e_descartada() {
        let base = pasta_de_teste("lixo");
        let (local, roaming) = (base.join("local"), base.join("roaming"));
        std::fs::create_dir_all(&roaming).unwrap();
        std::fs::write(roaming.join(ARQUIVO_SESSAO), b"nao e dpapi").unwrap();
        assert!(ler_sessao_de(&local, Some(&roaming)).is_none());
        assert!(!roaming.join(ARQUIVO_SESSAO).exists());
        let _ = std::fs::remove_dir_all(base);
    }
}
