fn main() {
    let cfg = slint_build::CompilerConfiguration::new().with_style("fluent-dark".into());
    slint_build::compile_with_config("ui/app.slint", cfg).expect("telas do ZapHub");
    // icone e versao no proprio zaphub.exe (Explorer, barra de tarefas, Aplicativos instalados)
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let mut r = winresource::WindowsResource::new();
        r.set_icon("instalador/zaphub.ico")
            .set("ProductName", "ZapHub")
            .set("FileDescription", "ZapHub para Windows")
            .set("CompanyName", "Ailan Sanches")
            .set("LegalCopyright", "AGPL-3.0-only")
            .set_language(0x0416);
        r.compile().expect("recursos do Windows");
    }
}
