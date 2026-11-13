//! DPAPI do Windows: criptografa com a chave do usuario logado. Outro usuario (ou outro computador) nao abre.

use windows_sys::Win32::Foundation::LocalFree;
use windows_sys::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB};

// entropia fixa do programa: outro programa do mesmo usuario precisa saber dela para abrir com o DPAPI
const ENTROPIA: &[u8] = b"ZapHub/desktop/sessao/v1";

fn blob(d: &[u8]) -> CRYPT_INTEGER_BLOB {
    CRYPT_INTEGER_BLOB { cbData: d.len() as u32, pbData: d.as_ptr() as *mut u8 }
}

fn chamar(entrada: &[u8], cifrar: bool) -> Option<Vec<u8>> {
    let dentro = blob(entrada);
    let entropia = blob(ENTROPIA);
    let mut fora = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
    // SAFETY: os blobs apontam para fatias vivas durante a chamada; a saida e alocada pelo Windows e liberada com LocalFree.
    let ok = unsafe {
        if cifrar {
            CryptProtectData(&dentro, std::ptr::null(), &entropia, std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut fora)
        } else {
            CryptUnprotectData(&dentro, std::ptr::null_mut(), &entropia, std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut fora)
        }
    };
    if ok == 0 || fora.pbData.is_null() {
        return None;
    }
    // SAFETY: o Windows devolveu cbData bytes validos em pbData.
    let v = unsafe { std::slice::from_raw_parts(fora.pbData, fora.cbData as usize).to_vec() };
    unsafe { LocalFree(fora.pbData as _) };
    Some(v)
}

pub fn proteger(dados: &[u8]) -> Option<Vec<u8>> {
    chamar(dados, true)
}

pub fn abrir(dados: &[u8]) -> Option<Vec<u8>> {
    chamar(dados, false)
}

#[cfg(test)]
mod testes {
    #[test]
    fn ida_e_volta() {
        let c = super::proteger(b"segredo").unwrap();
        assert_ne!(c, b"segredo");
        assert_eq!(super::abrir(&c).unwrap(), b"segredo");
        assert!(super::abrir(b"lixo").is_none());
    }
}
