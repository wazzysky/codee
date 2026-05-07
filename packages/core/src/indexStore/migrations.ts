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
  },
  {
    version: 2,
    name: "add-symbols-and-dependencies",
    sql: `
      CREATE TABLE IF NOT EXISTS symbols (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        container_name TEXT,
        signature TEXT,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(file_path, name, kind, start_line),
        FOREIGN KEY(file_path) REFERENCES files(path) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS dependencies (
        source_path TEXT NOT NULL,
        specifier TEXT NOT NULL,
        kind TEXT NOT NULL,
        target_path TEXT,
        line INTEGER NOT NULL,
        resolution TEXT NOT NULL,
        is_internal INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(source_path, specifier, kind, line),
        FOREIGN KEY(source_path) REFERENCES files(path) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_symbols_file_path ON symbols(file_path);
      CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
      CREATE INDEX IF NOT EXISTS idx_dependencies_source_path ON dependencies(source_path);
      CREATE INDEX IF NOT EXISTS idx_dependencies_target_path ON dependencies(target_path);
    `
  },
  {
    version: 3,
    name: "add-dependency-confidence-and-evidence",
    sql: `
      ALTER TABLE dependencies ADD COLUMN confidence REAL NOT NULL DEFAULT 0.5;
      ALTER TABLE dependencies ADD COLUMN evidence_json TEXT NOT NULL DEFAULT '[]';
    `
  },
  {
    version: 4,
    name: "add-symbol-references",
    sql: `
      CREATE TABLE IF NOT EXISTS symbol_references (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        line INTEGER NOT NULL,
        container_name TEXT,
        evidence TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(file_path, name, kind, line, container_name, evidence),
        FOREIGN KEY(file_path) REFERENCES files(path) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_symbol_references_file_path ON symbol_references(file_path);
      CREATE INDEX IF NOT EXISTS idx_symbol_references_name ON symbol_references(name);
    `
  },
  {
    version: 5,
    name: "add-symbol-links",
    sql: `
      CREATE TABLE IF NOT EXISTS symbol_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_file_path TEXT NOT NULL,
        source_reference_name TEXT NOT NULL,
        source_reference_kind TEXT NOT NULL,
        source_line INTEGER NOT NULL,
        source_qualifier TEXT,
        target_file_path TEXT,
        target_symbol_name TEXT,
        target_symbol_kind TEXT,
        target_specifier TEXT,
        resolution TEXT NOT NULL,
        confidence REAL NOT NULL,
        evidence_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(
          source_file_path,
          source_reference_name,
          source_reference_kind,
          source_line,
          source_qualifier,
          target_file_path,
          target_symbol_name,
          target_specifier,
          resolution
        ),
        FOREIGN KEY(source_file_path) REFERENCES files(path) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_symbol_links_source_file_path ON symbol_links(source_file_path);
      CREATE INDEX IF NOT EXISTS idx_symbol_links_target_file_path ON symbol_links(target_file_path);
      CREATE INDEX IF NOT EXISTS idx_symbol_links_source_reference_name ON symbol_links(source_reference_name);
      CREATE INDEX IF NOT EXISTS idx_symbol_links_target_symbol_name ON symbol_links(target_symbol_name);
    `
  }
];
