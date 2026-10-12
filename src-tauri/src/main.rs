// TACG — десктоп-оболочка (Tauri v2, ADR-018).
//
// Архитектура «единый exe с UI»:
//   • UI (статический экспорт Next.js) вшит в бинарник — окно открывается на
//     встроенных активах, без внешнего веб-сервера;
//   • движок агента — sidecar (bun build --compile): запускается процессом
//     оболочки на свободном порту 127.0.0.1, гасится при выходе;
//   • порт передаётся UI через initialization script (window.__TACG_ENGINE_PORT__)
//     до загрузки страницы — socket.io-клиент подключается напрямую;
//   • данные движка — в каталоге приложения ОС (TACG_DATA_DIR), survives
//     переустановки; лог движка — в app_log_dir()/tacg-engine.log.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::OpenOptions;
use std::io::Write;
use std::net::TcpListener;
use std::sync::Mutex;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Хэндл процесса движка: гасим при выходе, чтобы не оставлять сирот
struct EngineHandle(Mutex<Option<CommandChild>>);

/// Свободный порт для движка (занимаем и освобождаем; движок стартует в доли секунды)
fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .expect("не удалось занять порт для движка")
        .local_addr()
        .expect("не удалось определить локальный адрес")
        .port()
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let port = free_port();

            // ── Движок-сайдкар: 127.0.0.1:port, только локально, точные CORS-origin'ы ──
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let log_dir = app.path().app_log_dir()?;
            std::fs::create_dir_all(&log_dir)?;
            let log_path = log_dir.join("tacg-engine.log");

            let (mut rx, child) = app
                .shell()
                .sidecar("tacg-engine")
                .expect("не удалось создать команду сайдкара tacg-engine")
                .env("TACG_PORT", port.to_string())
                .env("TACG_BIND", "127.0.0.1")
                .env("TACG_DATA_DIR", &data_dir)
                .env("TACG_CORS_ORIGINS", "http://tauri.localhost,tauri://localhost")
                .spawn()
                .expect("не удалось запустить движок-сайдкар");
            app.manage(EngineHandle(Mutex::new(Some(child))));

            // Сток stdout/stderr движка в лог (иначе пайп движка переполнится)
            tauri::async_runtime::spawn(async move {
                let mut file = OpenOptions::new().create(true).append(true).open(&log_path).ok();
                while let Some(event) = rx.recv().await {
                    let bytes = match event {
                        CommandEvent::Stdout(b) => b,
                        CommandEvent::Stderr(b) => b,
                        _ => continue,
                    };
                    if let Some(f) = file.as_mut() {
                        let _ = f.write_all(&bytes);
                        let _ = f.write_all(b"\n");
                    }
                }
            });

            // ── Окно: UI вшит в exe, порт движка инъекцируется до загрузки страницы ──
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("TACG — прозрачный граф вычислений агента")
                .inner_size(1360.0, 860.0)
                .min_inner_size(1024.0, 640.0)
                .initialization_script(&format!(
                    "window.__TACG_ENGINE_PORT__ = {};",
                    port
                ))
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("ошибка при запуске TACG")
        .run(|app, event| {
            // Выход из приложения гасит движок — никаких процессов-сирот
            if let tauri::RunEvent::Exit = event {
                if let Some(child) = app.state::<EngineHandle>().0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        });
}
