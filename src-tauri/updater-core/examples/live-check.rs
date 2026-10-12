//! Проверка разбора живого ответа GitHub Releases:
//!   cargo run -p updater-core --example live-check -- <путь к json>
//! JSON: curl -sS https://api.github.com/repos/danku13/TACG/releases/latest
fn main() {
    let path = std::env::args().nth(1).expect("аргумент: путь к json-файлу");
    let json = std::fs::read_to_string(&path).expect("не прочитан файл");
    match updater_core::extract_release(&json) {
        Ok(rel) => {
            let notes = rel.notes.as_deref().map(|n| &n[..n.len().min(60).max(n.len().min(60))]);
            println!("OK: version={} tag={} size={:?}", rel.version, rel.tag, rel.asset_size);
            println!("    asset={}", rel.asset_url);
            println!("    html={:?} notes={:?}", rel.html_url, notes);
            println!("    is_newer(0.10.1)={}", updater_core::is_newer(&rel.version, "0.10.1"));
        }
        Err(e) => {
            println!("ERR: {e}");
            std::process::exit(1);
        }
    }
}
