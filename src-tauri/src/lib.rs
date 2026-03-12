use tauri_plugin_sql::{Migration, MigrationKind};
use std::io::Write;

#[tauri::command]
async fn run_installer(path: String) -> Result<(), String> {
    std::process::Command::new(&path)
        .spawn()
        .map_err(|e| format!("spawn: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn download_update(url: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .user_agent("magic-draft-app/1.0")
        .build()
        .map_err(|e| format!("client build: {}", e))?;
    let response = client.get(&url).send().await.map_err(|e| format!("request: {}", e))?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    let bytes = response.bytes().await.map_err(|e| format!("read body: {}", e))?;
    let path = std::env::temp_dir().join("magic-draft-update.exe");
    let mut file = std::fs::File::create(&path).map_err(|e| format!("create file: {}", e))?;
    file.write_all(&bytes).map_err(|e| format!("write file: {}", e))?;
    Ok(path.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create_cards_table",
            sql: "CREATE TABLE IF NOT EXISTS cards (
                id TEXT PRIMARY KEY,
                oracle_id TEXT,
                name TEXT NOT NULL,
                mana_cost TEXT,
                cmc REAL DEFAULT 0,
                type_line TEXT,
                oracle_text TEXT,
                power TEXT,
                toughness TEXT,
                loyalty TEXT,
                colors TEXT,
                color_identity TEXT,
                keywords TEXT,
                set_code TEXT NOT NULL,
                set_name TEXT,
                collector_number TEXT,
                rarity TEXT,
                image_small TEXT,
                image_normal TEXT,
                image_art_crop TEXT,
                layout TEXT,
                produced_mana TEXT,
                back_face_name TEXT,
                back_face_mana_cost TEXT,
                back_face_type_line TEXT,
                back_face_oracle_text TEXT,
                back_face_power TEXT,
                back_face_toughness TEXT,
                back_face_image_normal TEXT
            );",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "create_card_effects_table",
            sql: "CREATE TABLE IF NOT EXISTS card_effects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                card_name TEXT NOT NULL UNIQUE,
                effects_json TEXT NOT NULL
            );",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "create_decks_table",
            sql: "CREATE TABLE IF NOT EXISTS decks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                format TEXT DEFAULT 'limited',
                set_code TEXT,
                cards_json TEXT NOT NULL,
                sideboard_json TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            );",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "create_user_prefs_table",
            sql: "CREATE TABLE IF NOT EXISTS user_prefs (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "create_cards_indexes",
            sql: "CREATE INDEX IF NOT EXISTS idx_cards_name ON cards(name);
                  CREATE INDEX IF NOT EXISTS idx_cards_set ON cards(set_code);
                  CREATE INDEX IF NOT EXISTS idx_cards_set_num ON cards(set_code, collector_number);",
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![download_update, run_installer])
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:magic_draft.db", migrations)
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
