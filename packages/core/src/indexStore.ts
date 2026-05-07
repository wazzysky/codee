import { knowledgePoints } from "@repolain/knowledge-base";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { extractRepositorySymbols } from "./analyzeFileStructure.js";
import { buildDependencyGraph } from "./buildDependencyGraph.js";
import { buildSymbolLinks } from "./buildSymbolLinks.js";
import { detectProject } from "./detectProject.js";
import { generateFileMap } from "./generateFileMap.js";
import { indexMigrations } from "./indexStore/migrations.js";
import { executeSqlite, querySqlite, toSqlLiteral, type SqliteRow } from "./indexStore/sqliteCli.js";
import { matchKnowledge } from "./matchKnowledge.js";
import { scanRepository } from "./scanRepository.js";
import type {
  DependencyGraphEdge,
  FileSearchResult,
  FileAnalysis,
  FileMapFile,
  IndexedFileRecord,
  IndexSummary,
  KnowledgeMatch,
  ProjectDetection,
  RepoFile,
  ScanResult,
  SymbolLink,
  SymbolReference,
  SymbolDefinition
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
  filePath: z.string(),
  language: z.string(),
  role: z.string().optional(),
  explanation: z.string().optional(),
  score: z.number(),
  confidence: z.number(),
  reasons: z.array(z.string()),
  symbolNames: z.array(z.string()),
  knowledgeNames: z.array(z.string()),
  importSpecifiers: z.array(z.string()),
  matchedSymbols: z.array(z.string()),
  matchedKnowledge: z.array(z.string()),
  matchedImports: z.array(z.string()),
  dependencyHints: z.array(z.string()),
  matchedReferences: z.array(z.string()),
  matchedLinks: z.array(z.string())
});

const storedSymbolSchema = z.object({
  filePath: z.string(),
  name: z.string(),
  kind: z.enum(["function", "class", "method", "component"]),
  startLine: z.number(),
  endLine: z.number(),
  containerName: z.string().optional(),
  signature: z.string().optional()
});

const storedDependencySchema = z.object({
  sourcePath: z.string(),
  targetPath: z.string().optional(),
  specifier: z.string(),
  kind: z.enum(["import", "include"]),
  line: z.number(),
  resolution: z.enum(["internal", "external", "unresolved"]),
  isInternal: z.boolean(),
  confidence: z.number(),
  evidence: z.array(z.string())
});

const storedReferenceSchema = z.object({
  filePath: z.string(),
  name: z.string(),
  kind: z.enum(["call", "new", "component", "type"]),
  line: z.number(),
  containerName: z.string().optional(),
  evidence: z.string()
});

const storedLinkSchema = z.object({
  sourceFilePath: z.string(),
  sourceReferenceName: z.string(),
  sourceReferenceKind: z.enum(["call", "new", "component", "type"]),
  sourceLine: z.number(),
  sourceQualifier: z.string().optional(),
  targetFilePath: z.string().optional(),
  targetSymbolName: z.string().optional(),
  targetSymbolKind: z.enum(["function", "class", "method", "component"]).optional(),
  targetSpecifier: z.string().optional(),
  resolution: z.enum(["local", "internal", "external", "global", "unresolved"]),
  confidence: z.number(),
  evidence: z.array(z.string())
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

function buildSearchText(
  file: RepoFile,
  fileRole: FileMapFile | undefined,
  knowledgeMatches: KnowledgeMatch[],
  symbols: SymbolDefinition[],
  dependencies: DependencyGraphEdge[],
  references: SymbolReference[],
  links: SymbolLink[]
): string {
  const parts = [
    file.path,
    file.language,
    fileRole?.role ?? "",
    fileRole?.explanation ?? "",
    ...knowledgeMatches.flatMap((match) => [match.name, match.domain, ...match.evidence]),
    ...symbols.flatMap((symbol) => [symbol.name, symbol.kind, symbol.containerName ?? "", symbol.signature ?? ""]),
    ...references.flatMap((reference) => [reference.name, reference.kind, reference.containerName ?? "", reference.evidence]),
    ...dependencies.flatMap((dependency) => [dependency.specifier, dependency.targetPath ?? "", dependency.resolution]),
    ...links.flatMap((link) => [
      link.sourceReferenceName,
      link.targetSymbolName ?? "",
      link.targetFilePath ?? "",
      link.targetSpecifier ?? "",
      link.resolution,
      ...link.evidence
    ])
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
    filePath: String(row.path),
    language: String(row.language),
    role: row.role === null || row.role === undefined ? undefined : String(row.role),
    explanation: row.explanation === null || row.explanation === undefined ? undefined : String(row.explanation),
    score: Number(row.score),
    confidence: Number(row.confidence),
    reasons: parseJsonArray(row.reasons_json),
    symbolNames: parseJsonArray(row.symbol_names_json),
    knowledgeNames: parseJsonArray(row.knowledge_names_json),
    importSpecifiers: parseJsonArray(row.import_specifiers_json),
    matchedSymbols: parseJsonArray(row.matched_symbols_json ?? row.symbol_names_json),
    matchedKnowledge: parseJsonArray(row.matched_knowledge_json ?? row.knowledge_names_json),
    matchedImports: parseJsonArray(row.matched_imports_json ?? row.import_specifiers_json),
    dependencyHints: parseJsonArray(row.dependency_hints_json),
    matchedReferences: parseJsonArray(row.matched_references_json),
    matchedLinks: parseJsonArray(row.matched_links_json)
  });
}

function mapStoredSymbol(row: SqliteRow): SymbolDefinition & { filePath: string } {
  return storedSymbolSchema.parse({
    filePath: String(row.file_path),
    name: String(row.name),
    kind: String(row.kind),
    startLine: Number(row.start_line),
    endLine: Number(row.end_line),
    containerName:
      row.container_name === null || row.container_name === undefined ? undefined : String(row.container_name),
    signature: row.signature === null || row.signature === undefined ? undefined : String(row.signature)
  });
}

function mapStoredDependency(row: SqliteRow): DependencyGraphEdge & { isInternal: boolean } {
  const parsed = storedDependencySchema.parse({
    sourcePath: String(row.source_path),
    targetPath: row.target_path === null || row.target_path === undefined ? undefined : String(row.target_path),
    specifier: String(row.specifier),
    kind: String(row.kind),
    line: Number(row.line),
    resolution: String(row.resolution),
    isInternal: Number(row.is_internal) === 1,
    confidence: row.confidence === null || row.confidence === undefined ? 0.5 : Number(row.confidence),
    evidence: parseJsonArray(row.evidence_json)
  });

  return {
    ...parsed,
    from: parsed.sourcePath,
    to: parsed.targetPath,
    type: parsed.kind,
    resolved: parsed.resolution === "internal"
  };
}

function mapStoredReference(row: SqliteRow): SymbolReference & { filePath: string } {
  return storedReferenceSchema.parse({
    filePath: String(row.file_path),
    name: String(row.name),
    kind: String(row.kind),
    line: Number(row.line),
    containerName:
      row.container_name === null || row.container_name === undefined ? undefined : String(row.container_name),
    evidence: String(row.evidence)
  });
}

function mapStoredLink(row: SqliteRow): SymbolLink {
  return storedLinkSchema.parse({
    sourceFilePath: String(row.source_file_path),
    sourceReferenceName: String(row.source_reference_name),
    sourceReferenceKind: String(row.source_reference_kind),
    sourceLine: Number(row.source_line),
    sourceQualifier:
      row.source_qualifier === null || row.source_qualifier === undefined ? undefined : String(row.source_qualifier),
    targetFilePath:
      row.target_file_path === null || row.target_file_path === undefined ? undefined : String(row.target_file_path),
    targetSymbolName:
      row.target_symbol_name === null || row.target_symbol_name === undefined
        ? undefined
        : String(row.target_symbol_name),
    targetSymbolKind:
      row.target_symbol_kind === null || row.target_symbol_kind === undefined
        ? undefined
        : String(row.target_symbol_kind),
    targetSpecifier:
      row.target_specifier === null || row.target_specifier === undefined ? undefined : String(row.target_specifier),
    resolution: String(row.resolution),
    confidence: Number(row.confidence),
    evidence: parseJsonArray(row.evidence_json)
  });
}

function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/iu)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
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
    const normalizedQuery = query.trim().toLowerCase();
    const tokens = tokenizeQuery(query);
    const likeTokens = [normalizedQuery, ...tokens]
      .filter((value, index, items) => value.length > 0 && items.indexOf(value) === index)
      .map((value) => `%${value}%`);
    const whereClause = likeTokens
      .map(
        (value) =>
          `lower(COALESCE(fs.search_text, '')) LIKE ${toSqlLiteral(value)}
           OR lower(f.path) LIKE ${toSqlLiteral(value)}
           OR lower(COALESCE(fr.explanation, '')) LIKE ${toSqlLiteral(value)}
           OR lower(COALESCE(fr.role, '')) LIKE ${toSqlLiteral(value)}`
      )
      .join(" OR ");
    const candidateRows = await querySqlite(
      this.dbPath,
      `
        SELECT
          f.path,
          f.language,
          fr.role,
          fr.explanation
        FROM files f
        LEFT JOIN file_roles fr ON fr.path = f.path
        LEFT JOIN file_search fs ON fs.file_path = f.path
        WHERE ${whereClause.length > 0 ? whereClause : "1 = 1"}
        ORDER BY f.path ASC;
      `
    );

    const allSymbols = await this.listSymbols();
    const allReferences = await this.listSymbolReferences();
    const allLinks = await this.listSymbolLinks();
    const allDependencies = await this.listDependencies();
    const allKnowledgeMatches = await this.listKnowledgeMatches();
    const symbolsByPath = new Map<string, SymbolDefinition[]>();
    const referencesByPath = new Map<string, SymbolReference[]>();
    const linksByPath = new Map<string, SymbolLink[]>();
    const dependenciesByPath = new Map<string, DependencyGraphEdge[]>();
    const knowledgeByPath = new Map<string, KnowledgeMatch[]>();
    for (const symbol of allSymbols) {
      const bucket = symbolsByPath.get(symbol.filePath) ?? [];
      bucket.push(symbol);
      symbolsByPath.set(symbol.filePath, bucket);
    }

    for (const reference of allReferences) {
      const bucket = referencesByPath.get(reference.filePath) ?? [];
      bucket.push(reference);
      referencesByPath.set(reference.filePath, bucket);
    }

    for (const link of allLinks) {
      const bucket = linksByPath.get(link.sourceFilePath) ?? [];
      bucket.push(link);
      linksByPath.set(link.sourceFilePath, bucket);
    }

    for (const dependency of allDependencies) {
      const bucket = dependenciesByPath.get(dependency.sourcePath) ?? [];
      bucket.push(dependency);
      dependenciesByPath.set(dependency.sourcePath, bucket);
    }

    for (const match of allKnowledgeMatches) {
      const bucket = knowledgeByPath.get(match.filePath) ?? [];
      bucket.push(match);
      knowledgeByPath.set(match.filePath, bucket);
    }

    const results = candidateRows.map((row) => {
      const filePath = String(row.path);
      const explanation =
        row.explanation === null || row.explanation === undefined ? undefined : String(row.explanation);
      const symbolNames = (symbolsByPath.get(filePath) ?? [])
        .map((symbol) => symbol.name)
        .filter((name) => tokens.some((token) => name.toLowerCase().includes(token)))
        .sort((left, right) => left.localeCompare(right));
      const symbolKinds = (symbolsByPath.get(filePath) ?? [])
        .map((symbol) => symbol.kind)
        .filter((kind) => tokens.some((token) => kind.toLowerCase().includes(token)))
        .sort((left, right) => left.localeCompare(right));
      const matchedReferences = (referencesByPath.get(filePath) ?? [])
        .map((reference) => reference.name)
        .filter((name) => tokens.some((token) => name.toLowerCase().includes(token)))
        .sort((left, right) => left.localeCompare(right));
      const matchedLinks = (linksByPath.get(filePath) ?? [])
        .flatMap((link) => [
          link.sourceReferenceName,
          link.targetSymbolName ?? "",
          link.targetFilePath ?? "",
          link.targetSpecifier ?? "",
          link.resolution,
          ...link.evidence
        ])
        .filter((value) => value.length > 0)
        .filter((value) => tokens.some((token) => value.toLowerCase().includes(token)))
        .sort((left, right) => left.localeCompare(right));
      const importSpecifiers = (dependenciesByPath.get(filePath) ?? [])
        .map((dependency) => dependency.specifier)
        .filter((specifier) => tokens.some((token) => specifier.toLowerCase().includes(token)))
        .sort((left, right) => left.localeCompare(right));
      const dependencyHints = (dependenciesByPath.get(filePath) ?? [])
        .flatMap((dependency) => [dependency.targetPath ?? "", ...dependency.evidence])
        .filter((hint) => hint.length > 0)
        .filter((hint) => tokens.some((token) => hint.toLowerCase().includes(token)))
        .sort((left, right) => left.localeCompare(right));
      const knowledgeNames = (knowledgeByPath.get(filePath) ?? [])
        .map((match) => match.name)
        .filter((name) => tokens.some((token) => name.toLowerCase().includes(token)))
        .sort((left, right) => left.localeCompare(right));
      const reasons: string[] = [];
      let score = 0;
      const role = row.role === null || row.role === undefined ? undefined : String(row.role);
      const lowerRole = (role ?? "").toLowerCase();

      if (filePath.toLowerCase().includes(normalizedQuery)) {
        reasons.push(`path matches "${query}"`);
        score += 50;
      } else {
        const pathTokenHits = tokens.filter((token) => filePath.toLowerCase().includes(token));
        if (pathTokenHits.length > 0) {
          reasons.push(`path matches tokens: ${pathTokenHits.join(", ")}`);
          score += 15 + pathTokenHits.length * 6;
        }
      }

      if (normalizedQuery.length > 0 && lowerRole.includes(normalizedQuery) && role) {
        reasons.push(`file role matched: ${role}`);
        score += 18;
      } else {
        const roleTokenHits = tokens.filter((token) => lowerRole.includes(token));
        if (roleTokenHits.length > 0 && role) {
          reasons.push(`file role matched tokens: ${roleTokenHits.join(", ")}`);
          score += 8 + roleTokenHits.length * 4;
        }
      }

      if (explanation && explanation.toLowerCase().includes(normalizedQuery)) {
        reasons.push("file explanation matched");
        score += 28;
      }

      if (knowledgeNames.length > 0) {
        reasons.push(`knowledge matched: ${knowledgeNames.join(", ")}`);
        score += knowledgeNames.length * 18;
      }

      if (symbolNames.length > 0) {
        reasons.push(`symbols matched: ${symbolNames.join(", ")}`);
        score += symbolNames.length * 20;
      }

      if (symbolKinds.length > 0) {
        reasons.push(`symbol kinds matched: ${symbolKinds.join(", ")}`);
        score += symbolKinds.length * 10;
      }

      if (matchedReferences.length > 0) {
        reasons.push(`symbol references matched: ${matchedReferences.join(", ")}`);
        score += matchedReferences.length * 12;
      }

      if (matchedLinks.length > 0) {
        reasons.push(`symbol links matched: ${matchedLinks.join(", ")}`);
        score += matchedLinks.length * 14;
      }

      if (importSpecifiers.length > 0) {
        reasons.push(`imports/includes matched: ${importSpecifiers.join(", ")}`);
        score += importSpecifiers.length * 10;
      }

      if (dependencyHints.length > 0) {
        reasons.push(`dependency graph matched: ${dependencyHints.join(", ")}`);
        score += dependencyHints.length * 8;
      }

      return mapSearchResult({
        path: filePath,
        language: String(row.language),
        role,
        explanation,
        score,
        confidence: Number(Math.min(0.99, Math.max(0.2, score / 100)).toFixed(2)),
        reasons_json: jsonValue(reasons),
        symbol_names_json: jsonValue(symbolNames),
        knowledge_names_json: jsonValue(knowledgeNames),
        import_specifiers_json: jsonValue(importSpecifiers),
        matched_symbols_json: jsonValue(symbolNames),
        matched_knowledge_json: jsonValue(knowledgeNames),
        matched_imports_json: jsonValue(importSpecifiers),
        dependency_hints_json: jsonValue(dependencyHints),
        matched_references_json: jsonValue(matchedReferences),
        matched_links_json: jsonValue(matchedLinks)
      });
    });

    return results
      .filter((result) => result.score > 0)
      .sort((left, right) =>
      left.score === right.score ? left.path.localeCompare(right.path) : right.score - left.score
      );
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

  public async listSymbols(filePath?: string): Promise<Array<SymbolDefinition & { filePath: string }>> {
    await this.ensureReady();
    const whereClause = filePath ? `WHERE s.file_path = ${toSqlLiteral(normalizePath(filePath))}` : "";
    const rows = await querySqlite(
      this.dbPath,
      `
        SELECT
          s.file_path,
          s.name,
          s.kind,
          s.container_name,
          s.signature,
          s.start_line,
          s.end_line
        FROM symbols s
        ${whereClause}
        ORDER BY s.file_path, s.start_line, s.kind, s.name;
      `
    );

    return rows.map(mapStoredSymbol);
  }

  public async listSymbolReferences(filePath?: string): Promise<Array<SymbolReference & { filePath: string }>> {
    await this.ensureReady();
    const whereClause = filePath ? `WHERE sr.file_path = ${toSqlLiteral(normalizePath(filePath))}` : "";
    const rows = await querySqlite(
      this.dbPath,
      `
        SELECT
          sr.file_path,
          sr.name,
          sr.kind,
          sr.line,
          sr.container_name,
          sr.evidence
        FROM symbol_references sr
        ${whereClause}
        ORDER BY sr.file_path, sr.line, sr.kind, sr.name;
      `
    );

    return rows.map(mapStoredReference);
  }

  public async listSymbolLinks(filePath?: string): Promise<SymbolLink[]> {
    await this.ensureReady();
    const whereClause = filePath ? `WHERE sl.source_file_path = ${toSqlLiteral(normalizePath(filePath))}` : "";
    const rows = await querySqlite(
      this.dbPath,
      `
        SELECT
          sl.source_file_path,
          sl.source_reference_name,
          sl.source_reference_kind,
          sl.source_line,
          sl.source_qualifier,
          sl.target_file_path,
          sl.target_symbol_name,
          sl.target_symbol_kind,
          sl.target_specifier,
          sl.resolution,
          sl.confidence,
          sl.evidence_json
        FROM symbol_links sl
        ${whereClause}
        ORDER BY sl.source_file_path, sl.source_line, sl.source_reference_name, sl.target_file_path, sl.target_specifier;
      `
    );

    return rows.map(mapStoredLink);
  }

  public async listDependencies(filePath?: string): Promise<Array<DependencyGraphEdge & { isInternal: boolean }>> {
    await this.ensureReady();
    const whereClause = filePath ? `WHERE d.source_path = ${toSqlLiteral(normalizePath(filePath))}` : "";
    const rows = await querySqlite(
      this.dbPath,
      `
        SELECT
          d.source_path,
          d.target_path,
          d.specifier,
          d.kind,
          d.line,
          d.resolution,
          d.is_internal,
          d.confidence,
          d.evidence_json
        FROM dependencies d
        ${whereClause}
        ORDER BY d.source_path, d.line, d.specifier;
      `
    );

    return rows.map(mapStoredDependency);
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

  private async countRows(tableName: string): Promise<number> {
    const rows = await querySqlite(
      this.dbPath,
      `SELECT COUNT(*) AS count FROM ${tableName};`
    );
    return rows[0] ? Number(rows[0].count) : 0;
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
    const existingHashes = await this.getExistingFileHashes();
    const currentFilesByPath = new Map(scanResult.files.map((file) => [file.path, file]));
    const currentPaths = new Set(currentFilesByPath.keys());
    const existingPaths = new Set(existingHashes.keys());
    const changedPaths = scanResult.files
      .filter((file) => existingHashes.get(file.path) !== file.hash)
      .map((file) => file.path);
    const existingReferenceCount = await this.countRows("symbol_references");
    const existingSymbolLinkCount = await this.countRows("symbol_links");
    const removedPaths = [...existingPaths].filter((filePath) => !currentPaths.has(filePath)).sort((left, right) =>
      left.localeCompare(right)
    );

    const projectDetection = await detectProject(scanResult.root, scanResult.files);
    const fileMap = generateFileMap(scanResult);
    const knowledgeResult = await matchKnowledge(scanResult);
    const structureBackfillNeeded =
      scanResult.files.length > 0 && (existingReferenceCount === 0 || existingSymbolLinkCount === 0);
    const structureChanged = changedPaths.length > 0 || removedPaths.length > 0 || structureBackfillNeeded;
    const symbolResult = structureChanged
      ? await extractRepositorySymbols(scanResult)
      : { root: scanResult.root, files: [] as FileAnalysis[], diagnostics: [] };
    const dependencyGraph = structureChanged
      ? buildDependencyGraph(scanResult.root, symbolResult.files)
      : { root: scanResult.root, nodes: [], edges: [] as DependencyGraphEdge[], diagnostics: [] };
    const symbolLinkGraph = structureChanged
      ? buildSymbolLinks(scanResult.root, symbolResult.files, dependencyGraph)
      : { root: scanResult.root, links: [] as SymbolLink[], diagnostics: [] };
    const previousProjectDetection = await this.getProjectDetection();
    const timestamp = nowIso();
    const projectChanged = !isProjectDetectionEqual(previousProjectDetection, projectDetection);

    const fileRolesByPath = new Map(fileMap.files.map((file) => [file.path, file]));
    const analysesByPath = new Map(symbolResult.files.map((analysis) => [analysis.filePath, analysis]));
    const referencesByPath = new Map<string, SymbolReference[]>();
    const linksByPath = new Map<string, SymbolLink[]>();
    const dependenciesByPath = new Map<string, DependencyGraphEdge[]>();
    for (const analysis of symbolResult.files) {
      referencesByPath.set(analysis.filePath, analysis.references);
    }
    for (const link of symbolLinkGraph.links) {
      const bucket = linksByPath.get(link.sourceFilePath) ?? [];
      bucket.push(link);
      linksByPath.set(link.sourceFilePath, bucket);
    }
    for (const edge of dependencyGraph.edges) {
      const bucket = dependenciesByPath.get(edge.sourcePath) ?? [];
      bucket.push(edge);
      dependenciesByPath.set(edge.sourcePath, bucket);
    }
    const knowledgeByFilePath = new Map<string, KnowledgeMatch[]>();
    for (const match of knowledgeResult.matches) {
      const bucket = knowledgeByFilePath.get(match.filePath) ?? [];
      bucket.push(match);
      knowledgeByFilePath.set(match.filePath, bucket);
    }

    const refreshStructurePaths = structureChanged
      ? [...currentPaths].sort((left, right) => left.localeCompare(right))
      : [];
    const refreshKnowledgePaths = structureChanged || projectChanged
      ? [...currentPaths].sort((left, right) => left.localeCompare(right))
      : changedPaths.slice().sort((left, right) => left.localeCompare(right));
    const refreshSearchPaths = [...new Set([...refreshStructurePaths, ...refreshKnowledgePaths])].sort((left, right) =>
      left.localeCompare(right)
    );

    await this.persistKnowledgePoints(timestamp);

    const sqlStatements: string[] = ["BEGIN;"];

    for (const removedPath of removedPaths) {
      sqlStatements.push(`DELETE FROM files WHERE path = ${toSqlLiteral(removedPath)};`);
      sqlStatements.push(`DELETE FROM file_search WHERE file_path = ${toSqlLiteral(removedPath)};`);
      sqlStatements.push(`DELETE FROM symbols WHERE file_path = ${toSqlLiteral(removedPath)};`);
      sqlStatements.push(`DELETE FROM symbol_references WHERE file_path = ${toSqlLiteral(removedPath)};`);
      sqlStatements.push(`DELETE FROM symbol_links WHERE source_file_path = ${toSqlLiteral(removedPath)};`);
      sqlStatements.push(`DELETE FROM dependencies WHERE source_path = ${toSqlLiteral(removedPath)};`);
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

    for (const filePath of refreshStructurePaths) {
      const analysis = analysesByPath.get(filePath);
      const references = referencesByPath.get(filePath) ?? [];
      const links = linksByPath.get(filePath) ?? [];
      const dependencies = dependenciesByPath.get(filePath) ?? [];
      sqlStatements.push(`DELETE FROM symbols WHERE file_path = ${toSqlLiteral(filePath)};`);
      sqlStatements.push(`DELETE FROM symbol_references WHERE file_path = ${toSqlLiteral(filePath)};`);
      sqlStatements.push(`DELETE FROM symbol_links WHERE source_file_path = ${toSqlLiteral(filePath)};`);
      sqlStatements.push(`DELETE FROM dependencies WHERE source_path = ${toSqlLiteral(filePath)};`);

      if (!analysis) {
        continue;
      }

      for (const symbol of analysis.symbols) {
        sqlStatements.push(
          `
            INSERT INTO symbols(file_path, name, kind, container_name, signature, start_line, end_line, updated_at)
            VALUES (
              ${toSqlLiteral(filePath)},
              ${toSqlLiteral(symbol.name)},
              ${toSqlLiteral(symbol.kind)},
              ${symbol.containerName ? toSqlLiteral(symbol.containerName) : "NULL"},
              ${symbol.signature ? toSqlLiteral(symbol.signature) : "NULL"},
              ${symbol.startLine},
              ${symbol.endLine},
              ${toSqlLiteral(timestamp)}
            );
          `
        );
      }

      for (const reference of references) {
        sqlStatements.push(
          `
            INSERT INTO symbol_references(file_path, name, kind, line, container_name, evidence, updated_at)
            VALUES (
              ${toSqlLiteral(filePath)},
              ${toSqlLiteral(reference.name)},
              ${toSqlLiteral(reference.kind)},
              ${reference.line},
              ${reference.containerName ? toSqlLiteral(reference.containerName) : "NULL"},
              ${toSqlLiteral(reference.evidence)},
              ${toSqlLiteral(timestamp)}
            );
          `
        );
      }

      for (const link of links) {
        sqlStatements.push(
          `
            INSERT INTO symbol_links(
              source_file_path,
              source_reference_name,
              source_reference_kind,
              source_line,
              source_qualifier,
              target_file_path,
              target_symbol_name,
              target_symbol_kind,
              target_specifier,
              resolution,
              confidence,
              evidence_json,
              updated_at
            )
            VALUES (
              ${toSqlLiteral(filePath)},
              ${toSqlLiteral(link.sourceReferenceName)},
              ${toSqlLiteral(link.sourceReferenceKind)},
              ${link.sourceLine},
              ${link.sourceQualifier ? toSqlLiteral(link.sourceQualifier) : "NULL"},
              ${link.targetFilePath ? toSqlLiteral(link.targetFilePath) : "NULL"},
              ${link.targetSymbolName ? toSqlLiteral(link.targetSymbolName) : "NULL"},
              ${link.targetSymbolKind ? toSqlLiteral(link.targetSymbolKind) : "NULL"},
              ${link.targetSpecifier ? toSqlLiteral(link.targetSpecifier) : "NULL"},
              ${toSqlLiteral(link.resolution)},
              ${link.confidence},
              ${toSqlLiteral(jsonValue(link.evidence))},
              ${toSqlLiteral(timestamp)}
            );
          `
        );
      }

      for (const dependency of dependencies) {
        sqlStatements.push(
          `
            INSERT INTO dependencies(
              source_path,
              specifier,
              kind,
              target_path,
              line,
              resolution,
              is_internal,
              confidence,
              evidence_json,
              updated_at
            )
            VALUES (
              ${toSqlLiteral(filePath)},
              ${toSqlLiteral(dependency.specifier)},
              ${toSqlLiteral(dependency.kind)},
              ${dependency.targetPath ? toSqlLiteral(dependency.targetPath) : "NULL"},
              ${dependency.line},
              ${toSqlLiteral(dependency.resolution)},
              ${dependency.resolution === "internal" || dependency.resolution === "unresolved" ? 1 : 0},
              ${dependency.confidence},
              ${toSqlLiteral(jsonValue(dependency.evidence))},
              ${toSqlLiteral(timestamp)}
            );
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

      sqlStatements.push(`DELETE FROM file_knowledge WHERE file_path = ${toSqlLiteral(filePath)};`);
      for (const match of knowledgeByFilePath.get(filePath) ?? []) {
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
    }

    for (const filePath of refreshSearchPaths) {
      const file = currentFilesByPath.get(filePath);
      if (!file) {
        continue;
      }

      const role = fileRolesByPath.get(filePath);
      const matches = knowledgeByFilePath.get(filePath) ?? [];
      const analysis = analysesByPath.get(filePath);
      const references = referencesByPath.get(filePath) ?? [];
      const links = linksByPath.get(filePath) ?? [];
      const dependencies = dependenciesByPath.get(filePath) ?? [];
      const searchText = buildSearchText(file, role, matches, analysis?.symbols ?? [], dependencies, references, links);

      sqlStatements.push(`DELETE FROM file_search WHERE file_path = ${toSqlLiteral(filePath)};`);

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
    for (const diagnostic of [
      ...scanResult.diagnostics,
      ...symbolResult.diagnostics,
      ...symbolLinkGraph.diagnostics,
      ...knowledgeResult.diagnostics
    ]) {
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

    const persistedSymbolCount = await this.countRows("symbols");
    const persistedReferenceCount = await this.countRows("symbol_references");
    const persistedSymbolLinkCount = await this.countRows("symbol_links");
    const persistedDependencyCount = await this.countRows("dependencies");

    return {
      root: this.root,
      dbPath: this.dbPath,
      totalFiles: scanResult.files.length,
      changedFiles: changedPaths.length,
      removedFiles: removedPaths.length,
      knowledgeMatchCount: knowledgeResult.matches.length,
      symbolCount: persistedSymbolCount,
      referenceCount: persistedReferenceCount,
      symbolLinkCount: persistedSymbolLinkCount,
      dependencyCount: persistedDependencyCount,
      diagnosticCount:
        scanResult.diagnostics.length +
        symbolResult.diagnostics.length +
        symbolLinkGraph.diagnostics.length +
        knowledgeResult.diagnostics.length,
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

export async function listSymbols(
  rootPath: string,
  filePath?: string
): Promise<Array<SymbolDefinition & { filePath: string }>> {
  const store = await createIndexStore(rootPath);
  return store.listSymbols(filePath);
}

export async function listSymbolReferences(
  rootPath: string,
  filePath?: string
): Promise<Array<SymbolReference & { filePath: string }>> {
  const store = await createIndexStore(rootPath);
  return store.listSymbolReferences(filePath);
}

export async function listSymbolLinks(rootPath: string, filePath?: string): Promise<SymbolLink[]> {
  const store = await createIndexStore(rootPath);
  return store.listSymbolLinks(filePath);
}

export async function listDependencies(
  rootPath: string,
  filePath?: string
): Promise<Array<DependencyGraphEdge & { isInternal: boolean }>> {
  const store = await createIndexStore(rootPath);
  return store.listDependencies(filePath);
}
