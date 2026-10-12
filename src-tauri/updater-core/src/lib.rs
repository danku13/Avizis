//! updater-core — чистая логика автообновления TACG по GitHub Releases (ADR-021).
//!
//! Модуль не зависит от Tauri: сравнение версий, разбор ответа
//! `GET /repos/{owner}/{repo}/releases/latest`, порядок подмены файлов и
//! сами файловые операции (распаковка, подмена, бэкапы). Сеть и IPC живут
//! в `src/updater.rs` десктоп-оболочки; чистота ядра позволяет гонять юнит-
//! и интеграционные тесты на любой платформе (`cargo test -p updater-core`).

pub mod fs;

use serde::Deserialize;

/// Публичный API-эндпоинт последнего релиза. GitHub сам исключает черновики
/// и пререлизы из `releases/latest` — это и есть «стабильный канал» обновлений.
pub const RELEASES_LATEST_URL: &str = "https://api.github.com/repos/danku13/TACG/releases/latest";

/// Имя портативного ассета релиза — источник файлов для автообновления.
/// Один код-путь для установленной (NSIS) и портативной версии: и там и там
/// приложение — это `tacg.exe` + `tacg-engine.exe` в одном каталоге (ADR-021).
pub const PORTABLE_ASSET_NAME: &str = "tacg-portable-windows-x64.zip";

/// Подмножество ответа GitHub, нужное апдейтеру
#[derive(Debug, Clone, Deserialize)]
pub struct GithubRelease {
    pub tag_name: String,
    #[serde(default)]
    pub html_url: Option<String>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub draft: Option<bool>,
    #[serde(default)]
    pub prerelease: Option<bool>,
    #[serde(default)]
    pub assets: Vec<GithubAsset>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GithubAsset {
    pub name: String,
    pub browser_download_url: String,
    #[serde(default)]
    pub size: Option<u64>,
}

/// Минимальные сведения о релизе, достаточные для проверки и применения
#[derive(Debug, Clone, PartialEq)]
pub struct ReleaseInfo {
    /// «0.11.0» — тег без префикса v
    pub version: String,
    /// «v0.11.0» — тег как в GitHub
    pub tag: String,
    /// Публичная страница релиза (для ручного скачивания из UI)
    pub html_url: Option<String>,
    /// Примечания к релизу (тело релиза в GitHub)
    pub notes: Option<String>,
    /// Прямая ссылка на портативный zip
    pub asset_url: String,
    /// Размер zip в байтах — сверка целостности после скачивания
    pub asset_size: Option<u64>,
}

/// «v0.11.0» / «0.10.1-beta» → [0, 11, 0]; нечисловые компоненты → 0.
/// Пререлизная часть после '-'/'+' игнорируется: для канала стабильных
/// релизов «0.11.0-beta» не публикуется как `releases/latest`.
pub fn parse_version(input: &str) -> Vec<u64> {
    let s = input.trim().trim_start_matches(['v', 'V']);
    let core = s.split(['-', '+']).next().unwrap_or("");
    core.split('.')
        .map(|part| part.trim().parse::<u64>().unwrap_or(0))
        .collect()
}

/// true, если `latest` строго больше `current` (покомпонентно; недостающие
/// компоненты короткой версии считаются нулями: «0.11» == «0.11.0»).
pub fn is_newer(latest: &str, current: &str) -> bool {
    let l = parse_version(latest);
    let c = parse_version(current);
    let n = l.len().max(c.len());
    for i in 0..n {
        let a = l.get(i).copied().unwrap_or(0);
        let b = c.get(i).copied().unwrap_or(0);
        if a != b {
            return a > b;
        }
    }
    false
}

/// Разбор JSON ответа GitHub: релиз должен быть опубликован и содержать
/// портативный ассет разумного размера. Ошибки — человекочитаемые строки
/// (они попадают в поле `error` команды `check_updates` и в тосты UI).
pub fn extract_release(json: &str) -> Result<ReleaseInfo, String> {
    let rel: GithubRelease = serde_json::from_str(json)
        .map_err(|e| format!("не удалось разобрать ответ GitHub: {e}"))?;
    if rel.draft.unwrap_or(false) {
        return Err("последний релиз — черновик".into());
    }
    if rel.prerelease.unwrap_or(false) {
        return Err("последний релиз — пререлиз".into());
    }
    if rel.tag_name.trim().is_empty() {
        return Err("у релиза нет тега версии".into());
    }
    let asset = rel
        .assets
        .iter()
        .find(|a| a.name == PORTABLE_ASSET_NAME)
        .ok_or_else(|| format!("в релизе {} нет ассета {PORTABLE_ASSET_NAME}", rel.tag_name))?;
    if let Some(size) = asset.size {
        if size == 0 {
            return Err("ассет обновления пуст (0 байт)".into());
        }
    }
    let tag = rel.tag_name.trim().to_string();
    let version = tag.trim_start_matches(['v', 'V']).to_string();
    Ok(ReleaseInfo {
        version,
        tag,
        html_url: rel.html_url.clone(),
        notes: rel.body.clone(),
        asset_url: asset.browser_download_url.clone(),
        asset_size: asset.size,
    })
}

/// Порядок подмены файлов обновления в каталоге приложения:
///   1) `tacg-engine.exe` — сайдкар движка (уже погашен, файл свободен);
///   2) прочие файлы архива;
///   3) `tacg.exe` — оболочка, которая сейчас выполняется (rename живого
///      exe на Windows разрешён, подмена последней минимизирует окно
///      «полуобновлённого» состояния).
///
/// Принимаются только плоские имена без каталогов и переходов `..`
/// (защита от zip-slip), пустые и `update.zip` отфильтровываются.
pub fn plan_files(names: &[String]) -> Vec<String> {
    let mut files: Vec<String> = names
        .iter()
        .map(|n| n.trim().to_string())
        .filter(|n| {
            !n.is_empty()
                && !n.contains('/')
                && !n.contains('\\')
                && !n.contains("..")
                && n != "update.zip"
        })
        .collect();
    files.sort_by_key(|name| match name.to_ascii_lowercase().as_str() {
        "tacg-engine.exe" => 0,
        "tacg.exe" => 2,
        _ => 1,
    });
    files.dedup();
    files
}

#[cfg(test)]
mod tests {
    use super::*;

    fn release_json(tag: &str, assets: &[(&str, u64)], opts: &str) -> String {
        let assets: Vec<String> = assets
            .iter()
            .map(|(name, size)| {
                format!(
                    r#"{{"name":"{name}","browser_download_url":"https://host/{name}","size":{size}}}"#
                )
            })
            .collect();
        format!(
            r#"{{"tag_name":"{tag}","html_url":"https://github.com/danku13/TACG/releases/tag/{tag}","body":"notes {tag}",{opts}"assets":[{}]}}"#,
            assets.join(",")
        )
    }

    // ─────────────────── parse_version / is_newer ───────────────────

    #[test]
    fn parse_version_variants() {
        assert_eq!(parse_version("v0.11.0"), vec![0, 11, 0]);
        assert_eq!(parse_version("0.10.1"), vec![0, 10, 1]);
        assert_eq!(parse_version("V1.2.3"), vec![1, 2, 3]);
        assert_eq!(parse_version("0.11.0-beta"), vec![0, 11, 0]);
        assert_eq!(parse_version(" 0.11 " ), vec![0, 11]);
        assert_eq!(parse_version("1"), vec![1]);
        assert_eq!(parse_version("abc"), vec![0]);
        assert_eq!(parse_version(""), vec![0]);
    }

    #[test]
    fn newer_in_patch_minor_major() {
        assert!(is_newer("0.11.1", "0.11.0"));
        assert!(is_newer("0.12.0", "0.11.9"));
        assert!(is_newer("1.0.0", "0.99.99"));
        assert!(is_newer("v0.11.0", "0.10.1"));
    }

    #[test]
    fn not_newer_on_equal_or_older() {
        assert!(!is_newer("0.11.0", "0.11.0"));
        assert!(!is_newer("v0.10.1", "0.10.1"));
        assert!(!is_newer("0.10.0", "0.10.1"));
        assert!(!is_newer("0.9.99", "0.10.0"));
    }

    #[test]
    fn shorter_versions_pad_with_zeros() {
        assert!(!is_newer("0.11", "0.11.0")); // эквивалентны
        assert!(is_newer("0.11.1", "0.11"));
        assert!(is_newer("1.2", "1.1.9"));
    }

    // ─────────────────── extract_release ───────────────────

    #[test]
    fn extract_release_ok() {
        let json = release_json("v0.11.0", &[(PORTABLE_ASSET_NAME, 49_973_144)], "");
        let rel = extract_release(&json).expect("релиз должен разбираться");
        assert_eq!(rel.version, "0.11.0");
        assert_eq!(rel.tag, "v0.11.0");
        assert_eq!(rel.html_url.as_deref(), Some("https://github.com/danku13/TACG/releases/tag/v0.11.0"));
        assert_eq!(rel.notes.as_deref(), Some("notes v0.11.0"));
        assert_eq!(rel.asset_url, format!("https://host/{PORTABLE_ASSET_NAME}"));
        assert_eq!(rel.asset_size, Some(49_973_144));
    }

    #[test]
    fn extract_release_rejects_draft_prerelease_and_bad_assets() {
        let draft = release_json("v1.0.0", &[(PORTABLE_ASSET_NAME, 10)], r#""draft":true,"#);
        assert!(extract_release(&draft).unwrap_err().contains("черновик"));

        let pre = release_json("v1.0.0", &[(PORTABLE_ASSET_NAME, 10)], r#""prerelease":true,"#);
        assert!(extract_release(&pre).unwrap_err().contains("пререлиз"));

        let missing = release_json("v1.0.0", &[("other.zip", 10)], "");
        let err = extract_release(&missing).unwrap_err();
        assert!(err.contains(PORTABLE_ASSET_NAME), "ошибка должна называть отсутствующий ассет: {err}");

        let empty = release_json("v1.0.0", &[(PORTABLE_ASSET_NAME, 0)], "");
        assert!(extract_release(&empty).unwrap_err().contains("0 байт"));

        assert!(extract_release("не json").unwrap_err().contains("разобрать"));
    }

    // ─────────────────── plan_files ───────────────────

    #[test]
    fn plan_files_engine_first_shell_last() {
        let names = vec![
            "tacg.exe".to_string(),
            "portable-README.txt".to_string(),
            "tacg-engine.exe".to_string(),
        ];
        assert_eq!(plan_files(&names), vec!["tacg-engine.exe", "portable-README.txt", "tacg.exe"]);
    }

    #[test]
    fn plan_files_filters_zip_slip_and_junk() {
        let names = vec![
            "".to_string(),
            "update.zip".to_string(),
            "../evil.exe".to_string(),
            "dir/payload.exe".to_string(),
            "win\\path.exe".to_string(),
            "  tacg-engine.exe  ".to_string(),
        ];
        assert_eq!(plan_files(&names), vec!["tacg-engine.exe"]);
    }
}
