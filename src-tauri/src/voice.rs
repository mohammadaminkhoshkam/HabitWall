//! Speech-to-text and AI interpretation. Network calls happen only here, so the API key
//! never reaches the webview. Prompts/schemas are built in TypeScript (src/services/ai.ts)
//! and passed in, which keeps providers swappable without touching Rust.

use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::multipart::{Form, Part};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use tauri::State;

use crate::secrets;

pub struct VoiceState {
    pub client: reqwest::Client,
    pub audio_dir: PathBuf,
}

const KEY_NAME: &str = "openai";
const DEFAULT_BASE: &str = "https://api.openai.com/v1";

fn api_key() -> Result<String, String> {
    secrets::get(KEY_NAME).ok_or_else(|| "NO_API_KEY".to_string())
}

fn base(url: &Option<String>) -> String {
    url.as_deref()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(DEFAULT_BASE)
        .trim_end_matches('/')
        .to_string()
}

async fn check(resp: reqwest::Response) -> Result<Value, String> {
    let status = resp.status();
    let body = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        let msg = serde_json::from_str::<Value>(&body)
            .ok()
            .and_then(|v| v["error"]["message"].as_str().map(String::from))
            .unwrap_or_else(|| body.chars().take(300).collect());
        return Err(format!("HTTP {}: {}", status.as_u16(), msg));
    }
    serde_json::from_str(&body).map_err(|e| e.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeArgs {
    audio_b64: String,
    mime: String,
    model: String,
    base_url: Option<String>,
    #[serde(default)]
    languages: Vec<String>,
    prompt: Option<String>,
    #[serde(default)]
    keywords: Vec<String>,
}

#[derive(Serialize)]
pub struct Transcription {
    text: String,
    model: String,
}

#[tauri::command]
pub async fn voice_transcribe(state: State<'_, VoiceState>, args: TranscribeArgs) -> Result<Transcription, String> {
    let key = api_key()?;
    let audio = STANDARD.decode(args.audio_b64.as_bytes()).map_err(|e| e.to_string())?;
    let ext = if args.mime.contains("ogg") { "ogg" } else if args.mime.contains("wav") { "wav" } else { "webm" };
    let file = Part::bytes(audio)
        .file_name(format!("audio.{ext}"))
        .mime_str(args.mime.split(';').next().unwrap_or("audio/webm"))
        .map_err(|e| e.to_string())?;

    let mut form = Form::new().text("model", args.model.clone()).part("file", file);
    // gpt-transcribe accepts several language hints and keyword hints; older models take one language.
    if args.model.starts_with("gpt-transcribe") {
        for l in &args.languages {
            form = form.text("languages[]", l.clone());
        }
        for k in args.keywords.iter().take(50) {
            form = form.text("keywords[]", k.clone());
        }
    } else if args.languages.len() == 1 {
        form = form.text("language", args.languages[0].clone());
    }
    if let Some(p) = args.prompt.filter(|p| !p.is_empty()) {
        form = form.text("prompt", p);
    }

    let resp = state
        .client
        .post(format!("{}/audio/transcriptions", base(&args.base_url)))
        .bearer_auth(key)
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let v = check(resp).await?;
    Ok(Transcription {
        text: v["text"].as_str().unwrap_or_default().trim().to_string(),
        model: args.model,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InterpretArgs {
    model: String,
    base_url: Option<String>,
    system: String,
    user: String,
    schema: Value,
}

/// Chat completion with a strict JSON schema; returns the raw JSON string.
#[tauri::command]
pub async fn voice_interpret(state: State<'_, VoiceState>, args: InterpretArgs) -> Result<String, String> {
    let key = api_key()?;
    let body = json!({
        "model": args.model,
        "messages": [
            { "role": "system", "content": args.system },
            { "role": "user", "content": args.user }
        ],
        "response_format": {
            "type": "json_schema",
            "json_schema": { "name": "habit_voice", "strict": true, "schema": args.schema }
        }
    });
    let resp = state
        .client
        .post(format!("{}/chat/completions", base(&args.base_url)))
        .bearer_auth(key)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let v = check(resp).await?;
    v["choices"][0]["message"]["content"]
        .as_str()
        .map(String::from)
        .ok_or_else(|| "empty response".to_string())
}

/// Keeps the original recording when the user opted in. Returns the file path.
#[tauri::command]
pub async fn voice_save_audio(state: State<'_, VoiceState>, id: String, audio_b64: String, ext: String) -> Result<String, String> {
    if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') || !ext.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("invalid name".into());
    }
    std::fs::create_dir_all(&state.audio_dir).map_err(|e| e.to_string())?;
    let path = state.audio_dir.join(format!("{id}.{ext}"));
    let bytes = STANDARD.decode(audio_b64.as_bytes()).map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}
