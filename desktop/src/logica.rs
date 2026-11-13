//! Regras puras (sem tela nem rede) da lista de conversas e das mensagens: ordem por data de verdade,
//! mesclar paginas e avisos do tempo real, subir a conversa que recebeu mensagem. Tudo testado.

use crate::api::{Conversa, Mensagem, Ultima};
use chrono::{DateTime, FixedOffset};
use std::cmp::Ordering;

/// Interpreta a data do servidor (ISO 8601 / RFC 3339).
pub fn instante(ts: Option<&str>) -> Option<DateTime<FixedOffset>> {
    DateTime::parse_from_rfc3339(ts?).ok()
}

/// Compara duas datas pelo INSTANTE (nao pelo texto: "…+00:00" e "…Z", milissegundos e fusos diferentes ordenam
/// errado como texto). Sem data vem antes; data ilegivel cai para a comparacao de texto.
pub fn comparar_tempo(a: Option<&str>, b: Option<&str>) -> Ordering {
    match (instante(a), instante(b)) {
        (Some(x), Some(y)) => x.cmp(&y),
        (None, None) => a.cmp(&b),
        (None, Some(_)) => Ordering::Less,
        (Some(_), None) => Ordering::Greater,
    }
}

pub fn ordenar_mensagens(v: &mut [Mensagem]) {
    // sort_by e estavel: mensagens no mesmo instante ficam na ordem em que chegaram
    v.sort_by(|a, b| comparar_tempo(a.timestamp.as_deref(), b.timestamp.as_deref()));
}

/// O aviso do socket nao traz tudo (ex.: nome do atendente): mantem o que ja tinha.
pub fn mesclar(x: &mut Mensagem, n: &Mensagem) {
    let antigo = x.clone();
    *x = n.clone();
    x.sender_name = n.sender_name.clone().or(antigo.sender_name);
    x.sent_by = n.sent_by.clone().or(antigo.sent_by);
    x.media_url = n.media_url.clone().or(antigo.media_url);
    // citacao, reacoes e marcas tambem podem faltar no aviso do socket: mantem o que ja tinha
    x.quoted = n.quoted.clone().or(antigo.quoted);
    if n.reacoes.is_empty() {
        x.reacoes = antigo.reacoes;
    }
    x.extra = crate::acoes::Extra {
        encaminhada: n.extra.encaminhada || antigo.extra.encaminhada,
        editada: n.extra.editada || antigo.extra.editada,
        apagada: n.extra.apagada || antigo.extra.apagada,
    };
}

/// Junta `nova` (uma pagina do servidor ou avisos do socket) em `atual`: o que ja existe e atualizado, o que falta
/// entra, e tudo fica em ordem de data. Devolve true se algo mudou de lugar ou entrou.
pub fn mesclar_mensagens(atual: &mut Vec<Mensagem>, nova: Vec<Mensagem>) -> bool {
    let mut entrou = false;
    for m in nova {
        match atual.iter_mut().find(|x| x.key_id == m.key_id) {
            Some(x) => mesclar(x, &m),
            None => {
                atual.push(m);
                entrou = true;
            }
        }
    }
    ordenar_mensagens(atual);
    entrou
}

/// Pagina carregada do servidor + mensagens que chegaram ao vivo enquanto ela carregava (sem repetir nenhuma).
pub fn juntar_ao_vivo(pagina: Vec<Mensagem>, ao_vivo: Vec<Mensagem>) -> Vec<Mensagem> {
    let mut v = pagina;
    for m in ao_vivo {
        if !v.iter().any(|x| x.key_id == m.key_id) {
            v.push(m);
        }
    }
    ordenar_mensagens(&mut v);
    v
}

fn ts_da_conversa(c: &Conversa) -> Option<&str> {
    c.last_message.as_ref().and_then(|m| m.timestamp.as_deref())
}

/// Atualiza a lista com a primeira pagina recem-baixada SEM perder as paginas que ja estavam carregadas:
/// a pagina nova vem primeiro (na ordem do servidor); as conversas antigas que ficam depois do corte dela
/// (mais antigas que a ultima da pagina) continuam; as mais novas que o corte e nao vieram sumiram no servidor
/// (arquivadas, apagadas) e saem.
pub fn mesclar_conversas(atual: &mut Vec<Conversa>, nova: Vec<Conversa>, pagina_cheia: bool) {
    if !pagina_cheia {
        // a pagina trouxe a lista inteira
        *atual = nova;
        return;
    }
    let corte = nova.last().and_then(ts_da_conversa).map(String::from);
    let mut resto: Vec<Conversa> = std::mem::take(atual)
        .into_iter()
        .filter(|c| !nova.iter().any(|n| n.jid == c.jid))
        .filter(|c| comparar_tempo(ts_da_conversa(c), corte.as_deref()) != Ordering::Greater)
        .collect();
    let mut v = nova;
    v.append(&mut resto);
    *atual = v;
}

/// Chegou/mudou uma mensagem: atualiza a previa da conversa e a sobe para o topo (depois das fixadas).
/// `aberta` = e a conversa aberta na tela (nao soma "nao lida"). Devolve false se a conversa nao esta na lista
/// (conversa nova: quem chama recarrega a lista).
pub fn subir_conversa(conversas: &mut Vec<Conversa>, m: &Mensagem, aberta: bool) -> bool {
    let Some(i) = conversas.iter().position(|c| c.jid == m.remote_jid) else { return false };
    let c = &mut conversas[i];
    let e_a_ultima = c.last_message.as_ref().is_some_and(|u| u.key_id.as_deref() == Some(m.key_id.as_str()));
    let mais_nova = comparar_tempo(m.timestamp.as_deref(), ts_da_conversa(c)) != Ordering::Less;
    if !e_a_ultima && !mais_nova {
        return true; // mensagem antiga mudou (status, reacao...): a previa da lista continua a mesma
    }
    if !e_a_ultima && !m.from_me && m.live && !aberta {
        c.unread += 1;
    }
    c.last_message = Some(Ultima {
        content: m.content.clone(),
        timestamp: m.timestamp.clone(),
        tipo: m.tipo.clone(),
        from_me: m.from_me,
        status: m.status.clone(),
        key_id: Some(m.key_id.clone()),
    });
    if !c.fixada && !e_a_ultima {
        let c = conversas.remove(i);
        let pos = conversas.iter().take_while(|x| x.fixada).count();
        conversas.insert(pos, c);
    }
    true
}

/// Cabe mais um arquivo na soma dos anexos? Soma e teto em bytes.
pub fn cabe_nos_anexos(total_atual: usize, novo: usize, teto: usize) -> bool {
    total_atual.checked_add(novo).is_some_and(|t| t <= teto)
}

#[cfg(test)]
mod testes {
    use super::*;
    use serde_json::json;

    fn msg(id: &str, ts: &str) -> Mensagem {
        serde_json::from_value(json!({ "keyId": id, "remoteJid": "x@s.whatsapp.net", "timestamp": ts, "content": id })).expect("mensagem")
    }

    fn conversa(jid: &str, ts: &str, fixada: bool) -> Conversa {
        serde_json::from_value(json!({
            "jid": jid, "fixada": fixada,
            "lastMessage": { "content": "antes", "timestamp": ts, "type": "TEXT", "fromMe": false, "keyId": format!("k-{jid}") }
        }))
        .expect("conversa")
    }

    fn ids(v: &[Mensagem]) -> Vec<&str> {
        v.iter().map(|m| m.key_id.as_str()).collect()
    }

    fn jids(v: &[Conversa]) -> Vec<&str> {
        v.iter().map(|c| c.jid.as_str()).collect()
    }

    #[test]
    fn ordena_pelo_instante_e_nao_pelo_texto() {
        // como texto, "…+02:00" (10:00 local = 08:00Z) viria depois de "09:00Z"; pelo instante vem antes
        let mut v = vec![msg("a", "2026-01-10T09:00:00Z"), msg("b", "2026-01-10T10:00:00+02:00"), msg("c", "2026-01-10T08:30:00.500Z")];
        ordenar_mensagens(&mut v);
        assert_eq!(ids(&v), vec!["b", "c", "a"]);
        assert_eq!(comparar_tempo(Some("2026-01-10T10:00:00+00:00"), Some("2026-01-10T10:00:00Z")), Ordering::Equal);
        assert_eq!(comparar_tempo(None, Some("2026-01-10T10:00:00Z")), Ordering::Less);
        assert_eq!(comparar_tempo(Some("lixo"), Some("2026-01-10T10:00:00Z")), Ordering::Less);
        assert_eq!(comparar_tempo(None, None), Ordering::Equal);
    }

    #[test]
    fn mesclar_mensagens_atualiza_acrescenta_e_ordena() {
        let mut atual = vec![msg("a", "2026-01-10T10:00:00Z"), msg("c", "2026-01-10T12:00:00Z")];
        atual[0].sent_by = Some("Carla".into());
        let mut nova_a = msg("a", "2026-01-10T10:00:00Z");
        nova_a.status = Some("READ".into());
        let entrou = mesclar_mensagens(&mut atual, vec![nova_a, msg("b", "2026-01-10T11:00:00Z")]);
        assert!(entrou);
        assert_eq!(ids(&atual), vec!["a", "b", "c"]);
        assert_eq!(atual[0].status.as_deref(), Some("READ"));
        assert_eq!(atual[0].sent_by.as_deref(), Some("Carla"), "o que o aviso nao trouxe fica");
        assert!(!mesclar_mensagens(&mut atual, vec![msg("b", "2026-01-10T11:00:00Z")]), "nada novo");
    }

    #[test]
    fn pagina_carregada_nao_perde_o_que_chegou_ao_vivo() {
        let pagina = vec![msg("a", "2026-01-10T10:00:00Z"), msg("b", "2026-01-10T11:00:00Z")];
        let vivas = vec![msg("b", "2026-01-10T11:00:00Z"), msg("c", "2026-01-10T11:30:00Z")];
        let v = juntar_ao_vivo(pagina, vivas);
        assert_eq!(ids(&v), vec!["a", "b", "c"]);
    }

    #[test]
    fn atualizar_a_lista_mantem_as_paginas_rolagem_abaixo() {
        let mut atual = vec![
            conversa("n1", "2026-01-10T12:00:00Z", false),
            conversa("n2", "2026-01-10T11:00:00Z", false),
            conversa("n3", "2026-01-10T10:00:00Z", false),
            conversa("velha", "2026-01-09T10:00:00Z", false),
        ];
        // a 1a pagina agora so tem n3 (mais nova) e n2; n1 sumiu (arquivada); "velha" fica
        let nova = vec![conversa("n3", "2026-01-10T13:00:00Z", false), conversa("n2", "2026-01-10T11:00:00Z", false)];
        mesclar_conversas(&mut atual, nova, true);
        assert_eq!(jids(&atual), vec!["n3", "n2", "velha"]);
        // pagina nao cheia = a lista inteira
        mesclar_conversas(&mut atual, vec![conversa("so", "2026-01-11T10:00:00Z", false)], false);
        assert_eq!(jids(&atual), vec!["so"]);
    }

    #[test]
    fn mensagem_nova_sobe_a_conversa_depois_das_fixadas() {
        let mut c = vec![conversa("fix", "2026-01-01T10:00:00Z", true), conversa("a", "2026-01-10T12:00:00Z", false), conversa("b", "2026-01-10T11:00:00Z", false)];
        let mut m = msg("novo", "2026-01-10T13:00:00Z");
        m.remote_jid = "b".into();
        m.live = true;
        assert!(subir_conversa(&mut c, &m, false));
        assert_eq!(jids(&c), vec!["fix", "b", "a"]);
        assert_eq!(c[1].unread, 1);
        assert_eq!(c[1].last_message.as_ref().and_then(|u| u.key_id.as_deref()), Some("novo"));

        // a conversa aberta nao soma nao lida; fixada sobe so a previa e nao muda de lugar
        let mut m2 = msg("outro", "2026-01-10T14:00:00Z");
        m2.remote_jid = "fix".into();
        m2.live = true;
        assert!(subir_conversa(&mut c, &m2, true));
        assert_eq!(jids(&c), vec!["fix", "b", "a"]);
        assert_eq!(c[0].unread, 0);

        // minha mensagem nunca soma
        let mut m3 = msg("meu", "2026-01-10T15:00:00Z");
        m3.remote_jid = "a".into();
        m3.live = true;
        m3.from_me = true;
        assert!(subir_conversa(&mut c, &m3, false));
        assert_eq!(c[1].jid, "a");
        assert_eq!(c[1].unread, 0);
    }

    #[test]
    fn mensagem_antiga_ou_repetida_nao_mexe_na_ordem_nem_soma() {
        let mut c = vec![conversa("a", "2026-01-10T12:00:00Z", false), conversa("b", "2026-01-10T11:00:00Z", false)];
        // mensagem de ontem mudou de status: previa e ordem ficam
        let mut velha = msg("velha", "2026-01-09T10:00:00Z");
        velha.remote_jid = "b".into();
        velha.live = true;
        assert!(subir_conversa(&mut c, &velha, false));
        assert_eq!(jids(&c), vec!["a", "b"]);
        assert_eq!(c[1].unread, 0);
        assert_eq!(c[1].last_message.as_ref().and_then(|u| u.content.as_deref()), Some("antes"));
        // a propria ultima mensagem mudando de status atualiza a previa sem somar
        let mut ultima = msg("k-b", "2026-01-10T11:00:00Z");
        ultima.remote_jid = "b".into();
        ultima.live = true;
        ultima.status = Some("READ".into());
        assert!(subir_conversa(&mut c, &ultima, false));
        assert_eq!(c[1].unread, 0);
        assert_eq!(c[1].last_message.as_ref().and_then(|u| u.status.as_deref()), Some("READ"));
        // conversa que nao esta na lista: avisa quem chama
        let mut nova = msg("x", "2026-01-10T13:00:00Z");
        nova.remote_jid = "desconhecida".into();
        assert!(!subir_conversa(&mut c, &nova, false));
    }

    #[test]
    fn teto_da_soma_dos_anexos() {
        let mb = 1024 * 1024;
        assert!(cabe_nos_anexos(0, 200 * mb, 200 * mb));
        assert!(cabe_nos_anexos(150 * mb, 50 * mb, 200 * mb));
        assert!(!cabe_nos_anexos(150 * mb, 51 * mb, 200 * mb));
        assert!(!cabe_nos_anexos(usize::MAX, 1, usize::MAX));
    }
}
