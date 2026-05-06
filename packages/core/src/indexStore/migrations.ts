export interface IndexMigration {
  version: number;
  name: string;
  sql: string;
}

export const indexMigrations: IndexMigration[] = [
  {
    version: 1,
    name: "create-initial-index-schema",
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS repository_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY,
        abs_path TEXT NOT NULL,
        language TEXT NOT NULL,
        size INTEGER NOT NULL,
        line_count INTEGER NOT NULL,
        hash TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS project_detections (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        project_types_json TEXT NOT NULL,
        languages_json TEXT NOT NULL,
        frameworks_json TEXT NOT NULL,
        build_tools_json TEXT NOT NULL,
        generated_by_json TEXT NOT NULL,
        entry_candidates_json TEXT NOT NULL,
        confidence REAL NOT NULL,
        evidence_json TEXT NOT NULL,
        uncertainties_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS file_roles (
        path TEXT PRIMARY KEY,
        directory TEXT NOT NULL,
        role TEXT NOT NULL,
        explanation TEXT NOT NULL,
        confidence REAL NOT NULL,
        important INTEGER NOT NULL,
        language TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(path) REFERENCES files(path) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS knowledge_points (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        domain TEXT NOT NULL,
        aliases_json TEXT NOT NULL,
        keywords_json TEXT NOT NULL,
        description TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS file_knowledge (
        file_path TEXT NOT NULL,
        knowledge_id TEXT NOT NULL,
        name TEXT NOT NULL,
        domain TEXT NOT NULL,
        confidence REAL NOT NULL,
        evidence_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (file_path, knowledge_id),
        FOREIGN KEY(file_path) REFERENCES files(path) ON DELETE CASCADE,
        FOREIGN KEY(knowledge_id) REFERENCES knowledge_points(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS file_search (
        file_path TEXT PRIMARY KEY,
        search_text TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(file_path) REFERENCES files(path) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS diagnostics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        source TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_files_hash ON files(hash);
      CREATE INDEX IF NOT EXISTS idx_file_roles_role ON file_roles(role);
      CREATE INDEX IF NOT EXISTS idx_file_knowledge_file_path ON file_knowledge(file_path);
      CREATE INDEX IF NOT EXISTS idx_file_knowledge_knowledge_id ON file_knowledge(knowledge_id);
      CREATE INDEX IF NOT EXISTS idx_diagnostics_path ON diagnostics(path);
    `
  }
];
