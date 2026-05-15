// Font loading from --font-path arg

#[allow(dead_code)]
pub fn load_font_system(font_path: Option<&str>) -> cosmic_text::FontSystem {
    let mut fs = cosmic_text::FontSystem::new();
    if let Some(path) = font_path {
        if let Ok(data) = std::fs::read(path) {
            fs.db_mut().load_font_data(data);
        } else {
            eprintln!("WARNING: could not load font from {path}, using system fallback");
        }
    }
    fs
}
