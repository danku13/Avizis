//! Автообновление TACG по GitHub Releases (ADR-021) — Tauri-слой.
//!
//! Механизм: `releases/latest` (GitHub API) → сравнение версий → скачивание
//! портативного zip с прогрессом → распаковка и подмена файлов рядом с exe
//! (ядро `updater-core::fs`: движок → прочее → оболочка последней) → запуск
//! нового exe → выход. Один код-путь для установленной (NSIS) и портативной
//! версии: приложение в обоих случаях — `tacg.exe` + `tacg-engine.exe` в
//! одном каталоге, а данные (история, ключи LLM) живут в каталоге ОС и
//! обновлением не трогаются.
//!
//! Отказ от `tauri-plugin-updater` осознан (см. ADR-021): он требует подписи
//! minisign-ключом (хранение секрета в CI) и рассчитан на установщик, а не на
//! portable-сценарий. Целостность здесь обеспечивает HTTPS GitHub + сверка
//! размера ассета с метаданными релиза.

use std::fs::{self, File};
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use updater_core::{self, ReleaseInfo};

use crate::EngineHandle;

// Файловые операции и уборка бэкапов — в тестируемом ядре
pub use updater_core::fs::cleanup_backups;

/// User-Agent обязателен для GitHub API; содержит версию оболочки
const USER_AGENT: &str = concat!("TACG-Desktop-Updater/", env!("CARGO_PKG_VERSION"));
/// Квант прогресса скачивания в байтах: частые события захламляют IPC
const PROGRESS_EVERY: u64 = 512 * 1024;
/// Защита от повторного параллельного применения обновления
static UPDATING: AtomicBool = AtomicBool::new(false);

/// Результат проверки обновлений. Ошибки — в поле `error` (не исключением):
/// тихая авто-проверка при старте не должна ронять консоль промисами.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    pub current: String,
    pub latest: Option<String>,
    pub notes: Option<String>,
    pub url: Option<String>,
    pub size: Option<u64>,
    pub has_update: bool,
    pub error: Option<String>,
}

/// Событие прогресса применения (`update:progress` → слушатель в UI)
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressPayload {
    stage: &'static str,
    received: u64,
    total: u64,
}

fn emit(app: &AppHandle, stage: &'static str, received: u64, total: u64) -> Result<(), String> {
    app.emit("update:progress", ProgressPayload { stage, received, total })
        .map_err(|e| format!("не отправлено событие прогресса: {e}"))
}

/// Запрос `releases/latest` и разбор (без аутентификации — репозиторий публичный)
async fn fetch_release() -> Result<ReleaseInfo, String> {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| format!("не создан HTTP-клиент: {e}"))?;
    let resp = client
        .get(updater_core::RELEASES_LATEST_URL)
        .send()
        .await
        .map_err(|e| format!("GitHub API недоступен: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("GitHub API ответил HTTP {}", resp.status()));
    }
    let text = resp
        .text()
        .await
        .map_err(|e| format!("не прочитан ответ GitHub: {e}"))?;
    updater_core::extract_release(&text)
}

/// Проверка обновлений: текущая версия против последнего релиза.
/// Вызывается тихо при старте и по кнопке в футере.
#[tauri::command]
pub async fn check_updates(app: AppHandle) -> UpdateCheck {
    let current = app.package_info().version.to_string();
    match fetch_release().await {
        Ok(rel) => {
            let has_update = updater_core::is_newer(&rel.version, &current);
            UpdateCheck {
                current,
                latest: Some(rel.version),
                notes: rel.notes,
                url: rel.html_url,
                size: rel.asset_size,
                has_update,
                error: None,
            }
        }
        Err(e) => UpdateCheck {
            current,
            latest: None,
            notes: None,
            url: None,
            size: None,
            has_update: false,
            error: Some(e),
        },
    }
}

/// Применение обновления (кнопка «Обновить» в UI). При ошибке до подмены
/// файлов приложение остаётся полностью рабочим; при частичной подмене
/// помогает перезапуск — на месте уже лежат согласованные новые файлы
/// (движок подменяется раньше оболочки, см. `updater_core::plan_files`).
#[tauri::command]
pub async fn apply_update(app: AppHandle) -> Result<(), String> {
    if UPDATING.swap(true, Ordering::SeqCst) {
        return Err("обновление уже выполняется".into());
    }
    let result = install_update(&app).await;
    // Успех завершается exit(0) — флаг не сбрасываем; при ошибке разрешаем повтор
    if result.is_err() {
        UPDATING.store(false, Ordering::SeqCst);
    }
    result
}

async fn install_update(app: &AppHandle) -> Result<(), String> {
    // 1. Свежие метаданные релиза — не полагаемся на результат прошлой проверки
    let rel = fetch_release().await?;
    let current = app.package_info().version.to_string();
    if !updater_core::is_newer(&rel.version, &current) {
        return Err(format!("нет обновления: установлена {current}, последняя {}", rel.version));
    }

    // 2. Скачивание портативного zip во временный каталог с прогрессом
    let tmp_dir = std::env::temp_dir().join("tacg-update");
    let _ = fs::remove_dir_all(&tmp_dir);
    fs::create_dir_all(&tmp_dir).map_err(|e| format!("не создан временный каталог: {e}"))?;
    let zip_path = tmp_dir.join("update.zip");

    emit(app, "download", 0, rel.asset_size.unwrap_or(0))?;

    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| format!("не создан HTTP-клиент: {e}"))?;
    let mut resp = client
        .get(&rel.asset_url)
        .send()
        .await
        .map_err(|e| format!("не начато скачивание: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("ассет обновления ответил HTTP {}", resp.status()));
    }

    let total = rel.asset_size.unwrap_or(0);
    let mut file = File::create(&zip_path).map_err(|e| format!("не создан временный файл: {e}"))?;
    let mut received: u64 = 0;
    let mut last_emit: u64 = 0;
    while let Some(chunk) = resp.chunk().await.map_err(|e| format!("обрыв скачивания: {e}"))? {
        file.write_all(&chunk).map_err(|e| format!("не записан чанк: {e}"))?;
        received += chunk.len() as u64;
        if received - last_emit >= PROGRESS_EVERY || (total > 0 && received == total) {
            emit(app, "download", received, total)?;
            last_emit = received;
        }
    }
    file.flush().map_err(|e| format!("не сброшен буфер файла: {e}"))?;
    drop(file);
    // Целостность: сверяем фактический размер с метаданными релиза
    if let Some(expected) = rel.asset_size {
        if received != expected {
            return Err(format!("размер не совпал: скачано {received}, в релизе {expected} — попробуйте ещё раз"));
        }
    }

    // 3. Распаковка и план подмены (плоские имена, защита от zip-slip — в ядре)
    let names = updater_core::fs::extract_flat(&zip_path, &tmp_dir)?;
    let plan = updater_core::plan_files(&names);
    let present = |want: &str| plan.iter().any(|f| f.eq_ignore_ascii_case(want));
    if !present("tacg.exe") || !present("tacg-engine.exe") {
        return Err("в архиве обновления нет tacg.exe / tacg-engine.exe".into());
    }

    emit(app, "install", received, total)?;

    // 4. Гасим движок: файл сайдкара блокирован, пока его процесс жив
    if let Some(child) = app.state::<EngineHandle>().0.lock().unwrap().take() {
        let _ = child.kill();
    }

    // 5. Подмена файлов в каталоге приложения (оболочка — последней)
    let app_dir = current_exe_dir()?;
    updater_core::fs::perform_swap(&plan, &tmp_dir, &app_dir)?;

    // 6. Перезапуск: новый exe уже на месте; RunEvent::Exit добьёт движок
    //    (уже погашен — хэндл взят выше), старый exe остался как «*.old»
    //    и будет удалён при следующем старте (setup в main.rs).
    emit(app, "relaunch", total, total)?;
    let exe = std::env::current_exe().map_err(|e| format!("не определён путь exe: {e}"))?;
    std::process::Command::new(&exe)
        .spawn()
        .map_err(|e| format!("не запущен обновлённый exe: {e}"))?;
    app.exit(0);
    Ok(())
}

/// Каталог, в котором лежит текущий exe (установленный или портативный)
fn current_exe_dir() -> Result<std::path::PathBuf, String> {
    std::env::current_exe()
        .ok()
        .and_then(|p: std::path::PathBuf| p.parent().map(Path::to_path_buf))
        .ok_or_else(|| "не определён каталог приложения".to_string())
}
