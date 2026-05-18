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
  ExportBinding,
  FileSearchResult,
  FileAnalysis,
  FileMapFile,
  IndexedFileRecord,
  IndexSummary,
  KnowledgeMatch,
  NamespaceSymbolEdge,
  NamespaceSymbolNode,
  ProjectDetection,
  RepoFile,
  ScanResult,
  ScopeBinding,
  SymbolCallEdge,
  SymbolCentralityScore,
  SymbolLink,
  SymbolReferenceEdge,
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
  matchedCoreSymbols: z.array(z.string()),
  matchedNamespaces: z.array(z.string()),
  matchedExports: z.array(z.string()),
  matchedCalls: z.array(z.string()),
  dependencyHints: z.array(z.string()),
  matchedReferences: z.array(z.string()),
  matchedLinks: z.array(z.string())
});

const storedSymbolSchema = z.object({
  filePath: z.string(),
  name: z.string(),
  kind: z.enum(["function", "class", "method", "component", "type"]),
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

const storedExportBindingSchema = z.object({
  filePath: z.string(),
  exportedName: z.string(),
  localName: z.string().optional(),
  sourceSpecifier: z.string().optional(),
  kind: z.enum(["default", "named", "all", "namespace"]),
  line: z.number()
});

const storedReferenceSchema = z.object({
  filePath: z.string(),
  name: z.string(),
  kind: z.enum(["call", "new", "component", "type"]),
  line: z.number(),
  containerName: z.string().optional(),
  evidence: z.string()
});

const storedScopeBindingSchema = z.object({
  filePath: z.string(),
  name: z.string(),
  kind: z.enum(["symbol", "import", "module", "parameter", "variable", "implicit-this", "implicit-self"]),
  line: z.number(),
  scopeStartLine: z.number(),
  scopeEndLine: z.number(),
  containerName: z.string().optional(),
  typeName: z.string().optional(),
  sourceSpecifier: z.string().optional(),
  importedName: z.string().optional(),
  symbolKind: z.enum(["function", "class", "method", "component", "type"]).optional(),
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
  targetSymbolKind: z.enum(["function", "class", "method", "component", "type"]).optional(),
  targetSpecifier: z.string().optional(),
  resolution: z.enum(["local", "internal", "external", "global", "unresolved"]),
  confidence: z.number(),
  evidence: z.array(z.string())
});

const storedCallSchema = z.object({
  callerFilePath: z.string(),
  callerSymbolName: z.string(),
  callerSymbolKind: z.enum(["function", "class", "method", "component", "type"]),
  callerSymbolId: z.string(),
  callerLine: z.number(),
  calleeFilePath: z.string().optional(),
  calleeSymbolName: z.string(),
  calleeSymbolKind: z.enum(["function", "class", "method", "component", "type"]).optional(),
  calleeSymbolId: z.string().optional(),
  calleeSpecifier: z.string().optional(),
  referenceKind: z.enum(["call", "new", "component"]),
  resolution: z.enum(["local", "internal", "external", "global", "unresolved"]),
  confidence: z.number(),
  evidence: z.array(z.string())
});

const storedReferenceEdgeSchema = z.object({
  sourceFilePath: z.string(),
  sourceSymbolName: z.string(),
  sourceSymbolKind: z.enum(["function", "class", "method", "component", "type"]),
  sourceSymbolId: z.string(),
  sourceLine: z.number(),
  sourceReferenceName: z.string(),
  sourceReferenceKind: z.enum(["call", "new", "component", "type"]),
  sourceQualifier: z.string().optional(),
  targetFilePath: z.string().optional(),
  targetSymbolName: z.string().optional(),
  targetSymbolKind: z.enum(["function", "class", "method", "component", "type"]).optional(),
  targetSymbolId: z.string().optional(),
  targetSpecifier: z.string().optional(),
  resolution: z.enum(["local", "internal", "external", "global", "unresolved"]),
  confidence: z.number(),
  evidence: z.array(z.string())
});

const storedNamespaceNodeSchema = z.object({
  filePath: z.string(),
  path: z.string(),
  kind: z.enum(["namespace", "export"]),
  line: z.number(),
  parentPath: z.string().optional(),
  localName: z.string().optional(),
  sourceSpecifier: z.string().optional(),
  exportKind: z.enum(["default", "named", "all", "namespace"]).optional()
});

const storedNamespaceEdgeSchema = z.object({
  filePath: z.string(),
  fromPath: z.string(),
  toPath: z.string(),
  kind: z.enum(["contains", "resolves-to"]),
  line: z.number(),
  targetSymbolName: z.string().optional(),
  targetSpecifier: z.string().optional(),
  evidence: z.array(z.string())
});

const storedSymbolRankingSchema = z.object({
  symbolId: z.string(),
  filePath: z.string(),
  symbolName: z.string(),
  symbolKind: z.enum(["function", "class", "method", "component", "type"]),
  score: z.number(),
  normalizedScore: z.number(),
  incomingReferenceCount: z.number(),
  incomingCallCount: z.number(),
  outgoingCallCount: z.number(),
  namespaceExportCount: z.number(),
  evidence: z.array(z.string())
});

const STRUCTURE_INDEX_VERSION = "6";

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
  symbolRankings: SymbolCentralityScore[],
  namespaceNodes: NamespaceSymbolNode[],
  namespaceEdges: NamespaceSymbolEdge[],
  exportBindings: ExportBinding[],
  scopeBindings: ScopeBinding[],
  dependencies: DependencyGraphEdge[],
  references: SymbolReference[],
  referenceEdges: SymbolReferenceEdge[],
  links: SymbolLink[],
  calls: SymbolCallEdge[]
): string {
  const parts = [
    file.path,
    file.language,
    fileRole?.role ?? "",
    fileRole?.explanation ?? "",
    ...knowledgeMatches.flatMap((match) => [match.name, match.domain, ...match.evidence]),
    ...symbols.flatMap((symbol) => [symbol.name, symbol.kind, symbol.containerName ?? "", symbol.signature ?? ""]),
    ...symbolRankings.flatMap((ranking) => [ranking.symbolName, ranking.symbolKind, ...ranking.evidence]),
    ...namespaceNodes.flatMap((node) => [
      node.path,
      node.kind,
      node.parentPath ?? "",
      node.localName ?? "",
      node.sourceSpecifier ?? "",
      node.exportKind ?? ""
    ]),
    ...namespaceEdges.flatMap((edge) => [
      edge.fromPath,
      edge.toPath,
      edge.kind,
      edge.targetSymbolName ?? "",
      edge.targetSpecifier ?? "",
      ...edge.evidence
    ]),
    ...exportBindings.flatMap((binding) => [
      binding.exportedName,
      binding.localName ?? "",
      binding.sourceSpecifier ?? "",
      binding.kind
    ]),
    ...scopeBindings.flatMap((binding) => [
      binding.name,
      binding.kind,
      binding.typeName ?? "",
      binding.sourceSpecifier ?? "",
      binding.importedName ?? "",
      binding.symbolKind ?? ""
    ]),
    ...references.flatMap((reference) => [reference.name, reference.kind, reference.containerName ?? "", reference.evidence]),
    ...referenceEdges.flatMap((edge) => [
      edge.sourceSymbolName,
      edge.sourceReferenceName,
      edge.targetSymbolName ?? "",
      edge.targetFilePath ?? "",
      edge.targetSpecifier ?? "",
      edge.sourceReferenceKind,
      edge.resolution
    ]),
    ...dependencies.flatMap((dependency) => [dependency.specifier, dependency.targetPath ?? "", dependency.resolution]),
    ...links.flatMap((link) => [
      link.sourceReferenceName,
      link.targetSymbolName ?? "",
      link.targetFilePath ?? "",
      link.targetSpecifier ?? "",
      link.resolution,
      ...link.evidence
    ]),
    ...calls.flatMap((call) => [
      call.callerSymbolName,
      call.calleeSymbolName,
      call.calleeFilePath ?? "",
      call.calleeSpecifier ?? "",
      call.referenceKind,
      call.resolution,
      ...call.evidence
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
    matchedCoreSymbols: parseJsonArray(row.matched_core_symbols_json),
    matchedNamespaces: parseJsonArray(row.matched_namespaces_json),
    matchedExports: parseJsonArray(row.matched_exports_json),
    matchedCalls: parseJsonArray(row.matched_calls_json),
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

function mapStoredExportBinding(row: SqliteRow): ExportBinding & { filePath: string } {
  return storedExportBindingSchema.parse({
    filePath: String(row.file_path),
    exportedName: String(row.exported_name),
    localName:
      row.local_name === null || row.local_name === undefined ? undefined : String(row.local_name),
    sourceSpecifier:
      row.source_specifier === null || row.source_specifier === undefined ? undefined : String(row.source_specifier),
    kind: String(row.kind),
    line: Number(row.line)
  });
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

function mapStoredScopeBinding(row: SqliteRow): ScopeBinding & { filePath: string } {
  return storedScopeBindingSchema.parse({
    filePath: String(row.file_path),
    name: String(row.name),
    kind: String(row.kind),
    line: Number(row.line),
    scopeStartLine: Number(row.scope_start_line),
    scopeEndLine: Number(row.scope_end_line),
    containerName:
      row.container_name === null || row.container_name === undefined ? undefined : String(row.container_name),
    typeName: row.type_name === null || row.type_name === undefined ? undefined : String(row.type_name),
    sourceSpecifier:
      row.source_specifier === null || row.source_specifier === undefined ? undefined : String(row.source_specifier),
    importedName:
      row.imported_name === null || row.imported_name === undefined ? undefined : String(row.imported_name),
    symbolKind:
      row.symbol_kind === null || row.symbol_kind === undefined ? undefined : String(row.symbol_kind),
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

function mapStoredCall(row: SqliteRow): SymbolCallEdge {
  return storedCallSchema.parse({
    callerFilePath: String(row.caller_file_path),
    callerSymbolName: String(row.caller_symbol_name),
    callerSymbolKind: String(row.caller_symbol_kind),
    callerSymbolId: String(row.caller_symbol_id),
    callerLine: Number(row.caller_line),
    calleeFilePath:
      row.callee_file_path === null || row.callee_file_path === undefined ? undefined : String(row.callee_file_path),
    calleeSymbolName: String(row.callee_symbol_name),
    calleeSymbolKind:
      row.callee_symbol_kind === null || row.callee_symbol_kind === undefined
        ? undefined
        : String(row.callee_symbol_kind),
    calleeSymbolId:
      row.callee_symbol_id === null || row.callee_symbol_id === undefined ? undefined : String(row.callee_symbol_id),
    calleeSpecifier:
      row.callee_specifier === null || row.callee_specifier === undefined ? undefined : String(row.callee_specifier),
    referenceKind: String(row.reference_kind),
    resolution: String(row.resolution),
    confidence: Number(row.confidence),
    evidence: parseJsonArray(row.evidence_json)
  });
}

function mapStoredReferenceEdge(row: SqliteRow): SymbolReferenceEdge {
  return storedReferenceEdgeSchema.parse({
    sourceFilePath: String(row.source_file_path),
    sourceSymbolName: String(row.source_symbol_name),
    sourceSymbolKind: String(row.source_symbol_kind),
    sourceSymbolId: String(row.source_symbol_id),
    sourceLine: Number(row.source_line),
    sourceReferenceName: String(row.source_reference_name),
    sourceReferenceKind: String(row.source_reference_kind),
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
    targetSymbolId:
      row.target_symbol_id === null || row.target_symbol_id === undefined ? undefined : String(row.target_symbol_id),
    targetSpecifier:
      row.target_specifier === null || row.target_specifier === undefined ? undefined : String(row.target_specifier),
    resolution: String(row.resolution),
    confidence: Number(row.confidence),
    evidence: parseJsonArray(row.evidence_json)
  });
}

function mapStoredNamespaceNode(row: SqliteRow): NamespaceSymbolNode {
  return storedNamespaceNodeSchema.parse({
    filePath: String(row.file_path),
    path: String(row.path),
    kind: String(row.kind),
    line: Number(row.line),
    parentPath: row.parent_path === null || row.parent_path === undefined ? undefined : String(row.parent_path),
    localName: row.local_name === null || row.local_name === undefined ? undefined : String(row.local_name),
    sourceSpecifier:
      row.source_specifier === null || row.source_specifier === undefined ? undefined : String(row.source_specifier),
    exportKind: row.export_kind === null || row.export_kind === undefined ? undefined : String(row.export_kind)
  });
}

function mapStoredNamespaceEdge(row: SqliteRow): NamespaceSymbolEdge {
  return storedNamespaceEdgeSchema.parse({
    filePath: String(row.file_path),
    fromPath: String(row.from_path),
    toPath: String(row.to_path),
    kind: String(row.kind),
    line: Number(row.line),
    targetSymbolName:
      row.target_symbol_name === null || row.target_symbol_name === undefined
        ? undefined
        : String(row.target_symbol_name),
    targetSpecifier:
      row.target_specifier === null || row.target_specifier === undefined ? undefined : String(row.target_specifier),
    evidence: parseJsonArray(row.evidence_json)
  });
}

function mapStoredSymbolRanking(row: SqliteRow): SymbolCentralityScore {
  return storedSymbolRankingSchema.parse({
    symbolId: String(row.symbol_id),
    filePath: String(row.file_path),
    symbolName: String(row.symbol_name),
    symbolKind: String(row.symbol_kind),
    score: Number(row.score),
    normalizedScore: Number(row.normalized_score),
    incomingReferenceCount: Number(row.incoming_reference_count),
    incomingCallCount: Number(row.incoming_call_count),
    outgoingCallCount: Number(row.outgoing_call_count),
    namespaceExportCount: Number(row.namespace_export_count),
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

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
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

  public async isStructureIndexCurrent(): Promise<boolean> {
    const currentVersion = await this.getMetadataValue("structure_index_version");
    return currentVersion === STRUCTURE_INDEX_VERSION;
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
    const allSymbolRankings = await this.listSymbolRankings();
    const allNamespaceNodes = await this.listNamespaceSymbolNodes();
    const allNamespaceEdges = await this.listNamespaceSymbolEdges();
    const allExportBindings = await this.listExportBindings();
    const allReferences = await this.listSymbolReferences();
    const allScopeBindings = await this.listScopeBindings();
    const allLinks = await this.listSymbolLinks();
    const allReferenceEdges = await this.listSymbolReferenceEdges();
    const allCalls = await this.listSymbolCalls();
    const allDependencies = await this.listDependencies();
    const allKnowledgeMatches = await this.listKnowledgeMatches();
    const symbolsByPath = new Map<string, SymbolDefinition[]>();
    const symbolRankingsByPath = new Map<string, SymbolCentralityScore[]>();
    const namespaceNodesByPath = new Map<string, NamespaceSymbolNode[]>();
    const namespaceEdgesByPath = new Map<string, NamespaceSymbolEdge[]>();
    const exportBindingsByPath = new Map<string, ExportBinding[]>();
    const referencesByPath = new Map<string, SymbolReference[]>();
    const scopeBindingsByPath = new Map<string, ScopeBinding[]>();
    const linksByPath = new Map<string, SymbolLink[]>();
    const outgoingReferenceEdgesByPath = new Map<string, SymbolReferenceEdge[]>();
    const incomingReferenceEdgesByPath = new Map<string, SymbolReferenceEdge[]>();
    const callsByPath = new Map<string, SymbolCallEdge[]>();
    const dependenciesByPath = new Map<string, DependencyGraphEdge[]>();
    const knowledgeByPath = new Map<string, KnowledgeMatch[]>();
    for (const symbol of allSymbols) {
      const bucket = symbolsByPath.get(symbol.filePath) ?? [];
      bucket.push(symbol);
      symbolsByPath.set(symbol.filePath, bucket);
    }

    for (const ranking of allSymbolRankings) {
      const bucket = symbolRankingsByPath.get(ranking.filePath) ?? [];
      bucket.push(ranking);
      symbolRankingsByPath.set(ranking.filePath, bucket);
    }

    for (const node of allNamespaceNodes) {
      const bucket = namespaceNodesByPath.get(node.filePath) ?? [];
      bucket.push(node);
      namespaceNodesByPath.set(node.filePath, bucket);
    }

    for (const edge of allNamespaceEdges) {
      const bucket = namespaceEdgesByPath.get(edge.filePath) ?? [];
      bucket.push(edge);
      namespaceEdgesByPath.set(edge.filePath, bucket);
    }

    for (const exportBinding of allExportBindings) {
      const bucket = exportBindingsByPath.get(exportBinding.filePath) ?? [];
      bucket.push(exportBinding);
      exportBindingsByPath.set(exportBinding.filePath, bucket);
    }

    for (const reference of allReferences) {
      const bucket = referencesByPath.get(reference.filePath) ?? [];
      bucket.push(reference);
      referencesByPath.set(reference.filePath, bucket);
    }

    for (const scopeBinding of allScopeBindings) {
      const bucket = scopeBindingsByPath.get(scopeBinding.filePath) ?? [];
      bucket.push(scopeBinding);
      scopeBindingsByPath.set(scopeBinding.filePath, bucket);
    }

    for (const link of allLinks) {
      const bucket = linksByPath.get(link.sourceFilePath) ?? [];
      bucket.push(link);
      linksByPath.set(link.sourceFilePath, bucket);
    }

    for (const edge of allReferenceEdges) {
      const outgoing = outgoingReferenceEdgesByPath.get(edge.sourceFilePath) ?? [];
      outgoing.push(edge);
      outgoingReferenceEdgesByPath.set(edge.sourceFilePath, outgoing);
      if (edge.targetFilePath) {
        const incoming = incomingReferenceEdgesByPath.get(edge.targetFilePath) ?? [];
        incoming.push(edge);
        incomingReferenceEdgesByPath.set(edge.targetFilePath, incoming);
      }
    }

    for (const call of allCalls) {
      const bucket = callsByPath.get(call.callerFilePath) ?? [];
      bucket.push(call);
      callsByPath.set(call.callerFilePath, bucket);
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
      const symbolNames = uniqueSorted((symbolsByPath.get(filePath) ?? [])
        .map((symbol) => symbol.name)
        .filter((name) => tokens.some((token) => name.toLowerCase().includes(token)))
      );
      const symbolKinds = uniqueSorted((symbolsByPath.get(filePath) ?? [])
        .map((symbol) => symbol.kind)
        .filter((kind) => tokens.some((token) => kind.toLowerCase().includes(token)))
      );
      const matchedCoreSymbols = uniqueSorted((symbolRankingsByPath.get(filePath) ?? [])
        .filter((ranking) =>
          [ranking.symbolName, ranking.symbolKind, ...ranking.evidence].some((value) =>
            value.length > 0 && tokens.some((token) => value.toLowerCase().includes(token))
          )
        )
        .map((ranking) => ranking.symbolName)
      );
      const matchedNamespaces = uniqueSorted([
        ...(namespaceNodesByPath.get(filePath) ?? []).flatMap((node) => [
          node.path,
          node.kind,
          node.parentPath ?? "",
          node.localName ?? "",
          node.sourceSpecifier ?? "",
          node.exportKind ?? ""
        ]),
        ...(namespaceEdgesByPath.get(filePath) ?? []).flatMap((edge) => [
          edge.fromPath,
          edge.toPath,
          edge.kind,
          edge.targetSymbolName ?? "",
          edge.targetSpecifier ?? "",
          ...edge.evidence
        ])
      ]
        .filter((value) => value.length > 0)
        .filter((value) => tokens.some((token) => value.toLowerCase().includes(token)))
      );
      const matchedExports = uniqueSorted((exportBindingsByPath.get(filePath) ?? [])
        .flatMap((binding) => [binding.exportedName, binding.localName ?? "", binding.sourceSpecifier ?? "", binding.kind])
        .filter((value) => value.length > 0)
        .filter((value) => tokens.some((token) => value.toLowerCase().includes(token)))
      );
      const matchedReferences = uniqueSorted((referencesByPath.get(filePath) ?? [])
        .map((reference) => reference.name)
        .filter((name) => tokens.some((token) => name.toLowerCase().includes(token)))
      );
      const matchedScopeBindings = uniqueSorted((scopeBindingsByPath.get(filePath) ?? [])
        .flatMap((binding) => [
          binding.name,
          binding.kind,
          binding.typeName ?? "",
          binding.sourceSpecifier ?? "",
          binding.importedName ?? "",
          binding.symbolKind ?? ""
        ])
        .filter((value) => value.length > 0)
        .filter((value) => tokens.some((token) => value.toLowerCase().includes(token)))
      );
      const matchedLinks = uniqueSorted((linksByPath.get(filePath) ?? [])
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
      );
      const matchedCalls = uniqueSorted((callsByPath.get(filePath) ?? [])
        .flatMap((call) => [
          call.callerSymbolName,
          call.calleeSymbolName,
          call.calleeFilePath ?? "",
          call.calleeSpecifier ?? "",
          call.referenceKind,
          call.resolution,
          ...call.evidence
        ])
        .filter((value) => value.length > 0)
        .filter((value) => tokens.some((token) => value.toLowerCase().includes(token)))
      );
      const matchedUsageHints = uniqueSorted([
        ...(outgoingReferenceEdgesByPath.get(filePath) ?? []),
        ...(incomingReferenceEdgesByPath.get(filePath) ?? [])
      ]
        .flatMap((edge) => [
          edge.sourceSymbolName,
          edge.sourceReferenceName,
          edge.targetSymbolName ?? "",
          edge.targetFilePath ?? "",
          edge.targetSpecifier ?? "",
          edge.sourceReferenceKind,
          edge.resolution
        ])
        .filter((value) => value.length > 0)
        .filter((value) => tokens.some((token) => value.toLowerCase().includes(token)))
      );
      const importSpecifiers = uniqueSorted((dependenciesByPath.get(filePath) ?? [])
        .map((dependency) => dependency.specifier)
        .filter((specifier) => tokens.some((token) => specifier.toLowerCase().includes(token)))
      );
      const dependencyHints = uniqueSorted((dependenciesByPath.get(filePath) ?? [])
        .flatMap((dependency) => [dependency.targetPath ?? "", ...dependency.evidence])
        .filter((hint) => hint.length > 0)
        .filter((hint) => tokens.some((token) => hint.toLowerCase().includes(token)))
      );
      const knowledgeNames = uniqueSorted((knowledgeByPath.get(filePath) ?? [])
        .map((match) => match.name)
        .filter((name) => tokens.some((token) => name.toLowerCase().includes(token)))
      );
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

      if (matchedCoreSymbols.length > 0) {
        reasons.push(`core symbols matched: ${matchedCoreSymbols.join(", ")}`);
        score += matchedCoreSymbols.length * 18;
      }

      if (matchedNamespaces.length > 0) {
        reasons.push(`namespace graph matched: ${matchedNamespaces.join(", ")}`);
        score += matchedNamespaces.length * 13;
      }

      if (matchedReferences.length > 0) {
        reasons.push(`symbol references matched: ${matchedReferences.join(", ")}`);
        score += matchedReferences.length * 12;
      }

      if (matchedScopeBindings.length > 0) {
        reasons.push(`scope bindings matched: ${matchedScopeBindings.join(", ")}`);
        score += matchedScopeBindings.length * 8;
      }

      if (matchedExports.length > 0) {
        reasons.push(`exports matched: ${matchedExports.join(", ")}`);
        score += matchedExports.length * 12;
      }

      if (matchedLinks.length > 0) {
        reasons.push(`symbol links matched: ${matchedLinks.join(", ")}`);
        score += matchedLinks.length * 14;
      }

      if (matchedCalls.length > 0) {
        reasons.push(`symbol calls matched: ${matchedCalls.join(", ")}`);
        score += matchedCalls.length * 16;
      }

      if (matchedUsageHints.length > 0) {
        reasons.push(`usage graph matched: ${matchedUsageHints.join(", ")}`);
        score += matchedUsageHints.length * 14;
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
        matched_core_symbols_json: jsonValue(matchedCoreSymbols),
        matched_namespaces_json: jsonValue(matchedNamespaces),
        matched_exports_json: jsonValue(matchedExports),
        matched_calls_json: jsonValue(matchedCalls),
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

  public async listExportBindings(filePath?: string): Promise<Array<ExportBinding & { filePath: string }>> {
    await this.ensureReady();
    const whereClause = filePath ? `WHERE eb.file_path = ${toSqlLiteral(normalizePath(filePath))}` : "";
    const rows = await querySqlite(
      this.dbPath,
      `
        SELECT
          eb.file_path,
          eb.exported_name,
          eb.local_name,
          eb.source_specifier,
          eb.kind,
          eb.line
        FROM export_bindings eb
        ${whereClause}
        ORDER BY eb.file_path, eb.line, eb.exported_name, eb.local_name, eb.source_specifier;
      `
    );

    return rows.map(mapStoredExportBinding);
  }

  public async listNamespaceSymbolNodes(filePath?: string): Promise<NamespaceSymbolNode[]> {
    await this.ensureReady();
    const whereClause = filePath ? `WHERE nsn.file_path = ${toSqlLiteral(normalizePath(filePath))}` : "";
    const rows = await querySqlite(
      this.dbPath,
      `
        SELECT
          nsn.file_path,
          nsn.path,
          nsn.kind,
          nsn.line,
          nsn.parent_path,
          nsn.local_name,
          nsn.source_specifier,
          nsn.export_kind
        FROM namespace_symbol_nodes nsn
        ${whereClause}
        ORDER BY nsn.file_path, nsn.path, nsn.kind, nsn.line;
      `
    );

    return rows.map(mapStoredNamespaceNode);
  }

  public async listNamespaceSymbolEdges(filePath?: string): Promise<NamespaceSymbolEdge[]> {
    await this.ensureReady();
    const whereClause = filePath ? `WHERE nse.file_path = ${toSqlLiteral(normalizePath(filePath))}` : "";
    const rows = await querySqlite(
      this.dbPath,
      `
        SELECT
          nse.file_path,
          nse.from_path,
          nse.to_path,
          nse.kind,
          nse.line,
          nse.target_symbol_name,
          nse.target_specifier,
          nse.evidence_json
        FROM namespace_symbol_edges nse
        ${whereClause}
        ORDER BY nse.file_path, nse.from_path, nse.to_path, nse.kind, nse.line;
      `
    );

    return rows.map(mapStoredNamespaceEdge);
  }

  public async listSymbolRankings(filePath?: string): Promise<SymbolCentralityScore[]> {
    await this.ensureReady();
    const whereClause = filePath ? `WHERE sr.file_path = ${toSqlLiteral(normalizePath(filePath))}` : "";
    const rows = await querySqlite(
      this.dbPath,
      `
        SELECT
          sr.symbol_id,
          sr.file_path,
          sr.symbol_name,
          sr.symbol_kind,
          sr.score,
          sr.normalized_score,
          sr.incoming_reference_count,
          sr.incoming_call_count,
          sr.outgoing_call_count,
          sr.namespace_export_count,
          sr.evidence_json
        FROM symbol_rankings sr
        ${whereClause}
        ORDER BY sr.score DESC, sr.file_path, sr.symbol_name;
      `
    );

    return rows.map(mapStoredSymbolRanking);
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

  public async listScopeBindings(filePath?: string): Promise<Array<ScopeBinding & { filePath: string }>> {
    await this.ensureReady();
    const whereClause = filePath ? `WHERE sb.file_path = ${toSqlLiteral(normalizePath(filePath))}` : "";
    const rows = await querySqlite(
      this.dbPath,
      `
        SELECT
          sb.file_path,
          sb.name,
          sb.kind,
          sb.line,
          sb.scope_start_line,
          sb.scope_end_line,
          sb.container_name,
          sb.type_name,
          sb.source_specifier,
          sb.imported_name,
          sb.symbol_kind,
          sb.evidence
        FROM scope_bindings sb
        ${whereClause}
        ORDER BY sb.file_path, sb.line, sb.kind, sb.name;
      `
    );

    return rows.map(mapStoredScopeBinding);
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

  public async listSymbolCalls(filePath?: string): Promise<SymbolCallEdge[]> {
    await this.ensureReady();
    const whereClause = filePath ? `WHERE sc.caller_file_path = ${toSqlLiteral(normalizePath(filePath))}` : "";
    const rows = await querySqlite(
      this.dbPath,
      `
        SELECT
          sc.caller_file_path,
          sc.caller_symbol_name,
          sc.caller_symbol_kind,
          sc.caller_symbol_id,
          sc.caller_line,
          sc.callee_file_path,
          sc.callee_symbol_name,
          sc.callee_symbol_kind,
          sc.callee_symbol_id,
          sc.callee_specifier,
          sc.reference_kind,
          sc.resolution,
          sc.confidence,
          sc.evidence_json
        FROM symbol_calls sc
        ${whereClause}
        ORDER BY sc.caller_file_path, sc.caller_line, sc.caller_symbol_name, sc.callee_symbol_name, sc.callee_file_path, sc.callee_specifier;
      `
    );

    return rows.map(mapStoredCall);
  }

  public async listSymbolReferenceEdges(filePath?: string): Promise<SymbolReferenceEdge[]> {
    await this.ensureReady();
    const whereClause = filePath ? `WHERE sre.source_file_path = ${toSqlLiteral(normalizePath(filePath))}` : "";
    const rows = await querySqlite(
      this.dbPath,
      `
        SELECT
          sre.source_file_path,
          sre.source_symbol_name,
          sre.source_symbol_kind,
          sre.source_symbol_id,
          sre.source_line,
          sre.source_reference_name,
          sre.source_reference_kind,
          sre.source_qualifier,
          sre.target_file_path,
          sre.target_symbol_name,
          sre.target_symbol_kind,
          sre.target_symbol_id,
          sre.target_specifier,
          sre.resolution,
          sre.confidence,
          sre.evidence_json
        FROM symbol_reference_edges sre
        ${whereClause}
        ORDER BY sre.source_file_path, sre.source_line, sre.source_symbol_name, sre.source_reference_name, sre.target_symbol_id, sre.target_specifier;
      `
    );

    return rows.map(mapStoredReferenceEdge);
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

  private async getMetadataValue(key: string): Promise<string | undefined> {
    const rows = await querySqlite(
      this.dbPath,
      `
        SELECT value
        FROM repository_metadata
        WHERE key = ${toSqlLiteral(key)}
        LIMIT 1;
      `
    );
    return rows[0]?.value === undefined || rows[0]?.value === null ? undefined : String(rows[0].value);
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
    const existingReferenceEdgeCount = await this.countRows("symbol_reference_edges");
    const existingNamespaceNodeCount = await this.countRows("namespace_symbol_nodes");
    const existingNamespaceEdgeCount = await this.countRows("namespace_symbol_edges");
    const existingScopeBindingCount = await this.countRows("scope_bindings");
    const existingSymbolLinkCount = await this.countRows("symbol_links");
    const existingSymbolCallCount = await this.countRows("symbol_calls");
    const existingStructureIndexVersion = await this.getMetadataValue("structure_index_version");
    const removedPaths = [...existingPaths].filter((filePath) => !currentPaths.has(filePath)).sort((left, right) =>
      left.localeCompare(right)
    );

    const projectDetection = await detectProject(scanResult.root, scanResult.files);
    const fileMap = generateFileMap(scanResult);
    const knowledgeResult = await matchKnowledge(scanResult);
    const structureBackfillNeeded =
      scanResult.files.length > 0 &&
      (existingReferenceCount === 0 ||
        existingReferenceEdgeCount === 0 ||
        existingNamespaceNodeCount === 0 ||
        existingNamespaceEdgeCount === 0 ||
        existingScopeBindingCount === 0 ||
        existingSymbolLinkCount === 0 ||
        existingSymbolCallCount === 0 ||
        existingStructureIndexVersion !== STRUCTURE_INDEX_VERSION);
    const structureChanged = changedPaths.length > 0 || removedPaths.length > 0 || structureBackfillNeeded;
    const symbolResult = structureChanged
      ? await extractRepositorySymbols(scanResult)
      : {
          root: scanResult.root,
          files: [] as FileAnalysis[],
          namespaces: { root: scanResult.root, nodes: [] as NamespaceSymbolNode[], edges: [] as NamespaceSymbolEdge[], diagnostics: [] },
          coreSymbols: { root: scanResult.root, rankings: [] as SymbolCentralityScore[], diagnostics: [] },
          links: [] as SymbolLink[],
          referenceEdges: [] as SymbolReferenceEdge[],
          calls: [] as SymbolCallEdge[],
          diagnostics: []
        };
    const dependencyGraph = structureChanged
      ? buildDependencyGraph(scanResult.root, symbolResult.files)
      : { root: scanResult.root, nodes: [], edges: [] as DependencyGraphEdge[], diagnostics: [] };
    const symbolLinkGraph = structureChanged
      ? buildSymbolLinks(scanResult.root, symbolResult.files, dependencyGraph, symbolResult.namespaces)
      : { root: scanResult.root, links: [] as SymbolLink[], diagnostics: [] };
    const previousProjectDetection = await this.getProjectDetection();
    const timestamp = nowIso();
    const projectChanged = !isProjectDetectionEqual(previousProjectDetection, projectDetection);

    const fileRolesByPath = new Map(fileMap.files.map((file) => [file.path, file]));
    const analysesByPath = new Map(symbolResult.files.map((analysis) => [analysis.filePath, analysis]));
    const symbolRankingsByPath = new Map<string, SymbolCentralityScore[]>();
    const namespaceNodesByPath = new Map<string, NamespaceSymbolNode[]>();
    const namespaceEdgesByPath = new Map<string, NamespaceSymbolEdge[]>();
    const exportBindingsByPath = new Map<string, ExportBinding[]>();
    const referencesByPath = new Map<string, SymbolReference[]>();
    const linksByPath = new Map<string, SymbolLink[]>();
    const referenceEdgesByPath = new Map<string, SymbolReferenceEdge[]>();
    const scopeBindingsByPath = new Map<string, ScopeBinding[]>();
    const callsByPath = new Map<string, SymbolCallEdge[]>();
    const dependenciesByPath = new Map<string, DependencyGraphEdge[]>();
    for (const analysis of symbolResult.files) {
      exportBindingsByPath.set(analysis.filePath, analysis.exportBindings);
      referencesByPath.set(analysis.filePath, analysis.references);
      scopeBindingsByPath.set(analysis.filePath, analysis.scopeBindings);
    }
    for (const node of symbolResult.namespaces.nodes) {
      const bucket = namespaceNodesByPath.get(node.filePath) ?? [];
      bucket.push(node);
      namespaceNodesByPath.set(node.filePath, bucket);
    }
    for (const edge of symbolResult.namespaces.edges) {
      const bucket = namespaceEdgesByPath.get(edge.filePath) ?? [];
      bucket.push(edge);
      namespaceEdgesByPath.set(edge.filePath, bucket);
    }
    for (const ranking of symbolResult.coreSymbols.rankings) {
      const bucket = symbolRankingsByPath.get(ranking.filePath) ?? [];
      bucket.push(ranking);
      symbolRankingsByPath.set(ranking.filePath, bucket);
    }
    for (const link of symbolLinkGraph.links) {
      const bucket = linksByPath.get(link.sourceFilePath) ?? [];
      bucket.push(link);
      linksByPath.set(link.sourceFilePath, bucket);
    }
    for (const referenceEdge of symbolResult.referenceEdges) {
      const bucket = referenceEdgesByPath.get(referenceEdge.sourceFilePath) ?? [];
      bucket.push(referenceEdge);
      referenceEdgesByPath.set(referenceEdge.sourceFilePath, bucket);
    }
    for (const call of symbolResult.calls) {
      const bucket = callsByPath.get(call.callerFilePath) ?? [];
      bucket.push(call);
      callsByPath.set(call.callerFilePath, bucket);
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
      sqlStatements.push(`DELETE FROM symbol_rankings WHERE file_path = ${toSqlLiteral(removedPath)};`);
      sqlStatements.push(`DELETE FROM namespace_symbol_nodes WHERE file_path = ${toSqlLiteral(removedPath)};`);
      sqlStatements.push(`DELETE FROM namespace_symbol_edges WHERE file_path = ${toSqlLiteral(removedPath)};`);
      sqlStatements.push(`DELETE FROM export_bindings WHERE file_path = ${toSqlLiteral(removedPath)};`);
      sqlStatements.push(`DELETE FROM symbol_references WHERE file_path = ${toSqlLiteral(removedPath)};`);
      sqlStatements.push(`DELETE FROM scope_bindings WHERE file_path = ${toSqlLiteral(removedPath)};`);
      sqlStatements.push(`DELETE FROM symbol_links WHERE source_file_path = ${toSqlLiteral(removedPath)};`);
      sqlStatements.push(`DELETE FROM symbol_reference_edges WHERE source_file_path = ${toSqlLiteral(removedPath)};`);
      sqlStatements.push(`DELETE FROM symbol_calls WHERE caller_file_path = ${toSqlLiteral(removedPath)};`);
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
      const namespaceNodes = namespaceNodesByPath.get(filePath) ?? [];
      const namespaceEdges = namespaceEdgesByPath.get(filePath) ?? [];
      const exportBindings = exportBindingsByPath.get(filePath) ?? [];
      const references = referencesByPath.get(filePath) ?? [];
      const scopeBindings = scopeBindingsByPath.get(filePath) ?? [];
      const links = linksByPath.get(filePath) ?? [];
      const referenceEdges = referenceEdgesByPath.get(filePath) ?? [];
      const calls = callsByPath.get(filePath) ?? [];
      const dependencies = dependenciesByPath.get(filePath) ?? [];
      sqlStatements.push(`DELETE FROM symbols WHERE file_path = ${toSqlLiteral(filePath)};`);
      sqlStatements.push(`DELETE FROM symbol_rankings WHERE file_path = ${toSqlLiteral(filePath)};`);
      sqlStatements.push(`DELETE FROM namespace_symbol_nodes WHERE file_path = ${toSqlLiteral(filePath)};`);
      sqlStatements.push(`DELETE FROM namespace_symbol_edges WHERE file_path = ${toSqlLiteral(filePath)};`);
      sqlStatements.push(`DELETE FROM export_bindings WHERE file_path = ${toSqlLiteral(filePath)};`);
      sqlStatements.push(`DELETE FROM symbol_references WHERE file_path = ${toSqlLiteral(filePath)};`);
      sqlStatements.push(`DELETE FROM scope_bindings WHERE file_path = ${toSqlLiteral(filePath)};`);
      sqlStatements.push(`DELETE FROM symbol_links WHERE source_file_path = ${toSqlLiteral(filePath)};`);
      sqlStatements.push(`DELETE FROM symbol_reference_edges WHERE source_file_path = ${toSqlLiteral(filePath)};`);
      sqlStatements.push(`DELETE FROM symbol_calls WHERE caller_file_path = ${toSqlLiteral(filePath)};`);
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

      for (const ranking of symbolRankingsByPath.get(filePath) ?? []) {
        sqlStatements.push(
          `
            INSERT INTO symbol_rankings(
              symbol_id,
              file_path,
              symbol_name,
              symbol_kind,
              score,
              normalized_score,
              incoming_reference_count,
              incoming_call_count,
              outgoing_call_count,
              namespace_export_count,
              evidence_json,
              updated_at
            )
            VALUES (
              ${toSqlLiteral(ranking.symbolId)},
              ${toSqlLiteral(filePath)},
              ${toSqlLiteral(ranking.symbolName)},
              ${toSqlLiteral(ranking.symbolKind)},
              ${ranking.score},
              ${ranking.normalizedScore},
              ${ranking.incomingReferenceCount},
              ${ranking.incomingCallCount},
              ${ranking.outgoingCallCount},
              ${ranking.namespaceExportCount},
              ${toSqlLiteral(jsonValue(ranking.evidence))},
              ${toSqlLiteral(timestamp)}
            );
          `
        );
      }

      for (const namespaceNode of namespaceNodes) {
        sqlStatements.push(
          `
            INSERT INTO namespace_symbol_nodes(
              file_path,
              path,
              kind,
              line,
              parent_path,
              local_name,
              source_specifier,
              export_kind,
              updated_at
            )
            VALUES (
              ${toSqlLiteral(filePath)},
              ${toSqlLiteral(namespaceNode.path)},
              ${toSqlLiteral(namespaceNode.kind)},
              ${namespaceNode.line},
              ${namespaceNode.parentPath ? toSqlLiteral(namespaceNode.parentPath) : "NULL"},
              ${namespaceNode.localName ? toSqlLiteral(namespaceNode.localName) : "NULL"},
              ${namespaceNode.sourceSpecifier ? toSqlLiteral(namespaceNode.sourceSpecifier) : "NULL"},
              ${namespaceNode.exportKind ? toSqlLiteral(namespaceNode.exportKind) : "NULL"},
              ${toSqlLiteral(timestamp)}
            );
          `
        );
      }

      for (const namespaceEdge of namespaceEdges) {
        sqlStatements.push(
          `
            INSERT INTO namespace_symbol_edges(
              file_path,
              from_path,
              to_path,
              kind,
              line,
              target_symbol_name,
              target_specifier,
              evidence_json,
              updated_at
            )
            VALUES (
              ${toSqlLiteral(filePath)},
              ${toSqlLiteral(namespaceEdge.fromPath)},
              ${toSqlLiteral(namespaceEdge.toPath)},
              ${toSqlLiteral(namespaceEdge.kind)},
              ${namespaceEdge.line},
              ${namespaceEdge.targetSymbolName ? toSqlLiteral(namespaceEdge.targetSymbolName) : "NULL"},
              ${namespaceEdge.targetSpecifier ? toSqlLiteral(namespaceEdge.targetSpecifier) : "NULL"},
              ${toSqlLiteral(jsonValue(namespaceEdge.evidence))},
              ${toSqlLiteral(timestamp)}
            );
          `
        );
      }

      for (const exportBinding of exportBindings) {
        sqlStatements.push(
          `
            INSERT INTO export_bindings(file_path, exported_name, local_name, source_specifier, kind, line, updated_at)
            VALUES (
              ${toSqlLiteral(filePath)},
              ${toSqlLiteral(exportBinding.exportedName)},
              ${exportBinding.localName ? toSqlLiteral(exportBinding.localName) : "NULL"},
              ${exportBinding.sourceSpecifier ? toSqlLiteral(exportBinding.sourceSpecifier) : "NULL"},
              ${toSqlLiteral(exportBinding.kind)},
              ${exportBinding.line},
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

      for (const scopeBinding of scopeBindings) {
        sqlStatements.push(
          `
            INSERT INTO scope_bindings(
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
              evidence,
              updated_at
            )
            VALUES (
              ${toSqlLiteral(filePath)},
              ${toSqlLiteral(scopeBinding.name)},
              ${toSqlLiteral(scopeBinding.kind)},
              ${scopeBinding.line},
              ${scopeBinding.scopeStartLine},
              ${scopeBinding.scopeEndLine},
              ${scopeBinding.containerName ? toSqlLiteral(scopeBinding.containerName) : "NULL"},
              ${scopeBinding.typeName ? toSqlLiteral(scopeBinding.typeName) : "NULL"},
              ${scopeBinding.sourceSpecifier ? toSqlLiteral(scopeBinding.sourceSpecifier) : "NULL"},
              ${scopeBinding.importedName ? toSqlLiteral(scopeBinding.importedName) : "NULL"},
              ${scopeBinding.symbolKind ? toSqlLiteral(scopeBinding.symbolKind) : "NULL"},
              ${toSqlLiteral(scopeBinding.evidence)},
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

      for (const referenceEdge of referenceEdges) {
        sqlStatements.push(
          `
            INSERT INTO symbol_reference_edges(
              source_file_path,
              source_symbol_name,
              source_symbol_kind,
              source_symbol_id,
              source_line,
              source_reference_name,
              source_reference_kind,
              source_qualifier,
              target_file_path,
              target_symbol_name,
              target_symbol_kind,
              target_symbol_id,
              target_specifier,
              resolution,
              confidence,
              evidence_json,
              updated_at
            )
            VALUES (
              ${toSqlLiteral(filePath)},
              ${toSqlLiteral(referenceEdge.sourceSymbolName)},
              ${toSqlLiteral(referenceEdge.sourceSymbolKind)},
              ${toSqlLiteral(referenceEdge.sourceSymbolId)},
              ${referenceEdge.sourceLine},
              ${toSqlLiteral(referenceEdge.sourceReferenceName)},
              ${toSqlLiteral(referenceEdge.sourceReferenceKind)},
              ${referenceEdge.sourceQualifier ? toSqlLiteral(referenceEdge.sourceQualifier) : "NULL"},
              ${referenceEdge.targetFilePath ? toSqlLiteral(referenceEdge.targetFilePath) : "NULL"},
              ${referenceEdge.targetSymbolName ? toSqlLiteral(referenceEdge.targetSymbolName) : "NULL"},
              ${referenceEdge.targetSymbolKind ? toSqlLiteral(referenceEdge.targetSymbolKind) : "NULL"},
              ${referenceEdge.targetSymbolId ? toSqlLiteral(referenceEdge.targetSymbolId) : "NULL"},
              ${referenceEdge.targetSpecifier ? toSqlLiteral(referenceEdge.targetSpecifier) : "NULL"},
              ${toSqlLiteral(referenceEdge.resolution)},
              ${referenceEdge.confidence},
              ${toSqlLiteral(jsonValue(referenceEdge.evidence))},
              ${toSqlLiteral(timestamp)}
            );
          `
        );
      }

      for (const call of calls) {
        sqlStatements.push(
          `
            INSERT INTO symbol_calls(
              caller_file_path,
              caller_symbol_name,
              caller_symbol_kind,
              caller_symbol_id,
              caller_line,
              callee_file_path,
              callee_symbol_name,
              callee_symbol_kind,
              callee_symbol_id,
              callee_specifier,
              reference_kind,
              resolution,
              confidence,
              evidence_json,
              updated_at
            )
            VALUES (
              ${toSqlLiteral(filePath)},
              ${toSqlLiteral(call.callerSymbolName)},
              ${toSqlLiteral(call.callerSymbolKind)},
              ${toSqlLiteral(call.callerSymbolId)},
              ${call.callerLine},
              ${call.calleeFilePath ? toSqlLiteral(call.calleeFilePath) : "NULL"},
              ${toSqlLiteral(call.calleeSymbolName)},
              ${call.calleeSymbolKind ? toSqlLiteral(call.calleeSymbolKind) : "NULL"},
              ${call.calleeSymbolId ? toSqlLiteral(call.calleeSymbolId) : "NULL"},
              ${call.calleeSpecifier ? toSqlLiteral(call.calleeSpecifier) : "NULL"},
              ${toSqlLiteral(call.referenceKind)},
              ${toSqlLiteral(call.resolution)},
              ${call.confidence},
              ${toSqlLiteral(jsonValue(call.evidence))},
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
      const symbolRankings = symbolRankingsByPath.get(filePath) ?? [];
      const namespaceNodes = namespaceNodesByPath.get(filePath) ?? [];
      const namespaceEdges = namespaceEdgesByPath.get(filePath) ?? [];
      const exportBindings = exportBindingsByPath.get(filePath) ?? [];
      const scopeBindings = scopeBindingsByPath.get(filePath) ?? [];
      const references = referencesByPath.get(filePath) ?? [];
      const referenceEdges = referenceEdgesByPath.get(filePath) ?? [];
      const links = linksByPath.get(filePath) ?? [];
      const calls = callsByPath.get(filePath) ?? [];
      const dependencies = dependenciesByPath.get(filePath) ?? [];
      const searchText = buildSearchText(
        file,
        role,
        matches,
        analysis?.symbols ?? [],
        symbolRankings,
        namespaceNodes,
        namespaceEdges,
        exportBindings,
        scopeBindings,
        dependencies,
        references,
        referenceEdges,
        links,
        calls
      );

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
          ('last_indexed_at', ${toSqlLiteral(timestamp)}, ${toSqlLiteral(timestamp)}),
          ('structure_index_version', ${toSqlLiteral(STRUCTURE_INDEX_VERSION)}, ${toSqlLiteral(timestamp)})
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at;
      `
    );

    sqlStatements.push("COMMIT;");
    await executeSqlite(this.dbPath, sqlStatements.join("\n"));

    const persistedSymbolCount = await this.countRows("symbols");
    const persistedCoreSymbolCount = await this.countRows("symbol_rankings");
    const persistedReferenceCount = await this.countRows("symbol_references");
    const persistedNamespaceNodeCount = await this.countRows("namespace_symbol_nodes");
    const persistedNamespaceEdgeCount = await this.countRows("namespace_symbol_edges");
    const persistedScopeBindingCount = await this.countRows("scope_bindings");
    const persistedSymbolLinkCount = await this.countRows("symbol_links");
    const persistedSymbolCallCount = await this.countRows("symbol_calls");
    const persistedDependencyCount = await this.countRows("dependencies");

    return {
      root: this.root,
      dbPath: this.dbPath,
      totalFiles: scanResult.files.length,
      changedFiles: changedPaths.length,
      removedFiles: removedPaths.length,
      knowledgeMatchCount: knowledgeResult.matches.length,
      symbolCount: persistedSymbolCount,
      coreSymbolCount: persistedCoreSymbolCount,
      referenceCount: persistedReferenceCount,
      namespaceNodeCount: persistedNamespaceNodeCount,
      namespaceEdgeCount: persistedNamespaceEdgeCount,
      scopeBindingCount: persistedScopeBindingCount,
      symbolLinkCount: persistedSymbolLinkCount,
      symbolCallCount: persistedSymbolCallCount,
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

export async function listExportBindings(
  rootPath: string,
  filePath?: string
): Promise<Array<ExportBinding & { filePath: string }>> {
  const store = await createIndexStore(rootPath);
  return store.listExportBindings(filePath);
}

export async function listNamespaceSymbolNodes(
  rootPath: string,
  filePath?: string
): Promise<NamespaceSymbolNode[]> {
  const store = await createIndexStore(rootPath);
  return store.listNamespaceSymbolNodes(filePath);
}

export async function listNamespaceSymbolEdges(
  rootPath: string,
  filePath?: string
): Promise<NamespaceSymbolEdge[]> {
  const store = await createIndexStore(rootPath);
  return store.listNamespaceSymbolEdges(filePath);
}

export async function listSymbolRankings(
  rootPath: string,
  filePath?: string
): Promise<SymbolCentralityScore[]> {
  const store = await createIndexStore(rootPath);
  return store.listSymbolRankings(filePath);
}

export async function listSymbolReferences(
  rootPath: string,
  filePath?: string
): Promise<Array<SymbolReference & { filePath: string }>> {
  const store = await createIndexStore(rootPath);
  return store.listSymbolReferences(filePath);
}

export async function listScopeBindings(
  rootPath: string,
  filePath?: string
): Promise<Array<ScopeBinding & { filePath: string }>> {
  const store = await createIndexStore(rootPath);
  return store.listScopeBindings(filePath);
}

export async function listSymbolLinks(rootPath: string, filePath?: string): Promise<SymbolLink[]> {
  const store = await createIndexStore(rootPath);
  return store.listSymbolLinks(filePath);
}

export async function listSymbolCalls(rootPath: string, filePath?: string): Promise<SymbolCallEdge[]> {
  const store = await createIndexStore(rootPath);
  return store.listSymbolCalls(filePath);
}

export async function listSymbolReferenceEdges(rootPath: string, filePath?: string): Promise<SymbolReferenceEdge[]> {
  const store = await createIndexStore(rootPath);
  return store.listSymbolReferenceEdges(filePath);
}

export async function listDependencies(
  rootPath: string,
  filePath?: string
): Promise<Array<DependencyGraphEdge & { isInternal: boolean }>> {
  const store = await createIndexStore(rootPath);
  return store.listDependencies(filePath);
}
