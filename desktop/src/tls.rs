//! Certificado do servidor: faz a conexao TLS so para ler o certificado e calcular a impressao digital (SHA-256)
//! do certificado e da CHAVE PUBLICA (SubjectPublicKeyInfo). A fixacao vale pela chave publica: renovar o
//! certificado mantendo a chave nao pede nova confirmacao; trocar a chave pede. Configuracoes antigas, que so
//! guardaram a impressao do certificado, continuam valendo ate serem confirmadas de novo. A assinatura do
//! handshake continua sendo verificada com a chave do proprio certificado, entao quem responde tem a chave privada.

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::CryptoProvider;
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{ClientConfig, ClientConnection, DigitallySignedStruct, SignatureScheme};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Debug, Clone, Serialize)]
pub struct Certificado {
    /// SHA-256 do certificado, em hexadecimal com dois-pontos (AB:CD:...)
    pub impressao: String,
    /// SHA-256 da chave publica do certificado (o que a fixacao compara)
    pub chave_publica: Option<String>,
    pub titular: String,
    pub emissor: String,
    pub valido_ate: String,
}

#[derive(Debug)]
struct Gravar {
    cert: Mutex<Option<Vec<u8>>>,
    provedor: Arc<CryptoProvider>,
}

impl ServerCertVerifier for Gravar {
    fn verify_server_cert(
        &self,
        fim: &CertificateDer<'_>,
        _intermediarios: &[CertificateDer<'_>],
        _nome: &ServerName<'_>,
        _ocsp: &[u8],
        _agora: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        *self.cert.lock().expect("trava do certificado") = Some(fim.to_vec());
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(&self, msg: &[u8], cert: &CertificateDer<'_>, dss: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(msg, cert, dss, &self.provedor.signature_verification_algorithms)
    }

    fn verify_tls13_signature(&self, msg: &[u8], cert: &CertificateDer<'_>, dss: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(msg, cert, dss, &self.provedor.signature_verification_algorithms)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provedor.signature_verification_algorithms.supported_schemes()
    }
}

/// O que o usuario confirmou sobre a identidade do servidor.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Fixacao {
    /// SHA-256 da chave publica (preferida)
    pub chave_publica: Option<String>,
    /// SHA-256 do certificado (formato antigo; so vale quando nao ha chave publica guardada)
    pub certificado: Option<String>,
}

impl Fixacao {
    pub fn de_config(cfg: &crate::config::Config) -> Self {
        Fixacao { chave_publica: cfg.chave_publica.clone(), certificado: cfg.certificado.clone() }
    }

    /// Ha alguma identidade confirmada?
    pub fn vazia(&self) -> bool {
        self.chave_publica.is_none() && self.certificado.is_none()
    }

    /// O certificado apresentado (DER) e o confirmado?
    pub fn aceita(&self, der: &[u8]) -> bool {
        self.confere(&impressao_de(der), chave_publica_de(der).as_deref())
    }

    /// Mesma regra a partir das impressoes ja calculadas.
    pub fn confere(&self, impressao: &str, chave_publica: Option<&str>) -> bool {
        match &self.chave_publica {
            Some(guardada) => chave_publica == Some(guardada.as_str()),
            None => self.certificado.as_deref() == Some(impressao),
        }
    }
}

/// Fixacao: so aceita o servidor cuja identidade foi confirmada pelo usuario. Qualquer outro (mesmo
/// assinado por uma autoridade) derruba a conexao: ninguem no meio do caminho consegue se passar pelo servidor.
#[derive(Debug)]
struct Fixado {
    fixacao: Fixacao,
    provedor: Arc<CryptoProvider>,
}

impl ServerCertVerifier for Fixado {
    fn verify_server_cert(
        &self,
        fim: &CertificateDer<'_>,
        _intermediarios: &[CertificateDer<'_>],
        _nome: &ServerName<'_>,
        _ocsp: &[u8],
        _agora: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        if self.fixacao.aceita(fim) {
            Ok(ServerCertVerified::assertion())
        } else {
            Err(rustls::Error::General(ERRO_CERTIFICADO.into()))
        }
    }

    fn verify_tls12_signature(&self, msg: &[u8], cert: &CertificateDer<'_>, dss: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(msg, cert, dss, &self.provedor.signature_verification_algorithms)
    }

    fn verify_tls13_signature(&self, msg: &[u8], cert: &CertificateDer<'_>, dss: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(msg, cert, dss, &self.provedor.signature_verification_algorithms)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provedor.signature_verification_algorithms.supported_schemes()
    }
}

pub const ERRO_CERTIFICADO: &str = "certificado-diferente";

/// Configuracao TLS que so conversa com o servidor da identidade confirmada.
pub fn config_fixada(fixacao: &Fixacao) -> Result<ClientConfig, String> {
    let provedor = Arc::new(rustls::crypto::ring::default_provider());
    let mut cfg = ClientConfig::builder_with_provider(provedor.clone())
        .with_safe_default_protocol_versions()
        .map_err(|e| format!("TLS: {e}"))?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(Fixado { fixacao: fixacao.clone(), provedor }))
        .with_no_client_auth();
    cfg.alpn_protocols = vec![b"http/1.1".to_vec()];
    Ok(cfg)
}

fn hex_com_dois_pontos(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02X}")).collect::<Vec<_>>().join(":")
}

pub fn impressao_de(der: &[u8]) -> String {
    hex_com_dois_pontos(&Sha256::digest(der))
}

/// SHA-256 do SubjectPublicKeyInfo (a chave publica) do certificado, no mesmo formato da impressao.
pub fn chave_publica_de(der: &[u8]) -> Option<String> {
    let (_, cert) = x509_parser::parse_x509_certificate(der).ok()?;
    Some(hex_com_dois_pontos(&Sha256::digest(cert.tbs_certificate.subject_pki.raw)))
}

/// Os quatro primeiros pares da impressao ("AB:CD:EF:01"): o que a pessoa digita para confirmar uma identidade
/// que mudou.
pub fn prefixo_confirmacao(impressao: &str) -> String {
    impressao.split(':').take(4).collect::<Vec<_>>().join(":")
}

/// O que a pessoa digitou confere com os quatro primeiros pares da impressao? Aceita maiusculas ou minusculas e
/// separadores (espaco, dois-pontos, hifen); qualquer outro caractere recusa.
pub fn confirmacao_ok(digitado: &str, impressao: &str) -> bool {
    if digitado.chars().any(|c| !(c.is_ascii_hexdigit() || c == ':' || c == '-' || c.is_whitespace())) {
        return false;
    }
    let normal = |s: &str| s.chars().filter(char::is_ascii_hexdigit).collect::<String>().to_ascii_uppercase();
    let esperado = normal(&prefixo_confirmacao(impressao));
    !esperado.is_empty() && normal(digitado).starts_with(&esperado)
}

/// Conecta (ate 10 s) e devolve o certificado que o servidor apresenta.
pub fn ler(origem: &str) -> Result<Certificado, String> {
    let u = url::Url::parse(origem).map_err(|_| "Endereço inválido.".to_string())?;
    let host = match u.host() {
        Some(url::Host::Domain(d)) => d.to_string(),
        Some(url::Host::Ipv4(ip)) => ip.to_string(),
        Some(url::Host::Ipv6(ip)) => ip.to_string(),
        None => return Err("Endereço sem servidor.".into()),
    };
    let porta = u.port_or_known_default().unwrap_or(443);

    let provedor = Arc::new(rustls::crypto::ring::default_provider());
    let verificador = Arc::new(Gravar { cert: Mutex::new(None), provedor: provedor.clone() });
    let cfg = ClientConfig::builder_with_provider(provedor)
        .with_safe_default_protocol_versions()
        .map_err(|e| format!("TLS: {e}"))?
        .dangerous()
        .with_custom_certificate_verifier(verificador.clone())
        .with_no_client_auth();
    let nome = ServerName::try_from(host.clone()).map_err(|_| "Nome do servidor inválido.".to_string())?;
    let mut conexao = ClientConnection::new(Arc::new(cfg), nome).map_err(|e| format!("TLS: {e}"))?;

    let destino = (host.as_str(), porta)
        .to_socket_addrs()
        .map_err(|e| format!("Não encontrei o servidor ({e})."))?
        .next()
        .ok_or_else(|| "Não encontrei o servidor.".to_string())?;
    let mut tcp = TcpStream::connect_timeout(&destino, Duration::from_secs(10)).map_err(|e| format!("Não consegui conectar ({e})."))?;
    tcp.set_read_timeout(Some(Duration::from_secs(10))).ok();
    tcp.set_write_timeout(Some(Duration::from_secs(10))).ok();
    while conexao.is_handshaking() {
        conexao.complete_io(&mut tcp).map_err(|e| format!("Falha na conexão segura ({e})."))?;
    }

    let der = verificador.cert.lock().expect("trava do certificado").take().ok_or_else(|| "O servidor não apresentou certificado.".to_string())?;
    let (titular, emissor, valido_ate) = match x509_parser::parse_x509_certificate(&der) {
        Ok((_, c)) => (
            c.subject().to_string(),
            c.issuer().to_string(),
            c.validity().not_after.to_rfc2822().unwrap_or_default(),
        ),
        Err(_) => (String::new(), String::new(), String::new()),
    };
    Ok(Certificado { impressao: impressao_de(&der), chave_publica: chave_publica_de(&der), titular, emissor, valido_ate })
}


#[cfg(test)]
mod testes {
    use super::*;

    // certificados de teste (P-256, gerados so para estes testes): 1 e 2 tem a MESMA chave (2 e a renovacao do
    // 1, com outro titular e validade); 3 tem outra chave
    const CERT_1: &str = "3082017d30820123a00302010202145b92d7a2fb8302a32174c04b38ce6c781695c71b300a06082a8648ce3d04030230143112301006035504030c097a61702e7465737465301e170d3236313131333039313735335a170d3236313231333039313735335a30143112301006035504030c097a61702e74657374653059301306072a8648ce3d020106082a8648ce3d030107034200040cb9a780c87e2be9e27b94d5252f27b01fd26dd4f7dc06d538a85d2914c644b57bbe8c952cb4362cfcd6779b6fc55594ae12dd0b134ca7180ab52ee165bad038a3533051301d0603551d0e041604143b17315caf54a375867944a51aad78e4a3a5efeb301f0603551d230418301680143b17315caf54a375867944a51aad78e4a3a5efeb300f0603551d130101ff040530030101ff300a06082a8648ce3d0403020348003045022100ff18d346878e93f199fba7e58fd978ec9a62093de89771e9daf328614ced9a18022030a28d7a0153356c3ae78b5e5b5a1d20d6f0624db993cc7ef5a95b39d2aeb245";
    const CERT_2: &str = "3082018f30820135a00302010202145a068be2f67c0f239ea675b5e05d549a239fe770300a06082a8648ce3d040302301d311b301906035504030c127a61702e74657374652e72656e6f7661646f301e170d3236313131333039313735335a170d3237303231313039313735335a301d311b301906035504030c127a61702e74657374652e72656e6f7661646f3059301306072a8648ce3d020106082a8648ce3d030107034200040cb9a780c87e2be9e27b94d5252f27b01fd26dd4f7dc06d538a85d2914c644b57bbe8c952cb4362cfcd6779b6fc55594ae12dd0b134ca7180ab52ee165bad038a3533051301d0603551d0e041604143b17315caf54a375867944a51aad78e4a3a5efeb301f0603551d230418301680143b17315caf54a375867944a51aad78e4a3a5efeb300f0603551d130101ff040530030101ff300a06082a8648ce3d0403020348003045022100ebd33aa985c1e2ff0e81d89a5ba5b6edbfc230ea216919c530e236b35148104702202603c024d6860c4adc90a172f06aa6b723f81f6f642823b00942b707c78b926a";
    const CERT_3: &str = "3082017d30820123a00302010202140a933b193a776a667d2e8cc336358cd0fc59cf46300a06082a8648ce3d04030230143112301006035504030c097a61702e7465737465301e170d3236313131333039313735335a170d3236313231333039313735335a30143112301006035504030c097a61702e74657374653059301306072a8648ce3d020106082a8648ce3d03010703420004123105034475647d5f6bd953557137f323372f95da79aad4ca9925a7633d54bc2530b598079a4ef78da724e08f10b85f6c551e3cbc20ab8cc2280412402380b5a3533051301d0603551d0e041604141c19c170d18d4c3a5a0bfc8c27ed56f00995df83301f0603551d230418301680141c19c170d18d4c3a5a0bfc8c27ed56f00995df83300f0603551d130101ff040530030101ff300a06082a8648ce3d04030203480030450220116be827f7c9e76a2c0c8a93cb7c08e2f2c6228245b0f163e0dab112f01b6c09022100fcfe6f7977ecbb61e96225234ae135254d92aab41b798b7a20979eced8683e51";
    const CHAVE_1: &str = "D1:30:C2:42:AF:2C:DE:80:1E:85:93:D3:2E:E7:C3:55:8F:D2:BF:9A:F1:D8:68:F3:70:F6:3D:46:62:E0:BC:D8";
    const CHAVE_3: &str = "5D:9E:2D:F0:57:B5:3D:B0:D6:CF:6D:E0:71:A2:9C:39:5C:35:D3:5F:51:F0:84:90:60:17:96:DB:E8:4F:DB:CA";

    fn der(hex: &str) -> Vec<u8> {
        (0..hex.len()).step_by(2).map(|i| u8::from_str_radix(&hex[i..i + 2], 16).expect("hex")).collect()
    }

    #[test]
    fn impressao_em_hex_com_dois_pontos() {
        let f = impressao_de(b"abc");
        assert_eq!(f.len(), 32 * 3 - 1);
        assert!(f.starts_with("BA:78:16:BF"));
    }

    #[test]
    fn chave_publica_bate_com_o_openssl() {
        assert_eq!(chave_publica_de(&der(CERT_1)).as_deref(), Some(CHAVE_1));
        assert_eq!(chave_publica_de(&der(CERT_3)).as_deref(), Some(CHAVE_3));
        assert!(chave_publica_de(b"nao e certificado").is_none());
    }

    #[test]
    fn renovar_o_certificado_com_a_mesma_chave_continua_valendo() {
        let (c1, c2, c3) = (der(CERT_1), der(CERT_2), der(CERT_3));
        assert_ne!(impressao_de(&c1), impressao_de(&c2), "certificados diferentes");
        assert_eq!(chave_publica_de(&c1), chave_publica_de(&c2), "mesma chave");
        let fix = Fixacao { chave_publica: chave_publica_de(&c1), certificado: Some(impressao_de(&c1)) };
        assert!(fix.aceita(&c1));
        assert!(fix.aceita(&c2), "renovacao com a mesma chave");
        assert!(!fix.aceita(&c3), "outra chave");
    }

    #[test]
    fn fixacao_antiga_so_com_o_certificado_continua_valendo() {
        let (c1, c2) = (der(CERT_1), der(CERT_2));
        let antiga = Fixacao { chave_publica: None, certificado: Some(impressao_de(&c1)) };
        assert!(antiga.aceita(&c1));
        assert!(!antiga.aceita(&c2), "sem a chave guardada, vale o certificado inteiro");
        assert!(!Fixacao::default().aceita(&c1), "sem nada confirmado nao aceita");
        assert!(Fixacao::default().vazia() && !antiga.vazia());
    }

    #[test]
    fn digitar_os_quatro_primeiros_pares_libera() {
        let imp = "AB:CD:EF:01:23:45:67:89";
        assert_eq!(prefixo_confirmacao(imp), "AB:CD:EF:01");
        assert!(confirmacao_ok("ab:cd:ef:01", imp));
        assert!(confirmacao_ok("ABCDEF01", imp));
        assert!(confirmacao_ok("  ab cd-ef 01 ", imp));
        assert!(confirmacao_ok("AB:CD:EF:01:23:45", imp), "digitar a mais, certo, nao atrapalha");
        assert!(!confirmacao_ok("AB:CD:EF", imp));
        assert!(!confirmacao_ok("AB:CD:EF:02", imp));
        assert!(!confirmacao_ok("", imp));
        assert!(!confirmacao_ok("xxxx", imp));
        assert!(!confirmacao_ok("ABCDEF01", ""), "sem impressao nao libera");
    }
}
