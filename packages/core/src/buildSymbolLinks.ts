import path from "node:path";
import type {
  DependencyGraph,
  DependencyGraphEdge,
  Diagnostic,
  FileAnalysis,
  SymbolDefinition,
  SymbolLink,
  SymbolLinkGraph
} from "./types.js";

const CPP_SOURCE_EXTENSIONS = [".c", ".cc", ".cpp", ".cxx"];

function normalizePath(filePath: string): string {
  return path.posix.normalize(filePath.split(path.sep).join(path.posix.sep));
}

function findLocalSymbol(
  symbolsByFile: Map<string, SymbolDefinition[]>,
  filePath: string,
  symbolName: string
): SymbolDefinition | undefined {
  return (symbolsByFile.get(filePath) ?? []).find((symbol) => symbol.name === symbolName);
}

function findUniqueGlobalSymbol(
  symbolsByName: Map<string, Array<{ filePath: string; symbol: SymbolDefinition }>>,
  symbolName: string
): { filePath: string; symbol: SymbolDefinition } | undefined {
  const candidates = symbolsByName.get(symbolName) ?? [];
  return candidates.length === 1 ? candidates[0] : undefined;
}

function findDependencyForSpecifier(
  dependencyEdgesByFile: Map<string, DependencyGraphEdge[]>,
  filePath: string,
  specifier: string
): DependencyGraphEdge | undefined {
  return (dependencyEdgesByFile.get(filePath) ?? []).find((edge) => edge.specifier === specifier);
}

function candidateImplementationFiles(headerPath: string, fileSet: Set<string>): string[] {
  const ext = path.posix.extname(headerPath);
  const basePath = ext.length > 0 ? headerPath.slice(0, -ext.length) : headerPath;
  return CPP_SOURCE_EXTENSIONS
    .map((sourceExtension) => `${basePath}${sourceExtension}`)
    .filter((candidate) => fileSet.has(candidate));
}

function candidateTargetFiles(
  targetPath: string,
  dependencyEdgesByFile: Map<string, DependencyGraphEdge[]>,
  fileSet: Set<string>
): string[] {
  const candidates = new Set<string>([targetPath]);
  for (const edge of dependencyEdgesByFile.get(targetPath) ?? []) {
    if (edge.resolution === "internal" && edge.targetPath) {
      candidates.add(edge.targetPath);
    }
  }

  for (const implementationFile of candidateImplementationFiles(targetPath, fileSet)) {
    candidates.add(implementationFile);
  }

  return [...candidates];
}

function resolveInternalTarget(
  sourceFilePath: string,
  symbolName: string,
  dependencyEdge: DependencyGraphEdge | undefined,
  symbolsByFile: Map<string, SymbolDefinition[]>,
  dependencyEdgesByFile: Map<string, DependencyGraphEdge[]>,
  fileSet: Set<string>
): SymbolLink | undefined {
  if (dependencyEdge?.targetPath) {
    const candidates = candidateTargetFiles(dependencyEdge.targetPath, dependencyEdgesByFile, fileSet)
      .flatMap((candidateFile) =>
        (symbolsByFile.get(candidateFile) ?? [])
          .filter((symbol) => symbol.name === symbolName)
          .map((symbol) => ({ filePath: candidateFile, symbol }))
      );

    if (candidates.length === 1) {
      const candidate = candidates[0];
      return {
        sourceFilePath,
        sourceReferenceName: symbolName,
        sourceReferenceKind: "call",
        sourceLine: dependencyEdge.line,
        targetFilePath: candidate.filePath,
        targetSymbolName: candidate.symbol.name,
        targetSymbolKind: candidate.symbol.kind,
        resolution: "internal",
        confidence: 0.9,
        evidence: [
          `Resolved through dependency target "${dependencyEdge.targetPath}".`,
          ...dependencyEdge.evidence
        ]
      };
    }
  }

  return undefined;
}

export function buildSymbolLinks(
  root: string,
  analyses: FileAnalysis[],
  dependencyGraph: DependencyGraph
): SymbolLinkGraph {
  const sortedAnalyses = analyses.slice().sort((left, right) => left.filePath.localeCompare(right.filePath));
  const fileSet = new Set(sortedAnalyses.map((analysis) => normalizePath(analysis.filePath)));
  const symbolsByFile = new Map<string, SymbolDefinition[]>();
  const symbolsByName = new Map<string, Array<{ filePath: string; symbol: SymbolDefinition }>>();
  const dependencyEdgesByFile = new Map<string, DependencyGraphEdge[]>();

  for (const analysis of sortedAnalyses) {
    symbolsByFile.set(analysis.filePath, analysis.symbols);
    for (const symbol of analysis.symbols) {
      const bucket = symbolsByName.get(symbol.name) ?? [];
      bucket.push({ filePath: analysis.filePath, symbol });
      symbolsByName.set(symbol.name, bucket);
    }
  }

  for (const edge of dependencyGraph.edges) {
    const bucket = dependencyEdgesByFile.get(edge.sourcePath) ?? [];
    bucket.push(edge);
    dependencyEdgesByFile.set(edge.sourcePath, bucket);
  }

  const links: SymbolLink[] = [];
  const diagnostics: Diagnostic[] = [];

  for (const analysis of sortedAnalyses) {
    const dependencies = dependencyEdgesByFile.get(analysis.filePath) ?? [];
    for (const reference of analysis.references) {
      const localSymbol = findLocalSymbol(symbolsByFile, analysis.filePath, reference.name);
      if (localSymbol) {
        links.push({
          sourceFilePath: analysis.filePath,
          sourceReferenceName: reference.name,
          sourceReferenceKind: reference.kind,
          sourceLine: reference.line,
          sourceQualifier: reference.qualifier,
          targetFilePath: analysis.filePath,
          targetSymbolName: localSymbol.name,
          targetSymbolKind: localSymbol.kind,
          resolution: "local",
          confidence: 0.95,
          evidence: [`Resolved to a same-file symbol definition named "${reference.name}".`]
        });
        continue;
      }

      const binding = analysis.importBindings.find((item) => item.localName === (reference.qualifier ?? reference.name));
      if (binding) {
        const dependencyEdge = findDependencyForSpecifier(dependencyEdgesByFile, analysis.filePath, binding.sourceSpecifier);
        if (dependencyEdge?.resolution === "external" || (!dependencyEdge && binding.kind === "default")) {
          links.push({
            sourceFilePath: analysis.filePath,
            sourceReferenceName: reference.name,
            sourceReferenceKind: reference.kind,
            sourceLine: reference.line,
            sourceQualifier: reference.qualifier,
            targetSpecifier: binding.sourceSpecifier,
            resolution: "external",
            confidence: dependencyEdge?.confidence ?? 0.82,
            evidence: [
              `Resolved via imported binding "${binding.localName}" from external dependency "${binding.sourceSpecifier}".`,
              ...(dependencyEdge?.evidence ?? [])
            ]
          });
          continue;
        }

        if (dependencyEdge?.resolution === "internal") {
          const internalLink = resolveInternalTarget(
            analysis.filePath,
            binding.importedName === "default" ? reference.name : (binding.importedName ?? reference.name),
            dependencyEdge,
            symbolsByFile,
            dependencyEdgesByFile,
            fileSet
          );
          if (internalLink) {
            links.push({
              ...internalLink,
              sourceReferenceKind: reference.kind,
              sourceLine: reference.line,
              sourceQualifier: reference.qualifier
            });
            continue;
          }
        }
      }

      const internalDependencyTargets = dependencies.filter((edge) => edge.resolution === "internal");
      let resolvedLink: SymbolLink | undefined;
      for (const dependencyEdge of internalDependencyTargets) {
        resolvedLink = resolveInternalTarget(
          analysis.filePath,
          reference.name,
          dependencyEdge,
          symbolsByFile,
          dependencyEdgesByFile,
          fileSet
        );
        if (resolvedLink) {
          links.push({
            ...resolvedLink,
            sourceReferenceKind: reference.kind,
            sourceLine: reference.line,
            sourceQualifier: reference.qualifier
          });
          break;
        }
      }

      if (resolvedLink) {
        continue;
      }

      const uniqueGlobal = findUniqueGlobalSymbol(symbolsByName, reference.name);
      if (uniqueGlobal && uniqueGlobal.filePath !== analysis.filePath) {
        links.push({
          sourceFilePath: analysis.filePath,
          sourceReferenceName: reference.name,
          sourceReferenceKind: reference.kind,
          sourceLine: reference.line,
          sourceQualifier: reference.qualifier,
          targetFilePath: uniqueGlobal.filePath,
          targetSymbolName: uniqueGlobal.symbol.name,
          targetSymbolKind: uniqueGlobal.symbol.kind,
          resolution: "global",
          confidence: 0.55,
          evidence: [`Resolved as the only repository definition named "${reference.name}".`]
        });
        continue;
      }

      links.push({
        sourceFilePath: analysis.filePath,
        sourceReferenceName: reference.name,
        sourceReferenceKind: reference.kind,
        sourceLine: reference.line,
        sourceQualifier: reference.qualifier,
        resolution: "unresolved",
        confidence: 0.2,
        evidence: [`No symbol definition or dependency binding resolved "${reference.name}".`]
      });
    }
  }

  links.sort((left, right) => {
    const leftKey = `${left.sourceFilePath}\u0000${left.sourceLine}\u0000${left.sourceReferenceName}\u0000${left.targetFilePath ?? left.targetSpecifier ?? ""}`;
    const rightKey = `${right.sourceFilePath}\u0000${right.sourceLine}\u0000${right.sourceReferenceName}\u0000${right.targetFilePath ?? right.targetSpecifier ?? ""}`;
    return leftKey.localeCompare(rightKey);
  });

  return {
    root,
    links,
    diagnostics
  };
}
