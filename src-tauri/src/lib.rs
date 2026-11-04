mod db;
mod secrets;
mod voice;

use serde::Deserialize;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Runtime, WindowEvent,
};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

const TRAY_ID: &str = "main";

fn window_state_flags() -> StateFlags {
    StateFlags::POSITION | StateFlags::SIZE
}

fn show_window<R: Runtime>(app: &AppHandle<R>, label: &str) {
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn toggle_widget<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("widget") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            show_window(app, "widget");
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayLabels {
    toggle: String,
    dashboard: String,
    voice: String,
    new_habit: String,
    quit: String,
}

impl Default for TrayLabels {
    fn default() -> Self {
        Self {
            toggle: "Show / hide HabitWall".into(),
            dashboard: "Open dashboard".into(),
            voice: "Voice capture".into(),
            new_habit: "New habit".into(),
            quit: "Quit HabitWall".into(),
        }
    }
}

fn build_menu<R: Runtime>(app: &AppHandle<R>, l: &TrayLabels) -> tauri::Result<Menu<R>> {
    Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "toggle", &l.toggle, true, None::<&str>)?,
            &MenuItem::with_id(app, "dashboard", &l.dashboard, true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "voice", &l.voice, true, None::<&str>)?,
            &MenuItem::with_id(app, "new_habit", &l.new_habit, true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quit", &l.quit, true, None::<&str>)?,
        ],
    )
}

fn quit<R: Runtime>(app: &AppHandle<R>) {
    let _ = app.save_window_state(window_state_flags());
    app.exit(0);
}

/// Called by the frontend to label the tray menu.
#[tauri::command]
fn set_tray_labels(app: AppHandle, labels: TrayLabels) -> Result<(), String> {
    let menu = build_menu(&app, &labels).map_err(|e| e.to_string())?;
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn show_dashboard(app: AppHandle, route: Option<String>) {
    show_window(&app, "dashboard");
    if let Some(r) = route {
        let _ = app.emit_to("dashboard", "nav", r);
    }
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    quit(&app);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be first: a second launch just reveals the running widget.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_window(app, "widget");
        }))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(window_state_flags())
                .build(),
        )
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let database = db::Database::open(&dir.join("habitwall.db"))
                .map_err(|e| format!("cannot open database: {e}"))?;
            app.manage(database);
            app.manage(voice::VoiceState {
                client: reqwest::Client::builder()
                    .timeout(std::time::Duration::from_secs(60))
                    .build()?,
                audio_dir: dir.join("audio"),
            });

            let handle = app.handle();
            TrayIconBuilder::with_id(TRAY_ID)
                .icon(app.default_window_icon().cloned().expect("app icon"))
                .tooltip("HabitWall")
                .menu(&build_menu(handle, &TrayLabels::default())?)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "toggle" => toggle_widget(app),
                    "dashboard" => show_window(app, "dashboard"),
                    "voice" => {
                        show_window(app, "widget");
                        let _ = app.emit_to("widget", "tray", "voice");
                    }
                    "new_habit" => {
                        show_window(app, "widget");
                        let _ = app.emit_to("widget", "tray", "new_habit");
                    }
                    "quit" => quit(app),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_widget(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing hides; the app lives in the tray until "Quit".
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            db::db_select,
            db::db_execute,
            db::db_batch,
            secrets::secret_set,
            secrets::secret_has,
            secrets::secret_delete,
            voice::voice_transcribe,
            voice::voice_interpret,
            voice::voice_save_audio,
            set_tray_labels,
            show_dashboard,
            quit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running HabitWall");
}
