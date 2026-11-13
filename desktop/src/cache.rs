//! Cache em memoria com teto em BYTES e despejo do menos recente (LRU). Usado pelas miniaturas das fotos das
//! mensagens e pelas fotos de perfil. Nunca limpa tudo de uma vez: quando passa do teto, tira o mais antigo
//! (as entradas "descartaveis", como a marca "esta pessoa nao tem foto", saem primeiro).

use std::cell::Cell;
use std::collections::HashMap;

struct Entrada<V> {
    valor: V,
    bytes: usize,
    tique: Cell<u64>,
    descartavel: bool,
}

pub struct Lru<V> {
    mapa: HashMap<String, Entrada<V>>,
    total: usize,
    teto: usize,
    tique: Cell<u64>,
}

impl<V> Default for Lru<V> {
    /// 64 MB; quem precisa de outro teto usa `novo`.
    fn default() -> Self {
        Lru::novo(64 * 1024 * 1024)
    }
}

impl<V> Lru<V> {
    pub fn novo(teto_bytes: usize) -> Self {
        Lru { mapa: HashMap::new(), total: 0, teto: teto_bytes, tique: Cell::new(0) }
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.mapa.len()
    }

    #[cfg(test)]
    pub fn bytes(&self) -> usize {
        self.total
    }

    /// Existe, sem contar como uso.
    pub fn contem(&self, k: &str) -> bool {
        self.mapa.contains_key(k)
    }

    /// Consulta sem mexer na ordem de uso.
    pub fn espiar(&self, k: &str) -> Option<&V> {
        self.mapa.get(k).map(|e| &e.valor)
    }

    /// Consulta e marca como usado agora (o mais recente).
    pub fn obter(&self, k: &str) -> Option<&V> {
        self.mapa.get(k).map(|e| {
            self.tique.set(self.tique.get() + 1);
            e.tique.set(self.tique.get());
            &e.valor
        })
    }

    /// Guarda (ou troca) uma entrada e despeja o que passar do teto. Devolve as chaves despejadas.
    /// A entrada recem-guardada nunca e despejada na mesma chamada.
    pub fn inserir(&mut self, k: String, valor: V, bytes: usize, descartavel: bool) -> Vec<String> {
        self.tique.set(self.tique.get() + 1);
        if let Some(velha) = self.mapa.insert(k.clone(), Entrada { valor, bytes, tique: Cell::new(self.tique.get()), descartavel }) {
            self.total = self.total.saturating_sub(velha.bytes);
        }
        self.total += bytes;
        let mut fora = Vec::new();
        while self.total > self.teto && self.mapa.len() > 1 {
            let Some(vitima) = self.vitima(&k) else { break };
            if let Some(e) = self.mapa.remove(&vitima) {
                self.total = self.total.saturating_sub(e.bytes);
            }
            fora.push(vitima);
        }
        fora
    }

    #[cfg(test)]
    pub fn remover(&mut self, k: &str) -> Option<V> {
        let e = self.mapa.remove(k)?;
        self.total = self.total.saturating_sub(e.bytes);
        Some(e.valor)
    }

    #[cfg(test)]
    pub fn limpar(&mut self) {
        self.mapa.clear();
        self.total = 0;
    }

    /// Quem sai primeiro: o descartavel mais antigo; sem descartaveis, o mais antigo de todos. Nunca a protegida.
    fn vitima(&self, protegida: &str) -> Option<String> {
        self.mapa
            .iter()
            .filter(|(k, _)| k.as_str() != protegida)
            .min_by_key(|(_, e)| (!e.descartavel, e.tique.get()))
            .map(|(k, _)| k.clone())
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn despeja_o_menos_recente_quando_passa_do_teto() {
        let mut c: Lru<u8> = Lru::novo(100);
        assert!(c.inserir("a".into(), 1, 40, false).is_empty());
        assert!(c.inserir("b".into(), 2, 40, false).is_empty());
        let fora = c.inserir("c".into(), 3, 40, false);
        assert_eq!(fora, vec!["a".to_string()], "a e o mais antigo");
        assert!(!c.contem("a") && c.contem("b") && c.contem("c"));
        assert_eq!(c.bytes(), 80);
    }

    #[test]
    fn usar_uma_entrada_a_poupa_do_despejo() {
        let mut c: Lru<u8> = Lru::novo(100);
        c.inserir("a".into(), 1, 40, false);
        c.inserir("b".into(), 2, 40, false);
        assert_eq!(c.obter("a"), Some(&1));
        let fora = c.inserir("c".into(), 3, 40, false);
        assert_eq!(fora, vec!["b".to_string()], "a foi usada depois de b");
        // espiar nao conta como uso
        assert_eq!(c.espiar("a"), Some(&1));
    }

    #[test]
    fn descartaveis_saem_primeiro_mesmo_sendo_mais_novos() {
        let mut c: Lru<u8> = Lru::novo(100);
        c.inserir("foto".into(), 1, 60, false);
        c.inserir("sem-foto".into(), 2, 10, true);
        let fora = c.inserir("outra".into(), 3, 60, false);
        assert_eq!(fora.first().map(String::as_str), Some("sem-foto"));
        assert!(c.contem("foto") || c.contem("outra"));
        assert!(c.bytes() <= 120);
    }

    #[test]
    fn nunca_despeja_a_recem_guardada_nem_limpa_tudo() {
        let mut c: Lru<u8> = Lru::novo(50);
        let fora = c.inserir("grande".into(), 1, 500, false);
        assert!(fora.is_empty());
        assert_eq!(c.len(), 1, "uma entrada maior que o teto fica sozinha");
        c.inserir("b".into(), 2, 10, false);
        assert!(c.contem("b") && !c.contem("grande"));
        for i in 0..100 {
            c.inserir(format!("k{i}"), 0, 10, false);
        }
        assert!(c.bytes() <= 50 && c.len() >= 4, "continua guardando as mais recentes: {}", c.len());
    }

    #[test]
    fn trocar_o_valor_acerta_a_conta_de_bytes() {
        let mut c: Lru<u8> = Lru::novo(100);
        c.inserir("a".into(), 1, 30, false);
        c.inserir("a".into(), 2, 50, false);
        assert_eq!(c.len(), 1);
        assert_eq!(c.bytes(), 50);
        assert_eq!(c.remover("a"), Some(2));
        assert_eq!(c.bytes(), 0);
        assert!(c.remover("a").is_none());
        c.inserir("x".into(), 1, 5, false);
        c.limpar();
        assert_eq!((c.len(), c.bytes()), (0, 0));
    }
}
