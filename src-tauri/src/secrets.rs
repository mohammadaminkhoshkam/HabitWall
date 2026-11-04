//! API keys live in the OS credential store (Windows Credential Manager / macOS Keychain).
//! The frontend can set, test for, or delete a key — it can never read one back.

use keyring::Entry;

const SERVICE: &str = "HabitWall";

fn entry(name: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, name).map_err(|e| e.to_string())
}

pub fn get(name: &str) -> Option<String> {
    entry(name).ok()?.get_password().ok().filter(|s| !s.is_empty())
}

#[tauri::command]
pub fn secret_set(name: String, value: String) -> Result<(), String> {
    entry(&name)?.set_password(value.trim()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_has(name: String) -> bool {
    get(&name).is_some()
}

#[tauri::command]
pub fn secret_delete(name: String) -> Result<(), String> {
    match entry(&name)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
