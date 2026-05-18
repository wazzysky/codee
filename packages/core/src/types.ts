export type DiagnosticLevel = "info" | "warning" | "error";

export interface Diagnostic {
  level: DiagnosticLevel;
  message: string;
  path?: string;
}

export interface RepoFile {
  path: string;
  absPath: string;
  language: string;
  size: number;
  lineCount: number;
  hash: string;
}

export interface ScanOptions {
  ignore?: string[];
}

export interface ScanResult {
  root: string;
  files: RepoFile[];
  languageStats: Record<string, number>;
  diagnostics: Diagnostic[];
}

export interface ProjectDetection {
  projectTypes: string[];
  languages: string[];
  frameworks: string[];
  buildTools: string[];
  generatedBy: string[];
  entryCandidates: string[];
  confidence: number;
  evidence: string[];
  uncertainties: string[];
}

export type FileRole =
  | "entrypoint"
  | "config"
  | "test"
  | "source"
  | "component"
  | "utility"
  | "documentation"
  | "build"
  | "script"
  | "asset"
  | "generated"
  | "unknown";

export interface FileMapFile {
  path: string;
  directory: string;
  role: FileRole;
  explanation: string;
  confidence: number;
  important: boolean;
  language: string;
}

export interface DirectorySummary {
  path: string;
  description: string;
  fileCount: number;
  roles: Partial<Record<FileRole, number>>;
  files: FileMapFile[];
}

export interface FileMap {
  root: string;
  directories: DirectorySummary[];
  files: FileMapFile[];
  importantFiles: FileMapFile[];
  uncertainties: string[];
}

export interface KnowledgeMatch {
  filePath: string;
  knowledgeId: string;
  name: string;
  domain: string;
  confidence: number;
  evidence: string[];
}

export interface KnowledgeOptions {
  maxFileSizeBytes?: number;
}

export interface KnowledgeResult {
  root: string;
  matches: KnowledgeMatch[];
  diagnostics: Diagnostic[];
}

export interface LlmTextRequest {
  systemPrompt?: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LlmTextResponse {
  text: string;
  model: string;
  raw?: unknown;
}

export interface LlmJsonRequest<T> extends LlmTextRequest {
  schema: {
    parse: (input: unknown) => T;
  };
}

export interface LlmClient {
  completeText(request: LlmTextRequest): Promise<LlmTextResponse>;
  completeJson<T>(request: LlmJsonRequest<T>): Promise<T>;
}

export type ExplainMode = "rule-based" | "ai";

export interface FileExplanation {
  filePath: string;
  repoRoot: string;
  mode: ExplainMode;
  summary: string;
  role: FileRole;
  keyEvidence: string[];
  possibleKnowledgePoints: string[];
  confidence: number;
  uncertainties: string[];
  diagnostics: Diagnostic[];
}

export interface ExplainFileOptions {
  useAi?: boolean;
  llmClient?: LlmClient;
  env?: NodeJS.ProcessEnv;
  maxLlmFileSizeBytes?: number;
}

export interface IndexedFileRecord {
  path: string;
  absPath: string;
  language: string;
  size: number;
  lineCount: number;
  hash: string;
  role?: string;
  explanation?: string;
  confidence?: number;
  important?: boolean;
}

export interface FileSearchResult {
  path: string;
  filePath: string;
  language: string;
  role?: string;
  explanation?: string;
  score: number;
  confidence: number;
  reasons: string[];
  symbolNames: string[];
  knowledgeNames: string[];
  importSpecifiers: string[];
  matchedSymbols: string[];
  matchedKnowledge: string[];
  matchedImports: string[];
  matchedNamespaces: string[];
  matchedExports: string[];
  matchedCalls: string[];
  matchedCoreSymbols: string[];
  dependencyHints: string[];
  matchedReferences: string[];
  matchedLinks: string[];
}

export interface IndexSummary {
  root: string;
  dbPath: string;
  totalFiles: number;
  changedFiles: number;
  removedFiles: number;
  knowledgeMatchCount: number;
  symbolCount: number;
  referenceCount: number;
  namespaceNodeCount: number;
  namespaceEdgeCount: number;
  coreSymbolCount: number;
  scopeBindingCount: number;
  symbolLinkCount: number;
  symbolCallCount: number;
  dependencyCount: number;
  diagnosticCount: number;
  projectTypes: string[];
}

export type SymbolKind = "function" | "class" | "method" | "component" | "type";
export type SymbolReferenceKind = "call" | "new" | "component" | "type";
export type ImportBindingKind = "default" | "named" | "namespace" | "module";
export type ExportBindingKind = "default" | "named" | "all" | "namespace";
export type ScopeBindingKind =
  | "symbol"
  | "import"
  | "module"
  | "parameter"
  | "variable"
  | "implicit-this"
  | "implicit-self";
export type DependencyKind = "import" | "include";
export type DependencyResolution = "internal" | "external" | "unresolved";
export type SymbolLinkResolution = "local" | "internal" | "external" | "global" | "unresolved";
export type NamespaceSymbolNodeKind = "namespace" | "export";
export type NamespaceSymbolEdgeKind = "contains" | "resolves-to";

export interface SymbolDefinition {
  name: string;
  kind: SymbolKind;
  startLine: number;
  endLine: number;
  containerName?: string;
  signature?: string;
}

export interface ImportReference {
  specifier: string;
  kind: DependencyKind;
  line: number;
  isInternal: boolean;
  targetPath?: string;
  resolution: DependencyResolution;
  confidence: number;
  evidence: string[];
}

export interface ImportBinding {
  localName: string;
  importedName?: string;
  sourceSpecifier: string;
  kind: ImportBindingKind;
  line: number;
}

export interface ExportBinding {
  exportedName: string;
  localName?: string;
  sourceSpecifier?: string;
  kind: ExportBindingKind;
  line: number;
}

export interface VariableTypeHint {
  name: string;
  typeName: string;
  line: number;
  evidence: string;
}

export interface ScopeBinding {
  name: string;
  kind: ScopeBindingKind;
  line: number;
  scopeStartLine: number;
  scopeEndLine: number;
  containerName?: string;
  typeName?: string;
  sourceSpecifier?: string;
  importedName?: string;
  symbolKind?: SymbolKind;
  evidence: string;
}

export interface EntryHint {
  kind: string;
  line: number;
  symbolName?: string;
  evidence: string;
}

export interface SymbolReference {
  name: string;
  kind: SymbolReferenceKind;
  line: number;
  qualifier?: string;
  containerName?: string;
  evidence: string;
}

export interface SymbolLink {
  sourceFilePath: string;
  sourceReferenceName: string;
  sourceReferenceKind: SymbolReferenceKind;
  sourceLine: number;
  sourceQualifier?: string;
  targetFilePath?: string;
  targetSymbolName?: string;
  targetSymbolKind?: SymbolKind;
  targetSpecifier?: string;
  resolution: SymbolLinkResolution;
  confidence: number;
  evidence: string[];
}

export interface SymbolLinkGraph {
  root: string;
  links: SymbolLink[];
  diagnostics: Diagnostic[];
}

export interface SymbolReferenceEdge {
  sourceFilePath: string;
  sourceSymbolName: string;
  sourceSymbolKind: SymbolKind;
  sourceSymbolId: string;
  sourceLine: number;
  sourceReferenceName: string;
  sourceReferenceKind: SymbolReferenceKind;
  sourceQualifier?: string;
  targetFilePath?: string;
  targetSymbolName?: string;
  targetSymbolKind?: SymbolKind;
  targetSymbolId?: string;
  targetSpecifier?: string;
  resolution: SymbolLinkResolution;
  confidence: number;
  evidence: string[];
}

export interface SymbolReferenceGraph {
  root: string;
  edges: SymbolReferenceEdge[];
  diagnostics: Diagnostic[];
}

export interface SymbolCallEdge {
  callerFilePath: string;
  callerSymbolName: string;
  callerSymbolKind: SymbolKind;
  callerSymbolId: string;
  callerLine: number;
  calleeFilePath?: string;
  calleeSymbolName: string;
  calleeSymbolKind?: SymbolKind;
  calleeSymbolId?: string;
  calleeSpecifier?: string;
  referenceKind: Exclude<SymbolReferenceKind, "type">;
  resolution: SymbolLinkResolution;
  confidence: number;
  evidence: string[];
}

export interface SymbolCallGraph {
  root: string;
  calls: SymbolCallEdge[];
  diagnostics: Diagnostic[];
}

export interface SymbolCentralityScore {
  symbolId: string;
  filePath: string;
  symbolName: string;
  symbolKind: SymbolKind;
  score: number;
  normalizedScore: number;
  incomingReferenceCount: number;
  incomingCallCount: number;
  outgoingCallCount: number;
  namespaceExportCount: number;
  evidence: string[];
}

export interface SymbolCentralityGraph {
  root: string;
  rankings: SymbolCentralityScore[];
  diagnostics: Diagnostic[];
}

export interface NamespaceSymbolNode {
  filePath: string;
  path: string;
  kind: NamespaceSymbolNodeKind;
  line: number;
  parentPath?: string;
  localName?: string;
  sourceSpecifier?: string;
  exportKind?: ExportBindingKind;
}

export interface NamespaceSymbolEdge {
  filePath: string;
  fromPath: string;
  toPath: string;
  kind: NamespaceSymbolEdgeKind;
  line: number;
  targetSymbolName?: string;
  targetSpecifier?: string;
  evidence: string[];
}

export interface NamespaceSymbolGraph {
  root: string;
  nodes: NamespaceSymbolNode[];
  edges: NamespaceSymbolEdge[];
  diagnostics: Diagnostic[];
}

export interface FileAnalysis {
  filePath: string;
  language: string;
  parser: string;
  symbols: SymbolDefinition[];
  references: SymbolReference[];
  importBindings: ImportBinding[];
  exportBindings: ExportBinding[];
  scopeBindings: ScopeBinding[];
  localTypeHints: VariableTypeHint[];
  imports: ImportReference[];
  entryHints: EntryHint[];
  diagnostics: Diagnostic[];
}

export interface StructureParseInput {
  filePath: string;
  content: string;
  language: string;
}

export interface StructureParser {
  language: string;
  parse(input: StructureParseInput): Promise<FileAnalysis> | FileAnalysis;
}

export interface SymbolExtractionResult {
  root: string;
  files: FileAnalysis[];
  namespaces: NamespaceSymbolGraph;
  links: SymbolLink[];
  referenceEdges: SymbolReferenceEdge[];
  calls: SymbolCallEdge[];
  coreSymbols: SymbolCentralityGraph;
  diagnostics: Diagnostic[];
}

export interface DependencyGraphNode {
  path: string;
  language: string;
}

export interface DependencyGraphEdge {
  sourcePath: string;
  targetPath?: string;
  specifier: string;
  kind: DependencyKind;
  line: number;
  resolution: DependencyResolution;
  from: string;
  to?: string;
  type: DependencyKind;
  resolved: boolean;
  confidence: number;
  evidence: string[];
}

export interface DependencyGraph {
  root: string;
  nodes: DependencyGraphNode[];
  edges: DependencyGraphEdge[];
  diagnostics: Diagnostic[];
}
