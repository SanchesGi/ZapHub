//! Audio nativo: gravar pelo microfone (WASAPI via cpal, sem navegador) e ouvir com o reprodutor do Windows
//! (Windows.Media.Playback, que toca o OGG/Opus do WhatsApp). O servidor converte a gravacao para voz do
//! WhatsApp (ogg/opus) como faz com a do painel.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;

/// fio que grava: devolve as amostras e a taxa
type FioGravacao = std::thread::JoinHandle<Result<(Vec<f32>, u32), String>>;

pub struct Gravacao {
    parar: Arc<AtomicBool>,
    /// pico do ultimo pedaco (0..1000), para a barrinha de nivel
    pub nivel: Arc<AtomicU32>,
    fio: Option<FioGravacao>,
}

pub struct Gravado {
    pub wav: Vec<u8>,
    pub segundos: f32,
    /// o microfone nao captou nada (mudo, desligado ou ocupado)
    pub mudo: bool,
}

const MAX_SEGUNDOS: usize = 15 * 60;

impl Gravacao {
    pub fn iniciar() -> Result<Gravacao, String> {
        let parar = Arc::new(AtomicBool::new(false));
        let nivel = Arc::new(AtomicU32::new(0));
        let (p, n) = (parar.clone(), nivel.clone());
        let (pronto_tx, pronto_rx) = std::sync::mpsc::channel::<Result<(), String>>();
        // o stream do cpal nao pode mudar de thread: vive inteiro neste fio
        let fio = std::thread::spawn(move || -> Result<(Vec<f32>, u32), String> {
            let host = cpal::default_host();
            let disp = match host.default_input_device() {
                Some(d) => d,
                None => {
                    let e = "Nenhum microfone encontrado neste computador.".to_string();
                    let _ = pronto_tx.send(Err(e.clone()));
                    return Err(e);
                }
            };
            let cfg = match disp.default_input_config() {
                Ok(c) => c,
                Err(e) => {
                    let e = format!("Não consegui usar o microfone ({e}).");
                    let _ = pronto_tx.send(Err(e.clone()));
                    return Err(e);
                }
            };
            let taxa = cfg.sample_rate().0;
            let canais = cfg.channels().max(1) as usize;
            let amostras = Arc::new(std::sync::Mutex::new(Vec::<f32>::with_capacity(taxa as usize * 60)));
            let (a2, n2) = (amostras.clone(), n.clone());
            let limite = MAX_SEGUNDOS * taxa as usize;
            let receber = move |dados: &[f32]| {
                let mut pico = 0f32;
                let mut v = a2.lock().expect("amostras");
                for quadro in dados.chunks(canais) {
                    let s = quadro.iter().sum::<f32>() / canais as f32;
                    pico = pico.max(s.abs());
                    if v.len() < limite {
                        v.push(s);
                    }
                }
                n2.store((pico.min(1.0) * 1000.0) as u32, Ordering::Relaxed);
            };
            let erro = |e: cpal::StreamError| eprintln!("microfone: {e}");
            let stream = match cfg.sample_format() {
                cpal::SampleFormat::F32 => disp.build_input_stream(&cfg.clone().into(), move |d: &[f32], _: &_| receber(d), erro, None),
                cpal::SampleFormat::I16 => {
                    let r = receber;
                    disp.build_input_stream(&cfg.clone().into(), move |d: &[i16], _: &_| r(&d.iter().map(|&x| x as f32 / 32768.0).collect::<Vec<_>>()), erro, None)
                }
                cpal::SampleFormat::U16 => {
                    let r = receber;
                    disp.build_input_stream(&cfg.clone().into(), move |d: &[u16], _: &_| r(&d.iter().map(|&x| (x as f32 - 32768.0) / 32768.0).collect::<Vec<_>>()), erro, None)
                }
                f => {
                    let e = format!("Formato do microfone não suportado ({f:?}).");
                    let _ = pronto_tx.send(Err(e.clone()));
                    return Err(e);
                }
            };
            let stream = match stream.and_then(|s| s.play().map(|_| s).map_err(|e| cpal::BuildStreamError::BackendSpecific { err: cpal::BackendSpecificError { description: e.to_string() } })) {
                Ok(s) => s,
                Err(e) => {
                    let e = format!("O microfone está ocupado ou bloqueado ({e}). Confira Configurações > Privacidade > Microfone.");
                    let _ = pronto_tx.send(Err(e.clone()));
                    return Err(e);
                }
            };
            let _ = pronto_tx.send(Ok(()));
            while !p.load(Ordering::Relaxed) {
                std::thread::sleep(std::time::Duration::from_millis(30));
            }
            drop(stream);
            let v = std::mem::take(&mut *amostras.lock().expect("amostras"));
            Ok((v, taxa))
        });
        // o microfone pode travar ao abrir (driver): espera no maximo 5 s em vez de prender a tela para sempre
        match pronto_rx.recv_timeout(std::time::Duration::from_secs(5)) {
            Ok(Ok(())) => Ok(Gravacao { parar, nivel, fio: Some(fio) }),
            Ok(Err(e)) => Err(e),
            Err(_) => {
                parar.store(true, Ordering::Relaxed);
                Err("O microfone não respondeu.".into())
            }
        }
    }

    /// Para e devolve o WAV (16 bits, mono). descartar=true joga fora.
    pub fn parar(mut self) -> Result<Gravado, String> {
        self.parar.store(true, Ordering::Relaxed);
        let (amostras, taxa) = self.fio.take().and_then(|f| f.join().ok()).unwrap_or_else(|| Err("Falha na gravação.".into()))?;
        let segundos = amostras.len() as f32 / taxa as f32;
        let pico = amostras.iter().fold(0f32, |m, s| m.max(s.abs()));
        let mut wav = Vec::new();
        {
            let spec = hound::WavSpec { channels: 1, sample_rate: taxa, bits_per_sample: 16, sample_format: hound::SampleFormat::Int };
            let mut w = hound::WavWriter::new(std::io::Cursor::new(&mut wav), spec).map_err(|e| e.to_string())?;
            for s in &amostras {
                w.write_sample((s.clamp(-1.0, 1.0) * 32767.0) as i16).map_err(|e| e.to_string())?;
            }
            w.finalize().map_err(|e| e.to_string())?;
        }
        Ok(Gravado { wav, segundos, mudo: pico < 0.002 })
    }
}

impl Drop for Gravacao {
    fn drop(&mut self) {
        self.parar.store(true, Ordering::Relaxed);
    }
}

// ---------- reproducao (thread da tela) ----------
use windows::Media::Core::MediaSource;
use windows::Media::Playback::{MediaPlaybackState, MediaPlayer};

thread_local! {
    static TOCADOR: std::cell::RefCell<Option<(String, MediaPlayer)>> = const { std::cell::RefCell::new(None) };
}

/// Toca um arquivo local; se ja estava tocando esta mensagem, pausa/continua.
pub fn tocar(id: &str, arquivo: &std::path::Path) -> Result<(), String> {
    TOCADOR.with(|t| {
        let mut t = t.borrow_mut();
        if let Some((atual, p)) = t.as_ref() {
            if atual == id {
                let estado = p.PlaybackSession().and_then(|s| s.PlaybackState()).map_err(|e| e.to_string())?;
                if estado == MediaPlaybackState::Playing {
                    p.Pause().map_err(|e| e.to_string())?;
                } else {
                    p.Play().map_err(|e| e.to_string())?;
                }
                return Ok(());
            }
            let _ = p.Pause();
        }
        let p = MediaPlayer::new().map_err(|e| e.to_string())?;
        let caminho = std::path::absolute(arquivo).map_err(|e| e.to_string())?;
        let uri = windows::Foundation::Uri::CreateUri(&windows::core::HSTRING::from(url::Url::from_file_path(&caminho).map_err(|_| "caminho")?.as_str())).map_err(|e| e.to_string())?;
        p.SetSource(&MediaSource::CreateFromUri(&uri).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        p.Play().map_err(|e| e.to_string())?;
        *t = Some((id.to_string(), p));
        Ok(())
    })
}

pub fn parar_tudo() {
    TOCADOR.with(|t| {
        if let Some((_, p)) = t.borrow_mut().take() {
            let _ = p.Pause();
        }
    });
}

/// (id tocando, tocando agora?, posicao 0..1, texto "0:12 / 0:40")
pub fn situacao() -> Option<(String, bool, f32, String)> {
    TOCADOR.with(|t| {
        let t = t.borrow();
        let (id, p) = t.as_ref()?;
        let s = p.PlaybackSession().ok()?;
        let pos = s.Position().ok()?.Duration as f64 / 1e7;
        let dur = s.NaturalDuration().ok()?.Duration as f64 / 1e7;
        let tocando = s.PlaybackState().ok()? == MediaPlaybackState::Playing;
        let fim = dur > 0.0 && pos >= dur - 0.05;
        let frac = if dur > 0.0 { (pos / dur).clamp(0.0, 1.0) as f32 } else { 0.0 };
        Some((id.clone(), tocando && !fim, frac, format!("{} / {}", mmss(pos), mmss(dur))))
    })
}

pub fn mmss(s: f64) -> String {
    let s = s.max(0.0).round() as u64;
    format!("{}:{:02}", s / 60, s % 60)
}

#[cfg(test)]
mod testes {
    /// Microfone de verdade (precisa de um): cargo test -- --ignored grava_do_microfone --nocapture
    #[test]
    #[ignore]
    fn grava_do_microfone() {
        let g = super::Gravacao::iniciar().expect("microfone");
        std::thread::sleep(std::time::Duration::from_secs(2));
        let r = g.parar().unwrap();
        println!("segundos={:.2} bytes={} mudo={}", r.segundos, r.wav.len(), r.mudo);
        assert!(r.segundos > 1.5);
        assert_eq!(&r.wav[0..4], b"RIFF");
    }

    #[test]
    fn formata_tempo() {
        assert_eq!(super::mmss(0.0), "0:00");
        assert_eq!(super::mmss(65.4), "1:05");
    }
}
