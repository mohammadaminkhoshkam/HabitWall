//! Thin SQLite bridge. The schema and all queries live in the TypeScript data layer
//! (src/data); this module only guarantees durability and atomic batches.

use rusqlite::{types::Value as SqlValue, Connection, OpenFlags};
use serde::Deserialize;
use serde_json::{Map, Number, Value};
use std::{path::Path, sync::Mutex};
use tauri::State;

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        let conn = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
        )?;
        // WAL + FULL sync: every committed action survives a crash or power loss.
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = FULL;
             PRAGMA foreign_keys = ON;
             PRAGMA busy_timeout = 5000;",
        )?;
        Ok(Self { conn: Mutex::new(conn) })
    }
}

#[derive(Deserialize)]
pub struct Stmt {
    sql: String,
    #[serde(default)]
    params: Vec<Value>,
}

fn to_sql(v: &Value) -> SqlValue {
    match v {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(*b as i64),
        Value::Number(n) => match n.as_i64() {
            Some(i) => SqlValue::Integer(i),
            None => SqlValue::Real(n.as_f64().unwrap_or(0.0)),
        },
        Value::String(s) => SqlValue::Text(s.clone()),
        other => SqlValue::Text(other.to_string()),
    }
}

fn from_sql(v: rusqlite::types::ValueRef) -> Value {
    use rusqlite::types::ValueRef::*;
    match v {
        Null => Value::Null,
        Integer(i) => Value::Number(i.into()),
        Real(f) => Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null),
        Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        Blob(_) => Value::Null,
    }
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn query(conn: &Connection, sql: &str, params: &[Value]) -> Result<Vec<Map<String, Value>>, String> {
    let mut stmt = conn.prepare_cached(sql).map_err(err)?;
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let bound: Vec<SqlValue> = params.iter().map(to_sql).collect();
    let mut rows = stmt.query(rusqlite::params_from_iter(bound.iter())).map_err(err)?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(err)? {
        let mut obj = Map::with_capacity(names.len());
        for (i, name) in names.iter().enumerate() {
            obj.insert(name.clone(), from_sql(row.get_ref(i).map_err(err)?));
        }
        out.push(obj);
    }
    Ok(out)
}

fn exec(conn: &Connection, sql: &str, params: &[Value]) -> Result<usize, String> {
    let bound: Vec<SqlValue> = params.iter().map(to_sql).collect();
    if bound.is_empty() && sql.trim_end().trim_end_matches(';').contains(';') {
        // Multi-statement script (migrations).
        conn.execute_batch(sql).map_err(err)?;
        return Ok(0);
    }
    conn.execute(sql, rusqlite::params_from_iter(bound.iter())).map_err(err)
}

#[tauri::command]
pub async fn db_select(
    db: State<'_, Database>,
    sql: String,
    params: Vec<Value>,
) -> Result<Vec<Map<String, Value>>, String> {
    let conn = db.conn.lock().map_err(err)?;
    query(&conn, &sql, &params)
}

#[tauri::command]
pub async fn db_execute(db: State<'_, Database>, sql: String, params: Vec<Value>) -> Result<usize, String> {
    let conn = db.conn.lock().map_err(err)?;
    exec(&conn, &sql, &params)
}

/// All statements commit together or not at all.
#[tauri::command]
pub async fn db_batch(db: State<'_, Database>, stmts: Vec<Stmt>) -> Result<(), String> {
    let mut conn = db.conn.lock().map_err(err)?;
    let tx = conn.transaction().map_err(err)?;
    for s in &stmts {
        exec(&tx, &s.sql, &s.params)?;
    }
    tx.commit().map_err(err)
}
