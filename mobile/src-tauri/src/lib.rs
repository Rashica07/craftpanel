#[cfg(target_os = "android")]
mod android_vm;
#[cfg(target_os = "android")]
mod jvm;

use tauri::Manager;

/// Proof-of-life for on-device Java hosting: unpacks the bundled JRE (first
/// run only) and starts a real embedded JVM via `libjvm.so`, returning its
/// reported version string. Doesn't launch a server yet — this is the
/// go/no-go check for the whole embedding approach. Android-only: there's
/// no bundled JRE (or point to one) on a desktop dev build.
#[cfg(target_os = "android")]
#[tauri::command]
fn jvm_smoke_test(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    jvm::smoke_test(&dir)
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn jvm_smoke_test() -> Result<String, String> {
    Err("Local Java hosting is Android-only.".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![jvm_smoke_test])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
