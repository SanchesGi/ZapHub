//! Endereco do servidor ZapHub: so https (http apenas no proprio computador), sem usuario/senha na URL.

/// Devolve a origem normalizada (ex.: "https://192.168.0.10:3443") ou uma mensagem de erro para a tela.
pub fn validar(entrada: &str) -> Result<String, String> {
    let mut texto = entrada.trim().to_string();
    if texto.is_empty() {
        return Err("Informe o endereço do servidor.".into());
    }
    if !texto.contains("://") {
        texto = format!("https://{texto}");
    }
    let u = url::Url::parse(&texto).map_err(|_| "Endereço inválido. Exemplo: https://192.168.0.10:3443".to_string())?;
    let local = matches!(u.host_str(), Some("localhost") | Some("127.0.0.1") | Some("[::1]"));
    let esquema_ok = u.scheme() == "https" || (u.scheme() == "http" && local);
    if !esquema_ok {
        return Err("Use https:// (o painel guarda conversas; sem HTTPS elas trafegariam abertas na rede).".into());
    }
    if !u.username().is_empty() || u.password().is_some() {
        return Err("Não coloque usuário ou senha no endereço.".into());
    }
    if u.host_str().is_none() {
        return Err("Endereço inválido. Exemplo: https://192.168.0.10:3443".into());
    }
    Ok(u.origin().ascii_serialization())
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn aceita_https_e_completa_o_esquema() {
        assert_eq!(validar("192.168.0.10:3443").unwrap(), "https://192.168.0.10:3443");
        assert_eq!(validar("https://zap.empresa.com/dashboard").unwrap(), "https://zap.empresa.com");
        assert_eq!(validar("  https://zap.empresa.com:443  ").unwrap(), "https://zap.empresa.com");
    }

    #[test]
    fn http_so_no_proprio_computador() {
        assert_eq!(validar("http://localhost:3100").unwrap(), "http://localhost:3100");
        assert!(validar("http://192.168.0.10:3030").is_err());
    }

    #[test]
    fn recusa_o_resto() {
        assert!(validar("").is_err());
        assert!(validar("https://usuario:senha@x.com").is_err());
        assert!(validar("file:///C:/Windows").is_err());
        assert!(validar("javascript:alert(1)").is_err());
        assert!(validar("ftp://x.com").is_err());
    }

}
