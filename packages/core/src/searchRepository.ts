import { promises as fs } from "node:fs";
import path from "node:path";
import { extractRepositorySymbols } from "./analyzeFileStructure.js";
import { buildDependencyGraph } from "./buildDependencyGraph.js";
import { createIndexStore } from "./indexStore.js";
import { generateFileMap } from "./generateFileMap.js";
import { matchKnowledge } from "./matchKnowledge.js";
import { scanRepository } from "./scanRepository.js";
import type {
  ExportBinding,
  DependencyGraphEdge,
  FileAnalysis,
  FileMapFile,
  FileSearchResult,
  KnowledgeMatch,
  NamespaceSymbolEdge,
  NamespaceSymbolNode,
  ScopeBinding,
  SymbolCallEdge,
  SymbolCentralityScore,
  SymbolLink
} from "./types.js";
import type { SymbolReferenceEdge } from "./types.js";

interface SearchContext {
  language: string;
  role?: string;
  explanation?: string;
  symbols: string[];
  symbolKinds: string[];
  coreSymbolRankings: SymbolCentralityScore[];
  namespaces: string[];
  exports: string[];
  scopeBindings: string[];
  references: string[];
  links: string[];
  calls: string[];
  usageHints: string[];
  imports: string[];
  dependencyHints: string[];
  knowledgeNames: string[];
  knowledgeEvidence: string[];
}

function normalizePath(filePath: string): string {
  return path.posix.normalize(filePath.split(path.sep).join(path.posix.sep));
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/iu)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function pushReason(reasons: string[], value: string): void {
  if (!reasons.includes(value)) {
    reasons.push(value);
  }
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function scoreSearchResult(filePath: string, context: SearchContext, query: string): FileSearchResult | undefined {
  const normalizedQuery = query.trim().toLowerCase();
  const tokens = tokenize(normalizedQuery);
  let score = 0;
  const reasons: string[] = [];
  const matchedSymbols = context.symbols.filter((symbol) =>
    tokens.some((token) => symbol.toLowerCase().includes(token))
  );
  const matchedSymbolKinds = context.symbolKinds.filter((kind) =>
    tokens.some((token) => kind.toLowerCase().includes(token))
  );
  const matchedCoreSymbols = uniqueSorted(
    context.coreSymbolRankings
      .filter((ranking) =>
        [ranking.symbolName, ranking.symbolKind, ...ranking.evidence].some((value) =>
          tokens.some((token) => value.toLowerCase().includes(token))
        )
      )
      .map((ranking) => ranking.symbolName)
  );
  const matchedNamespaces = context.namespaces.filter((value) =>
    tokens.some((token) => value.toLowerCase().includes(token))
  );
  const matchedExports = context.exports.filter((value) =>
    tokens.some((token) => value.toLowerCase().includes(token))
  );
  const matchedImports = context.imports.filter((specifier) =>
    tokens.some((token) => specifier.toLowerCase().includes(token))
  );
  const matchedReferences = context.references.filter((reference) =>
    tokens.some((token) => reference.toLowerCase().includes(token))
  );
  const matchedScopeBindings = context.scopeBindings.filter((binding) =>
    tokens.some((token) => binding.toLowerCase().includes(token))
  );
  const matchedLinks = context.links.filter((link) => tokens.some((token) => link.toLowerCase().includes(token)));
  const matchedCalls = context.calls.filter((call) => tokens.some((token) => call.toLowerCase().includes(token)));
  const matchedUsageHints = context.usageHints.filter((hint) => tokens.some((token) => hint.toLowerCase().includes(token)));
  const matchedDependencyHints = context.dependencyHints.filter((hint) =>
    tokens.some((token) => hint.toLowerCase().includes(token))
  );
  const matchedKnowledge = context.knowledgeNames.filter((name) =>
    tokens.some((token) => name.toLowerCase().includes(token))
  );

  const lowerPath = filePath.toLowerCase();
  const lowerRole = (context.role ?? "").toLowerCase();
  if (lowerPath.includes(normalizedQuery)) {
    score += 50;
    pushReason(reasons, `path matches "${query}"`);
  } else {
    const pathTokenHits = tokens.filter((token) => lowerPath.includes(token));
    if (pathTokenHits.length > 0) {
      score += 15 + pathTokenHits.length * 6;
      pushReason(reasons, `path matches tokens: ${pathTokenHits.join(", ")}`);
    }
  }

  if (lowerRole.includes(normalizedQuery) && normalizedQuery.length > 0) {
    score += 18;
    pushReason(reasons, `file role matched: ${context.role}`);
  } else {
    const roleTokenHits = tokens.filter((token) => lowerRole.includes(token));
    if (roleTokenHits.length > 0 && context.role) {
      score += 8 + roleTokenHits.length * 4;
      pushReason(reasons, `file role matched tokens: ${roleTokenHits.join(", ")}`);
    }
  }

  const lowerExplanation = (context.explanation ?? "").toLowerCase();
  if (normalizedQuery.length > 0 && lowerExplanation.includes(normalizedQuery)) {
    score += 28;
    pushReason(reasons, "file explanation matched");
  }

  if (matchedKnowledge.length > 0) {
    score += matchedKnowledge.length * 18;
    pushReason(reasons, `knowledge matched: ${matchedKnowledge.join(", ")}`);
  } else if (
    context.knowledgeEvidence.some((evidence) => tokens.some((token) => evidence.toLowerCase().includes(token)))
  ) {
    score += 14;
    pushReason(reasons, "knowledge evidence matched");
  }

  if (matchedSymbols.length > 0) {
    score += matchedSymbols.length * 20;
    pushReason(reasons, `symbols matched: ${matchedSymbols.join(", ")}`);
  }

  if (matchedSymbolKinds.length > 0) {
    score += matchedSymbolKinds.length * 10;
    pushReason(reasons, `symbol kinds matched: ${matchedSymbolKinds.join(", ")}`);
  }

  if (matchedCoreSymbols.length > 0) {
    score += matchedCoreSymbols.length * 18;
    pushReason(reasons, `core symbols matched: ${matchedCoreSymbols.join(", ")}`);
  }

  if (matchedNamespaces.length > 0) {
    score += matchedNamespaces.length * 13;
    pushReason(reasons, `namespace graph matched: ${matchedNamespaces.join(", ")}`);
  }

  if (matchedReferences.length > 0) {
    score += matchedReferences.length * 12;
    pushReason(reasons, `symbol references matched: ${matchedReferences.join(", ")}`);
  }

  if (matchedScopeBindings.length > 0) {
    score += matchedScopeBindings.length * 8;
    pushReason(reasons, `scope bindings matched: ${matchedScopeBindings.join(", ")}`);
  }

  if (matchedExports.length > 0) {
    score += matchedExports.length * 12;
    pushReason(reasons, `exports matched: ${matchedExports.join(", ")}`);
  }

  if (matchedLinks.length > 0) {
    score += matchedLinks.length * 14;
    pushReason(reasons, `symbol links matched: ${matchedLinks.join(", ")}`);
  }

  if (matchedCalls.length > 0) {
    score += matchedCalls.length * 16;
    pushReason(reasons, `symbol calls matched: ${matchedCalls.join(", ")}`);
  }

  if (matchedUsageHints.length > 0) {
    score += matchedUsageHints.length * 14;
    pushReason(reasons, `usage graph matched: ${matchedUsageHints.join(", ")}`);
  }

  if (matchedImports.length > 0) {
    score += matchedImports.length * 10;
    pushReason(reasons, `imports/includes matched: ${matchedImports.join(", ")}`);
  }

  if (matchedDependencyHints.length > 0) {
    score += matchedDependencyHints.length * 8;
    pushReason(reasons, `dependency graph matched: ${matchedDependencyHints.join(", ")}`);
  }

  if (score === 0) {
    return undefined;
  }

  return {
    path: filePath,
    filePath,
    language: context.language,
    role: context.role,
    explanation: context.explanation,
    score,
    confidence: Number(Math.min(0.99, Math.max(0.2, score / 100)).toFixed(2)),
    reasons,
    symbolNames: uniqueSorted(matchedSymbols),
    knowledgeNames: uniqueSorted(matchedKnowledge),
    importSpecifiers: uniqueSorted(matchedImports),
    matchedSymbols: uniqueSorted(matchedSymbols),
    matchedKnowledge: uniqueSorted(matchedKnowledge),
    matchedImports: uniqueSorted(matchedImports),
    matchedCoreSymbols: uniqueSorted(matchedCoreSymbols),
    matchedNamespaces: uniqueSorted(matchedNamespaces),
    matchedExports: uniqueSorted(matchedExports),
    matchedCalls: uniqueSorted(matchedCalls),
    dependencyHints: uniqueSorted(matchedDependencyHints),
    matchedReferences: uniqueSorted(matchedReferences),
    matchedLinks: uniqueSorted(matchedLinks)
  };
}

function buildContext(
  filePath: string,
  language: string,
  fileRole: FileMapFile | undefined,
  analysis: FileAnalysis | undefined,
  symbolRankings: SymbolCentralityScore[],
  namespaceNodes: NamespaceSymbolNode[],
  namespaceEdges: NamespaceSymbolEdge[],
  exportBindings: ExportBinding[],
  scopeBindings: ScopeBinding[],
  knowledgeMatches: KnowledgeMatch[],
  dependencyEdges: DependencyGraphEdge[],
  symbolLinks: SymbolLink[],
  symbolCalls: SymbolCallEdge[],
  outgoingReferenceEdges: SymbolReferenceEdge[],
  incomingReferenceEdges: SymbolReferenceEdge[]
): SearchContext {
  return {
    language,
    role: fileRole?.role,
    explanation: fileRole?.explanation,
    symbols: analysis?.symbols.map((symbol) => symbol.name) ?? [],
    symbolKinds: analysis?.symbols.map((symbol) => symbol.kind) ?? [],
    coreSymbolRankings: symbolRankings,
    namespaces: [
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
      ])
    ].filter((value) => value.length > 0),
    exports: exportBindings.flatMap((binding) => [
      binding.exportedName,
      binding.localName ?? "",
      binding.sourceSpecifier ?? "",
      binding.kind
    ]).filter((value) => value.length > 0),
    scopeBindings: scopeBindings.flatMap((binding) => [
      binding.name,
      binding.kind,
      binding.typeName ?? "",
      binding.sourceSpecifier ?? "",
      binding.importedName ?? "",
      binding.symbolKind ?? ""
    ]).filter((value) => value.length > 0),
    references: analysis?.references.map((reference) => reference.name) ?? [],
    links: symbolLinks.flatMap((link) => [
      link.sourceReferenceName,
      link.targetSymbolName ?? "",
      link.targetFilePath ?? "",
      link.targetSpecifier ?? "",
      link.resolution,
      ...link.evidence
    ]),
    calls: symbolCalls.flatMap((call) => [
      call.callerSymbolName,
      call.calleeSymbolName,
      call.calleeFilePath ?? "",
      call.calleeSpecifier ?? "",
      call.referenceKind,
      call.resolution,
      ...call.evidence
    ]),
    usageHints: [...outgoingReferenceEdges, ...incomingReferenceEdges].flatMap((edge) => [
      edge.sourceSymbolName,
      edge.sourceReferenceName,
      edge.targetSymbolName ?? "",
      edge.targetFilePath ?? "",
      edge.targetSpecifier ?? "",
      edge.sourceReferenceKind,
      edge.resolution
    ]).filter((value) => value.length > 0),
    imports: dependencyEdges.map((edge) => edge.specifier),
    dependencyHints: dependencyEdges.flatMap((edge) => [edge.targetPath ?? "", edge.specifier, ...edge.evidence]),
    knowledgeNames: knowledgeMatches.map((match) => match.name),
    knowledgeEvidence: knowledgeMatches.flatMap((match) => match.evidence)
  };
}

function sortSearchResults(results: FileSearchResult[]): FileSearchResult[] {
  return results
    .slice()
    .sort((left, right) =>
      left.score === right.score ? left.path.localeCompare(right.path) : right.score - left.score
    );
}

export async function searchRepository(rootPath: string, query: string): Promise<FileSearchResult[]> {
  const resolvedRoot = path.resolve(rootPath);
  const dbPath = path.join(resolvedRoot, ".repolain", "index.sqlite");

  try {
    await fs.access(dbPath);
    const store = await createIndexStore(resolvedRoot);
    if (await store.isStructureIndexCurrent()) {
      return store.searchFiles(query);
    }
  } catch {
    // No persisted index yet; fall back to temporary analysis.
  }

  const scanResult = await scanRepository(resolvedRoot);
  const fileMap = generateFileMap(scanResult);
  const symbolResult = await extractRepositorySymbols(scanResult);
  const dependencyGraph = buildDependencyGraph(scanResult.root, symbolResult.files);
  const knowledgeResult = await matchKnowledge(scanResult);

  const rolesByPath = new Map(fileMap.files.map((file) => [file.path, file]));
  const analysesByPath = new Map(symbolResult.files.map((analysis) => [normalizePath(analysis.filePath), analysis]));
  const knowledgeByPath = new Map<string, KnowledgeMatch[]>();
  for (const match of knowledgeResult.matches) {
    const bucket = knowledgeByPath.get(match.filePath) ?? [];
    bucket.push(match);
    knowledgeByPath.set(match.filePath, bucket);
  }

  const dependenciesByPath = new Map<string, DependencyGraphEdge[]>();
  const linksByPath = new Map<string, SymbolLink[]>();
  const callsByPath = new Map<string, SymbolCallEdge[]>();
  const outgoingReferenceEdgesByPath = new Map<string, SymbolReferenceEdge[]>();
  const incomingReferenceEdgesByPath = new Map<string, SymbolReferenceEdge[]>();
  const symbolRankingsByPath = new Map<string, SymbolCentralityScore[]>();
  const namespaceNodesByPath = new Map<string, NamespaceSymbolNode[]>();
  const namespaceEdgesByPath = new Map<string, NamespaceSymbolEdge[]>();
  const exportBindingsByPath = new Map<string, ExportBinding[]>();
  const scopeBindingsByPath = new Map<string, ScopeBinding[]>();
  for (const edge of dependencyGraph.edges) {
    const bucket = dependenciesByPath.get(edge.sourcePath) ?? [];
    bucket.push(edge);
    dependenciesByPath.set(edge.sourcePath, bucket);
  }
  for (const analysis of symbolResult.files) {
    exportBindingsByPath.set(analysis.filePath, analysis.exportBindings);
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
  for (const link of symbolResult.links) {
    const bucket = linksByPath.get(link.sourceFilePath) ?? [];
    bucket.push(link);
    linksByPath.set(link.sourceFilePath, bucket);
  }
  for (const call of symbolResult.calls) {
    const bucket = callsByPath.get(call.callerFilePath) ?? [];
    bucket.push(call);
    callsByPath.set(call.callerFilePath, bucket);
  }
  for (const edge of symbolResult.referenceEdges) {
    const outgoing = outgoingReferenceEdgesByPath.get(edge.sourceFilePath) ?? [];
    outgoing.push(edge);
    outgoingReferenceEdgesByPath.set(edge.sourceFilePath, outgoing);
    if (edge.targetFilePath) {
      const incoming = incomingReferenceEdgesByPath.get(edge.targetFilePath) ?? [];
      incoming.push(edge);
      incomingReferenceEdgesByPath.set(edge.targetFilePath, incoming);
    }
  }

  const results = scanResult.files
    .map((file) => {
      const normalizedPath = normalizePath(file.path);
      const context = buildContext(
        normalizedPath,
        file.language,
        rolesByPath.get(normalizedPath),
        analysesByPath.get(normalizedPath),
        symbolRankingsByPath.get(normalizedPath) ?? [],
        namespaceNodesByPath.get(normalizedPath) ?? [],
        namespaceEdgesByPath.get(normalizedPath) ?? [],
        exportBindingsByPath.get(normalizedPath) ?? [],
        scopeBindingsByPath.get(normalizedPath) ?? [],
        knowledgeByPath.get(normalizedPath) ?? [],
        dependenciesByPath.get(normalizedPath) ?? [],
        linksByPath.get(normalizedPath) ?? [],
        callsByPath.get(normalizedPath) ?? [],
        outgoingReferenceEdgesByPath.get(normalizedPath) ?? [],
        incomingReferenceEdgesByPath.get(normalizedPath) ?? []
      );
      return scoreSearchResult(normalizedPath, context, query);
    })
    .filter((result): result is FileSearchResult => Boolean(result));

  return sortSearchResults(results);
}
