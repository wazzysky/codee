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
  },
  {
    version: 6,
    name: "add-export-bindings",
    sql: `
      CREATE TABLE IF NOT EXISTS export_bindings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL,
        exported_name TEXT NOT NULL,
        local_name TEXT,
        source_specifier TEXT,
        kind TEXT NOT NULL,
        line INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(file_path, exported_name, local_name, source_specifier, kind, line),
        FOREIGN KEY(file_path) REFERENCES files(path) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_export_bindings_file_path ON export_bindings(file_path);
      CREATE INDEX IF NOT EXISTS idx_export_bindings_exported_name ON export_bindings(exported_name);
      CREATE INDEX IF NOT EXISTS idx_export_bindings_source_specifier ON export_bindings(source_specifier);
    `
  },
  {
    version: 7,
    name: "add-scope-bindings-and-symbol-calls",
    sql: `
      CREATE TABLE IF NOT EXISTS scope_bindings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        line INTEGER NOT NULL,
        scope_start_line INTEGER NOT NULL,
        scope_end_line INTEGER NOT NULL,
        container_name TEXT,
        type_name TEXT,
        source_specifier TEXT,
        imported_name TEXT,
        symbol_kind TEXT,
        evidence TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(
          file_path,
          name,
          kind,
          line,
          scope_start_line,
          scope_end_line,
          container_name,
          type_name,
          source_specifier,
          imported_name,
          symbol_kind,
          evidence
        ),
        FOREIGN KEY(file_path) REFERENCES files(path) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS symbol_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        caller_file_path TEXT NOT NULL,
        caller_symbol_name TEXT NOT NULL,
        caller_symbol_kind TEXT NOT NULL,
        caller_line INTEGER NOT NULL,
        callee_file_path TEXT,
        callee_symbol_name TEXT NOT NULL,
        callee_symbol_kind TEXT,
        callee_specifier TEXT,
        reference_kind TEXT NOT NULL,
        resolution TEXT NOT NULL,
        confidence REAL NOT NULL,
        evidence_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(
          caller_file_path,
          caller_symbol_name,
          caller_symbol_kind,
          caller_line,
          callee_file_path,
          callee_symbol_name,
          callee_specifier,
          reference_kind,
          resolution
        ),
        FOREIGN KEY(caller_file_path) REFERENCES files(path) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_scope_bindings_file_path ON scope_bindings(file_path);
      CREATE INDEX IF NOT EXISTS idx_scope_bindings_name ON scope_bindings(name);
      CREATE INDEX IF NOT EXISTS idx_symbol_calls_caller_file_path ON symbol_calls(caller_file_path);
      CREATE INDEX IF NOT EXISTS idx_symbol_calls_callee_file_path ON symbol_calls(callee_file_path);
      CREATE INDEX IF NOT EXISTS idx_symbol_calls_caller_symbol_name ON symbol_calls(caller_symbol_name);
      CREATE INDEX IF NOT EXISTS idx_symbol_calls_callee_symbol_name ON symbol_calls(callee_symbol_name);
    `
  },
  {
    version: 8,
    name: "add-symbol-reference-edges-and-call-ids",
    sql: `
      ALTER TABLE symbol_calls ADD COLUMN caller_symbol_id TEXT;
      ALTER TABLE symbol_calls ADD COLUMN callee_symbol_id TEXT;

      CREATE TABLE IF NOT EXISTS symbol_reference_edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_file_path TEXT NOT NULL,
        source_symbol_name TEXT NOT NULL,
        source_symbol_kind TEXT NOT NULL,
        source_symbol_id TEXT NOT NULL,
        source_line INTEGER NOT NULL,
        source_reference_name TEXT NOT NULL,
        source_reference_kind TEXT NOT NULL,
        source_qualifier TEXT,
        target_file_path TEXT,
        target_symbol_name TEXT,
        target_symbol_kind TEXT,
        target_symbol_id TEXT,
        target_specifier TEXT,
        resolution TEXT NOT NULL,
        confidence REAL NOT NULL,
        evidence_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(
          source_file_path,
          source_symbol_id,
          source_line,
          source_reference_name,
          source_reference_kind,
          target_symbol_id,
          target_specifier,
          resolution
        ),
        FOREIGN KEY(source_file_path) REFERENCES files(path) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_symbol_reference_edges_source_file_path ON symbol_reference_edges(source_file_path);
      CREATE INDEX IF NOT EXISTS idx_symbol_reference_edges_source_symbol_id ON symbol_reference_edges(source_symbol_id);
      CREATE INDEX IF NOT EXISTS idx_symbol_reference_edges_target_file_path ON symbol_reference_edges(target_file_path);
      CREATE INDEX IF NOT EXISTS idx_symbol_reference_edges_target_symbol_id ON symbol_reference_edges(target_symbol_id);
      CREATE INDEX IF NOT EXISTS idx_symbol_reference_edges_source_reference_name ON symbol_reference_edges(source_reference_name);
    `
  },
  {
    version: 9,
    name: "add-namespace-symbol-graph",
    sql: `
      CREATE TABLE IF NOT EXISTS namespace_symbol_nodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL,
        path TEXT NOT NULL,
        kind TEXT NOT NULL,
        line INTEGER NOT NULL,
        parent_path TEXT,
        local_name TEXT,
        source_specifier TEXT,
        export_kind TEXT,
        updated_at TEXT NOT NULL,
        UNIQUE(file_path, path, kind, line, parent_path, local_name, source_specifier, export_kind),
        FOREIGN KEY(file_path) REFERENCES files(path) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS namespace_symbol_edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL,
        from_path TEXT NOT NULL,
        to_path TEXT NOT NULL,
        kind TEXT NOT NULL,
        line INTEGER NOT NULL,
        target_symbol_name TEXT,
        target_specifier TEXT,
        evidence_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(file_path, from_path, to_path, kind, line, target_symbol_name, target_specifier),
        FOREIGN KEY(file_path) REFERENCES files(path) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_namespace_symbol_nodes_file_path ON namespace_symbol_nodes(file_path);
      CREATE INDEX IF NOT EXISTS idx_namespace_symbol_nodes_path ON namespace_symbol_nodes(path);
      CREATE INDEX IF NOT EXISTS idx_namespace_symbol_edges_file_path ON namespace_symbol_edges(file_path);
      CREATE INDEX IF NOT EXISTS idx_namespace_symbol_edges_from_path ON namespace_symbol_edges(from_path);
      CREATE INDEX IF NOT EXISTS idx_namespace_symbol_edges_to_path ON namespace_symbol_edges(to_path);
    `
  },
  {
    version: 10,
    name: "add-symbol-centrality-rankings",
    sql: `
      CREATE TABLE IF NOT EXISTS symbol_rankings (
        symbol_id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        symbol_name TEXT NOT NULL,
        symbol_kind TEXT NOT NULL,
        score REAL NOT NULL,
        normalized_score REAL NOT NULL,
        incoming_reference_count INTEGER NOT NULL,
        incoming_call_count INTEGER NOT NULL,
        outgoing_call_count INTEGER NOT NULL,
        namespace_export_count INTEGER NOT NULL,
        evidence_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(file_path) REFERENCES files(path) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_symbol_rankings_file_path ON symbol_rankings(file_path);
      CREATE INDEX IF NOT EXISTS idx_symbol_rankings_symbol_name ON symbol_rankings(symbol_name);
      CREATE INDEX IF NOT EXISTS idx_symbol_rankings_score ON symbol_rankings(score);
    `
  }
];
