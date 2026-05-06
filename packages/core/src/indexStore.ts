import { knowledgePoints } from "@repolain/knowledge-base";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { detectProject } from "./detectProject.js";
import { generateFileMap } from "./generateFileMap.js";
import { indexMigrations } from "./indexStore/migrations.js";
import { executeSqlite, querySqlite, toSqlLiteral, type SqliteRow } from "./indexStore/sqliteCli.js";
import { matchKnowledge } from "./matchKnowledge.js";
import { scanRepository } from "./scanRepository.js";
import type {
  FileSearchResult,
  FileMapFile,
  IndexedFileRecord,
  IndexSummary,
  KnowledgeMatch,
  ProjectDetection,
  RepoFile,
  ScanResult
} from "./types.js";

const storedFileSchema = z.object({
  path: z.string(),
  absPath: z.string(),
  language: z.string(),
  size: z.number(),
  lineCount: z.number(),
  hash: z.string(),
  role: z.string().optional(),
  explanation: z.string().optional(),
  confidence: z.number().optional(),
  important: z.boolean().optional()
});

const searchResultSchema = z.object({
  path: z.string(),
  language: z.string(),
  role: z.string().optional(),
  explanation: z.string().optional(),
  score: z.number()
});

function nowIso(): string {
  return new Date().toISOString();
}

function normalizePath(filePath: string): string {
  return path.posix.normalize(filePath.split(path.sep).join(path.posix.sep));
}

function jsonValue(value: unknown): string {
  return JSON.stringify(value);
}

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== "string") {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function buildSearchText(file: RepoFile, fileRole: FileMapFile | undefined, knowledgeMatches: KnowledgeMatch[]): string {
  const parts = [
    file.path,
    file.language,
    fileRole?.role ?? "",
    fileRole?.explanation ?? "",
    ...knowledgeMatches.flatMap((match) => [match.name, match.domain, ...match.evidence])
  ];

  return parts.filter((part) => part.length > 0).join("\n");
}

function serializeProjectDetection(projectDetection: ProjectDetection): string {
  return JSON.stringify({
    projectTypes: projectDetection.projectTypes,
    languages: projectDetection.languages,
    frameworks: projectDetection.frameworks,
    buildTools: projectDetection.buildTools,
    generatedBy: projectDetection.generatedBy,
    entryCandidates: projectDetection.entryCandidates,
    confidence: projectDetection.confidence,
    evidence: projectDetection.evidence,
    uncertainties: projectDetection.uncertainties
  });
}

function isProjectDetectionEqual(left: ProjectDetection | undefined, right: ProjectDetection): boolean {
  if (!left) {
    return false;
  }

  return serializeProjectDetection(left) === serializeProjectDetection(right);
}

function mapStoredFile(row: SqliteRow): IndexedFileRecord {
  return storedFileSchema.parse({
    path: String(row.path),
    absPath: String(row.abs_path),
    language: String(row.language),
    size: Number(row.size),
    lineCount: Number(row.line_count),
    hash: String(row.hash),
    role: row.role === null || row.role === undefined ? undefined : String(row.role),
    explanation: row.explanation === null || row.explanation === undefined ? undefined : String(row.explanation),
    confidence: row.confidence === null || row.confidence === undefined ? undefined : Number(row.confidence),
    important:
      row.important === null || row.important === undefined ? undefined : Number(row.important) === 1
  });
}

function mapSearchResult(row: SqliteRow): FileSearchResult {
  return searchResultSchema.parse({
    path: String(row.path),
    language: String(row.language),
    role: row.role === null || row.role === undefined ? undefined : String(row.role),
    explanation: row.explanation === null || row.explanation === undefined ? undefined : String(row.explanation),
    score: Number(row.score)
  });
}

export class SQLiteIndexStore {
  public readonly root: string;
  public readonly dbDir: string;
  public readonly dbPath: string;

  public constructor(rootPath: string) {
    this.root = path.resolve(rootPath);
    this.dbDir = path.join(this.root, ".repolain");
    this.dbPath = path.join(this.dbDir, "index.sqlite");
  }

  public async ensureReady(): Promise<void> {
    await fs.mkdir(this.dbDir, { recursive: true });
    await this.applyMigrations();
  }

  private async applyMigrations(): Promise<void> {
    await executeSqlite(
      this.dbPath,
      `
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL
        );
      `
    );

    const appliedRows = await querySqlite(
      this.dbPath,
      `SELECT version FROM schema_migrations ORDER BY version;`
    );
    const appliedVersions = new Set(appliedRows.map((row) => Number(row.version)));
    const appliedAt = nowIso();

    for (const migration of indexMigrations) {
      if (appliedVersions.has(migration.version)) {
        continue;
      }

      await executeSqlite(
        this.dbPath,
        `
          BEGIN;
          ${migration.sql}
          INSERT INTO schema_migrations(version, name, applied_at)
          VALUES (${migration.version}, ${toSqlLiteral(migration.name)}, ${toSqlLiteral(appliedAt)});
          COMMIT;
        `
      );
    }
  }

  public async listFiles(): Promise<IndexedFileRecord[]> {
    await this.ensureReady();
    const rows = await querySqlite(
      this.dbPath,
      `
        SELECT
          f.path,
          f.abs_path,
          f.language,
          f.size,
          f.line_count,
          f.hash,
          fr.role,
          fr.explanation,
          fr.confidence,
          fr.important
        FROM files f
        LEFT JOIN file_roles fr ON fr.path = f.path
        ORDER BY f.path;
      `
    );

    return rows.map(mapStoredFile);
  }

  public async getFile(filePath: string): Promise<IndexedFileRecord | undefined> {
    await this.ensureReady();
    const normalizedPath = normalizePath(filePath);
    const rows = await querySqlite(
      this.dbPath,
      `
        SELECT
          f.path,
          f.abs_path,
          f.language,
          f.size,
          f.line_count,
          f.hash,
          fr.role,
          fr.explanation,
          fr.confidence,
          fr.important
        FROM files f
        LEFT JOIN file_roles fr ON fr.path = f.path
        WHERE f.path = ${toSqlLiteral(normalizedPath)}
        LIMIT 1;
      `
    );

    return rows[0] ? mapStoredFile(rows[0]) : undefined;
  }

  public async searchFiles(query: string): Promise<FileSearchResult[]> {
    await this.ensureReady();
    const likeQuery = `%${query.toLowerCase()}%`;
    const rows = await querySqlite(
      this.dbPath,
      `
        SELECT
          f.path,
          f.language,
          fr.role,
          fr.explanation,
          CASE
            WHEN lower(f.path) LIKE ${toSqlLiteral(likeQuery)} THEN 4
            WHEN lower(COALESCE(fr.explanation, '')) LIKE ${toSqlLiteral(likeQuery)} THEN 3
            WHEN lower(COALESCE(fs.search_text, '')) LIKE ${toSqlLiteral(likeQuery)} THEN 2
            ELSE 1
          END AS score
        FROM files f
        LEFT JOIN file_roles fr ON fr.path = f.path
        LEFT JOIN file_search fs ON fs.file_path = f.path
        WHERE lower(COALESCE(fs.search_text, '')) LIKE ${toSqlLiteral(likeQuery)}
           OR lower(f.path) LIKE ${toSqlLiteral(likeQuery)}
           OR lower(COALESCE(fr.explanation, '')) LIKE ${toSqlLiteral(likeQuery)}
        ORDER BY score DESC, f.path ASC;
      `
    );

    return rows.map(mapSearchResult);
  }

  public async listKnowledgeMatches(filePath?: string): Promise<KnowledgeMatch[]> {
    await this.ensureReady();
    const whereClause = filePath
      ? `WHERE fk.file_path = ${toSqlLiteral(normalizePath(filePath))}`
      : "";
    const rows = await querySqlite(
      this.dbPath,
      `
        SELECT
          fk.file_path,
          fk.knowledge_id,
          fk.name,
          fk.domain,
          fk.confidence,
          fk.evidence_json
        FROM file_knowledge fk
        ${whereClause}
        ORDER BY fk.file_path, fk.knowledge_id;
      `
    );

    return rows.map((row) => ({
      filePath: String(row.file_path),
      knowledgeId: String(row.knowledge_id),
      name: String(row.name),
      domain: String(row.domain),
      confidence: Number(row.confidence),
      evidence: parseJsonArray(row.evidence_json)
    }));
  }

  public async getProjectDetection(): Promise<ProjectDetection | undefined> {
    await this.ensureReady();
    const rows = await querySqlite(
      this.dbPath,
      `
        SELECT
          project_types_json,
          languages_json,
          frameworks_json,
          build_tools_json,
          generated_by_json,
          entry_candidates_json,
          confidence,
          evidence_json,
          uncertainties_json
        FROM project_detections
        WHERE id = 1
        LIMIT 1;
      `
    );

    const row = rows[0];
    if (!row) {
      return undefined;
    }

    return {
      projectTypes: parseJsonArray(row.project_types_json),
      languages: parseJsonArray(row.languages_json),
      frameworks: parseJsonArray(row.frameworks_json),
      buildTools: parseJsonArray(row.build_tools_json),
      generatedBy: parseJsonArray(row.generated_by_json),
      entryCandidates: parseJsonArray(row.entry_candidates_json),
      confidence: Number(row.confidence),
      evidence: parseJsonArray(row.evidence_json),
      uncertainties: parseJsonArray(row.uncertainties_json)
    };
  }

  private async getExistingFileHashes(): Promise<Map<string, string>> {
    const rows = await querySqlite(this.dbPath, `SELECT path, hash FROM files ORDER BY path;`);
    return new Map(rows.map((row) => [String(row.path), String(row.hash)]));
  }

  private async persistKnowledgePoints(timestamp: string): Promise<void> {
    const statements = knowledgePoints.map((point) => {
      return `
        INSERT INTO knowledge_points(id, name, domain, aliases_json, keywords_json, description, updated_at)
        VALUES (
          ${toSqlLiteral(point.id)},
          ${toSqlLiteral(point.name)},
          ${toSqlLiteral(point.domain)},
          ${toSqlLiteral(jsonValue(point.aliases))},
          ${toSqlLiteral(jsonValue(point.keywords))},
          ${toSqlLiteral(point.description)},
          ${toSqlLiteral(timestamp)}
        )
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          domain = excluded.domain,
          aliases_json = excluded.aliases_json,
          keywords_json = excluded.keywords_json,
          description = excluded.description,
          updated_at = excluded.updated_at;
      `;
    });

    await executeSqlite(
      this.dbPath,
      `
        BEGIN;
        ${statements.join("\n")}
        COMMIT;
      `
    );
  }

  public async indexRepository(): Promise<IndexSummary> {
    await this.ensureReady();

    const scanResult = await scanRepository(this.root);
    const projectDetection = await detectProject(scanResult.root, scanResult.files);
    const fileMap = generateFileMap(scanResult);
    const knowledgeResult = await matchKnowledge(scanResult);

    const existingHashes = await this.getExistingFileHashes();
    const previousProjectDetection = await this.getProjectDetection();
    const timestamp = nowIso();

    const currentFilesByPath = new Map(scanResult.files.map((file) => [file.path, file]));
    const currentPaths = new Set(currentFilesByPath.keys());
    const existingPaths = new Set(existingHashes.keys());

    const changedPaths = scanResult.files
      .filter((file) => existingHashes.get(file.path) !== file.hash)
      .map((file) => file.path);
    const removedPaths = [...existingPaths].filter((filePath) => !currentPaths.has(filePath)).sort((left, right) =>
      left.localeCompare(right)
    );
    const projectChanged = !isProjectDetectionEqual(previousProjectDetection, projectDetection);

    const fileRolesByPath = new Map(fileMap.files.map((file) => [file.path, file]));
    const knowledgeByFilePath = new Map<string, KnowledgeMatch[]>();
    for (const match of knowledgeResult.matches) {
      const bucket = knowledgeByFilePath.get(match.filePath) ?? [];
      bucket.push(match);
      knowledgeByFilePath.set(match.filePath, bucket);
    }

    const refreshKnowledgePaths = projectChanged
      ? [...currentPaths].sort((left, right) => left.localeCompare(right))
      : changedPaths.slice().sort((left, right) => left.localeCompare(right));

    await this.persistKnowledgePoints(timestamp);

    const sqlStatements: string[] = ["BEGIN;"];

    for (const removedPath of removedPaths) {
      sqlStatements.push(`DELETE FROM files WHERE path = ${toSqlLiteral(removedPath)};`);
      sqlStatements.push(`DELETE FROM file_search WHERE file_path = ${toSqlLiteral(removedPath)};`);
    }

    for (const changedPath of changedPaths.sort((left, right) => left.localeCompare(right))) {
      const file = currentFilesByPath.get(changedPath);
      if (!file) {
        continue;
      }

      sqlStatements.push(`DELETE FROM files WHERE path = ${toSqlLiteral(changedPath)};`);
      sqlStatements.push(
        `
          INSERT INTO files(path, abs_path, language, size, line_count, hash, updated_at)
          VALUES (
            ${toSqlLiteral(file.path)},
            ${toSqlLiteral(file.absPath)},
            ${toSqlLiteral(file.language)},
            ${file.size},
            ${file.lineCount},
            ${toSqlLiteral(file.hash)},
            ${toSqlLiteral(timestamp)}
          );
        `
      );

      const role = fileRolesByPath.get(changedPath);
      if (role) {
        sqlStatements.push(
          `
            INSERT INTO file_roles(path, directory, role, explanation, confidence, important, language, updated_at)
            VALUES (
              ${toSqlLiteral(role.path)},
              ${toSqlLiteral(role.directory)},
              ${toSqlLiteral(role.role)},
              ${toSqlLiteral(role.explanation)},
              ${role.confidence},
              ${role.important ? 1 : 0},
              ${toSqlLiteral(role.language)},
              ${toSqlLiteral(timestamp)}
            )
            ON CONFLICT(path) DO UPDATE SET
              directory = excluded.directory,
              role = excluded.role,
              explanation = excluded.explanation,
              confidence = excluded.confidence,
              important = excluded.important,
              language = excluded.language,
              updated_at = excluded.updated_at;
          `
        );
      }
    }

    sqlStatements.push(
      `
        INSERT INTO project_detections(
          id,
          project_types_json,
          languages_json,
          frameworks_json,
          build_tools_json,
          generated_by_json,
          entry_candidates_json,
          confidence,
          evidence_json,
          uncertainties_json,
          updated_at
        )
        VALUES (
          1,
          ${toSqlLiteral(jsonValue(projectDetection.projectTypes))},
          ${toSqlLiteral(jsonValue(projectDetection.languages))},
          ${toSqlLiteral(jsonValue(projectDetection.frameworks))},
          ${toSqlLiteral(jsonValue(projectDetection.buildTools))},
          ${toSqlLiteral(jsonValue(projectDetection.generatedBy))},
          ${toSqlLiteral(jsonValue(projectDetection.entryCandidates))},
          ${projectDetection.confidence},
          ${toSqlLiteral(jsonValue(projectDetection.evidence))},
          ${toSqlLiteral(jsonValue(projectDetection.uncertainties))},
          ${toSqlLiteral(timestamp)}
        )
        ON CONFLICT(id) DO UPDATE SET
          project_types_json = excluded.project_types_json,
          languages_json = excluded.languages_json,
          frameworks_json = excluded.frameworks_json,
          build_tools_json = excluded.build_tools_json,
          generated_by_json = excluded.generated_by_json,
          entry_candidates_json = excluded.entry_candidates_json,
          confidence = excluded.confidence,
          evidence_json = excluded.evidence_json,
          uncertainties_json = excluded.uncertainties_json,
          updated_at = excluded.updated_at;
      `
    );

    for (const filePath of refreshKnowledgePaths) {
      const file = currentFilesByPath.get(filePath);
      if (!file) {
        continue;
      }

      const role = fileRolesByPath.get(filePath);
      const matches = knowledgeByFilePath.get(filePath) ?? [];
      const searchText = buildSearchText(file, role, matches);

      sqlStatements.push(`DELETE FROM file_knowledge WHERE file_path = ${toSqlLiteral(filePath)};`);
      sqlStatements.push(`DELETE FROM file_search WHERE file_path = ${toSqlLiteral(filePath)};`);

      for (const match of matches) {
        sqlStatements.push(
          `
            INSERT INTO file_knowledge(file_path, knowledge_id, name, domain, confidence, evidence_json, updated_at)
            VALUES (
              ${toSqlLiteral(match.filePath)},
              ${toSqlLiteral(match.knowledgeId)},
              ${toSqlLiteral(match.name)},
              ${toSqlLiteral(match.domain)},
              ${match.confidence},
              ${toSqlLiteral(jsonValue(match.evidence))},
              ${toSqlLiteral(timestamp)}
            );
          `
        );
      }

      sqlStatements.push(
        `
          INSERT INTO file_search(file_path, search_text, updated_at)
          VALUES (
            ${toSqlLiteral(filePath)},
            ${toSqlLiteral(searchText.toLowerCase())},
            ${toSqlLiteral(timestamp)}
          )
          ON CONFLICT(file_path) DO UPDATE SET
            search_text = excluded.search_text,
            updated_at = excluded.updated_at;
        `
      );
    }

    sqlStatements.push(`DELETE FROM diagnostics;`);
    for (const diagnostic of [...scanResult.diagnostics, ...knowledgeResult.diagnostics]) {
      sqlStatements.push(
        `
          INSERT INTO diagnostics(path, level, message, source, updated_at)
          VALUES (
            ${diagnostic.path ? toSqlLiteral(diagnostic.path) : "NULL"},
            ${toSqlLiteral(diagnostic.level)},
            ${toSqlLiteral(diagnostic.message)},
            ${toSqlLiteral("index")},
            ${toSqlLiteral(timestamp)}
          );
        `
      );
    }

    sqlStatements.push(
      `
        INSERT INTO repository_metadata(key, value, updated_at)
        VALUES
          ('root', ${toSqlLiteral(this.root)}, ${toSqlLiteral(timestamp)}),
          ('db_path', ${toSqlLiteral(this.dbPath)}, ${toSqlLiteral(timestamp)}),
          ('last_indexed_at', ${toSqlLiteral(timestamp)}, ${toSqlLiteral(timestamp)})
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at;
      `
    );

    sqlStatements.push("COMMIT;");
    await executeSqlite(this.dbPath, sqlStatements.join("\n"));

    return {
      root: this.root,
      dbPath: this.dbPath,
      totalFiles: scanResult.files.length,
      changedFiles: changedPaths.length,
      removedFiles: removedPaths.length,
      knowledgeMatchCount: knowledgeResult.matches.length,
      diagnosticCount: scanResult.diagnostics.length + knowledgeResult.diagnostics.length,
      projectTypes: projectDetection.projectTypes
    };
  }
}

export async function createIndexStore(rootPath: string): Promise<SQLiteIndexStore> {
  const store = new SQLiteIndexStore(rootPath);
  await store.ensureReady();
  return store;
}

export async function indexRepository(rootPath: string): Promise<IndexSummary> {
  const store = await createIndexStore(rootPath);
  return store.indexRepository();
}

export async function listFiles(rootPath: string): Promise<IndexedFileRecord[]> {
  const store = await createIndexStore(rootPath);
  return store.listFiles();
}

export async function getFile(rootPath: string, filePath: string): Promise<IndexedFileRecord | undefined> {
  const store = await createIndexStore(rootPath);
  return store.getFile(filePath);
}

export async function searchFiles(rootPath: string, query: string): Promise<FileSearchResult[]> {
  const store = await createIndexStore(rootPath);
  return store.searchFiles(query);
}

export async function listKnowledgeMatches(
  rootPath: string,
  filePath?: string
): Promise<KnowledgeMatch[]> {
  const store = await createIndexStore(rootPath);
  return store.listKnowledgeMatches(filePath);
}
