//! Файловые операции автообновления (ADR-021): распаковка архива и подмена
//! файлов в каталоге приложения. Живут в ядре, а не в Tauri-оболочке, чтобы
//! интеграционно тестироваться на любой платформе (`cargo test -p updater-core`)
//! — подмена exes одинаково работает для установленной (NSIS) и портативной
//! версии: приложение в обоих случаях — файлы в одном каталоге.

use std::fs::{self, File};
use std::path::{Path, PathBuf};

/// Распаковка архива обновления в `dst_dir`. Возвращает плоский список имён
/// файлов (без каталогов). Сам архив кладут рядом — имя `update.zip` позже
/// отфильтруется `plan_files`. Небезопасные пути (zip-slip) сам крейт zip
/// не извлекает наружу `dst_dir`, а `plan_files` дополнительно их отбрасывает.
pub fn extract_flat(zip_path: &Path, dst_dir: &Path) -> Result<Vec<String>, String> {
    let file = File::open(zip_path).map_err(|e| format!("не открыт архив: {e}"))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("архив повреждён: {e}"))?;
    zip.extract(dst_dir).map_err(|e| format!("не распакован архив: {e}"))?;
    flat_file_names(dst_dir)
}

/// Плоский список файлов каталога (без подкаталогов)
fn flat_file_names(dir: &Path) -> Result<Vec<String>, String> {
    let mut names = Vec::new();
    let entries = fs::read_dir(dir).map_err(|e| format!("не прочитан каталог {dir:?}: {e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            names.push(entry.file_name().to_string_lossy().to_string());
        }
    }
    Ok(names)
}

/// Подмена файлов по плану (см. `plan_files` — движок первым, оболочка
/// последней): для каждого имени текущий файл уходит в бэкап «*.old»,
/// новый занимает его место. Вызывается ПОСЛЕ гашения движка-сайдкара;
/// «*.old» удаляются при следующем старте приложения (`cleanup_backups`).
pub fn perform_swap(plan: &[String], src_dir: &Path, app_dir: &Path) -> Result<(), String> {
    for name in plan {
        swap_file(&src_dir.join(name), &app_dir.join(name))?;
    }
    Ok(())
}

/// Подмена одного файла: текущий → бэкап «*.old» (rename живого exe на
/// Windows разрешён — оболочку подменяем последней, но из живого процесса),
/// новый → на его место.
fn swap_file(src: &Path, dst: &Path) -> Result<(), String> {
    if dst.exists() {
        let backup = backup_path(dst)?;
        let _ = fs::remove_file(&backup);
        if fs::rename(dst, &backup).is_err() {
            // между томами rename может не сработать — копируем и освобождаем
            fs::copy(dst, &backup).map_err(|e| format!("не сохранён бэкап {}: {e}", dst.display()))?;
            fs::remove_file(dst).map_err(|e| format!("не освобождён {}: {e}", dst.display()))?;
        }
    }
    move_file(src, dst)
}

/// Перемещение с фолбэком на копию: временный каталог и приложение могут
/// быть на разных томах (C:\Users\...\Temp против D:\Apps\Avizis).
fn move_file(src: &Path, dst: &Path) -> Result<(), String> {
    if fs::rename(src, dst).is_err() {
        fs::copy(src, dst).map_err(|e| format!("не скопирован {}: {e}", dst.display()))?;
        fs::remove_file(src).map_err(|e| format!("не удалён временный {}: {e}", src.display()))?;
    }
    Ok(())
}

fn backup_path(dst: &Path) -> Result<PathBuf, String> {
    let mut name = dst
        .file_name()
        .ok_or_else(|| "у цели нет имени файла".to_string())?
        .to_os_string();
    name.push(".old");
    Ok(dst.with_file_name(name))
}

/// Уборка бэкапов «*.old» от прошлого обновления — вызывается при старте
/// приложения. Best-effort: файл может быть ещё занят догорающим старым
/// процессом — не страшно, попробуем в следующий раз.
pub fn cleanup_backups(exe_dir: &Path) {
    if let Ok(entries) = fs::read_dir(exe_dir) {
        for entry in entries.flatten() {
            if entry.file_name().to_string_lossy().ends_with(".old") {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::path::PathBuf;

    /// Песочница в системном temp, удаляется при Drop
    struct Sandbox(PathBuf);

    impl Sandbox {
        fn new(tag: &str) -> Self {
            let path = std::env::temp_dir().join(format!("avizis-updater-test-{tag}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).expect("не создана песочница");
            Sandbox(path)
        }

        fn dir(&self, name: &str) -> PathBuf {
            let p = self.0.join(name);
            fs::create_dir_all(&p).expect("не создан подкаталог");
            p
        }
    }

    impl Drop for Sandbox {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn write(path: &Path, bytes: &[u8]) {
        fs::write(path, bytes).expect("не записан файл");
    }

    fn read(path: &Path) -> String {
        fs::read_to_string(path).expect("не прочитан файл").trim().to_string()
    }

    /// Zip с заданными записями (имя → содержимое)
    fn make_zip(zip_path: &Path, entries: &[(&str, &[u8])]) {
        let file = File::create(zip_path).expect("не создан zip");
        let mut w = zip::ZipWriter::new(file);
        let opts = zip::write::SimpleFileOptions::default();
        for (name, bytes) in entries {
            w.start_file(*name, opts).expect("не начата запись zip");
            w.write_all(bytes).expect("не записаны данные zip");
        }
        w.finish().expect("не закрыт zip");
    }

    #[test]
    fn swap_replaces_files_makes_backups_and_cleans_up() {
        let sb = Sandbox::new("swap");
        let app = sb.dir("app");
        let tmp = sb.dir("tmp");

        // «установленное» приложение: оболочка, движок и посторонний файл
        write(&app.join("avizis.exe"), b"OLD-APP");
        write(&app.join("avizis-engine.exe"), b"OLD-ENGINE");
        write(&app.join("unrelated.txt"), b"KEEP");

        // архив обновления: новые оболочка/движок + README
        let zip_path = sb.0.join("update.zip");
        make_zip(
            &zip_path,
            &[
                ("avizis.exe", b"NEW-APP".as_slice()),
                ("avizis-engine.exe", b"NEW-ENGINE".as_slice()),
                ("portable-README.txt", b"NEW-README".as_slice()),
            ],
        );

        let names = extract_flat(&zip_path, &tmp).expect("архив должен распаковываться");
        let plan = crate::plan_files(&names);
        assert_eq!(plan.len(), 3, "в плане все три файла: {plan:?}");

        perform_swap(&plan, &tmp, &app).expect("подмена должна проходить");

        // новые файлы на месте, старые — в бэкапах, посторонний не тронут
        assert_eq!(read(&app.join("avizis.exe")), "NEW-APP");
        assert_eq!(read(&app.join("avizis-engine.exe")), "NEW-ENGINE");
        assert_eq!(read(&app.join("portable-README.txt")), "NEW-README");
        assert_eq!(read(&app.join("avizis.exe.old")), "OLD-APP");
        assert_eq!(read(&app.join("avizis-engine.exe.old")), "OLD-ENGINE");
        assert_eq!(read(&app.join("unrelated.txt")), "KEEP");

        // порядок плана: движок первым, оболочка последней
        assert_eq!(plan.first().map(String::as_str), Some("avizis-engine.exe"));
        assert_eq!(plan.last().map(String::as_str), Some("avizis.exe"));

        // уборка при следующем старте: бэкапы ушли, новые файлы остались
        cleanup_backups(&app);
        assert!(!app.join("avizis.exe.old").exists());
        assert!(!app.join("avizis-engine.exe.old").exists());
        assert_eq!(read(&app.join("avizis.exe")), "NEW-APP");
        assert_eq!(read(&app.join("unrelated.txt")), "KEEP");
    }

    #[test]
    fn swap_into_missing_target_just_moves() {
        let sb = Sandbox::new("fresh");
        let app = sb.dir("app"); // пустой каталог — как первый запуск рядом с exe
        let tmp = sb.dir("tmp");
        write(&tmp.join("avizis-engine.exe"), b"NEW-ENGINE");

        perform_swap(&["avizis-engine.exe".to_string()], &tmp, &app).expect("подмена в пустой каталог");

        assert_eq!(read(&app.join("avizis-engine.exe")), "NEW-ENGINE");
        assert!(!app.join("avizis-engine.exe.old").exists(), "бэкапа быть не должно — цели не было");
    }

    #[test]
    fn zip_slip_archive_is_rejected_entirely() {
        let sb = Sandbox::new("slip");
        let tmp = sb.dir("tmp");
        let zip_path = sb.0.join("update.zip");
        make_zip(
            &zip_path,
            &[
                ("avizis.exe", b"NEW-APP".as_slice()),
                ("../evil.txt", b"EVIL".as_slice()),
            ],
        );

        // крейт zip отвергает архив с небезопасными путями целиком —
        // обновление просто не применится (безопасный отказ)
        let err = extract_flat(&zip_path, &tmp).expect_err("архив с zip-slip должен быть отвергнут");
        assert!(err.contains("не распакован архив"), "ошибка должна быть про распаковку: {err}");
        assert!(!sb.0.join("evil.txt").exists(), "файл не должен выйти за пределы песочницы");
        // план_files дополнительно страхует плоские имена на случай будущих
        // изменений поведения распаковки
        let plan = crate::plan_files(&["avizis.exe".to_string(), "../evil.txt".to_string()]);
        assert_eq!(plan, vec!["avizis.exe".to_string()]);
    }
}
