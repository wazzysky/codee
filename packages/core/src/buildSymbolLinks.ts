import path from "node:path";
import type {
  DependencyGraph,
  DependencyGraphEdge,
  Diagnostic,
  ExportBinding,
  FileAnalysis,
  NamespaceSymbolGraph,
  ScopeBinding,
  SymbolDefinition,
  SymbolLink,
  SymbolLinkGraph,
  VariableTypeHint
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

function findContainerSymbol(
  symbolsByFile: Map<string, SymbolDefinition[]>,
  filePath: string,
  symbolName: string,
  containerName: string
): SymbolDefinition | undefined {
  return (symbolsByFile.get(filePath) ?? []).find(
    (symbol) => symbol.name === symbolName && symbol.containerName === containerName
  );
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

interface ResolvedExportTarget {
  filePath: string;
  targetSymbolName: string;
  symbol?: SymbolDefinition;
  evidence: string[];
}

interface ResolvedNamespaceTarget {
  filePath: string;
  evidence: string[];
}

interface QualifierPath {
  rootName: string;
  memberPath: string[];
}

function parseQualifierPath(qualifier: string | undefined): QualifierPath | undefined {
  if (!qualifier) {
    return undefined;
  }

  const parts = qualifier
    .split(".")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) {
    return undefined;
  }

  return {
    rootName: parts[0],
    memberPath: parts.slice(1)
  };
}

function buildNamespaceLookup(graph: NamespaceSymbolGraph): Map<string, Set<string>> {
  const lookup = new Map<string, Set<string>>();
  for (const node of graph.nodes) {
    const bucket = lookup.get(node.filePath) ?? new Set<string>();
    bucket.add(node.path);
    lookup.set(node.filePath, bucket);
  }
  return lookup;
}

function findActiveBinding(
  bindings: ScopeBinding[],
  name: string,
  line: number
): ScopeBinding | undefined {
  return bindings
    .filter((binding) => binding.name === name && binding.line <= line && binding.scopeStartLine <= line && binding.scopeEndLine >= line)
    .sort((left, right) => {
      const leftSpan = left.scopeEndLine - left.scopeStartLine;
      const rightSpan = right.scopeEndLine - right.scopeStartLine;
      if (leftSpan !== rightSpan) {
        return leftSpan - rightSpan;
      }

      if (left.line !== right.line) {
        return right.line - left.line;
      }

      return left.kind.localeCompare(right.kind);
    })[0];
}

function findActiveTypeHint(
  localTypeHints: VariableTypeHint[],
  name: string,
  line: number
): VariableTypeHint | undefined {
  return localTypeHints
    .filter((hint) => hint.name === name && hint.line <= line)
    .sort((left, right) => right.line - left.line)[0];
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

function resolveExportedSymbol(
  filePath: string,
  exportName: string,
  exportBindingsByFile: Map<string, ExportBinding[]>,
  symbolsByFile: Map<string, SymbolDefinition[]>,
  dependencyEdgesByFile: Map<string, DependencyGraphEdge[]>,
  fileSet: Set<string>,
  visited: Set<string> = new Set()
): ResolvedExportTarget[] {
  const visitKey = `${filePath}::${exportName}`;
  if (visited.has(visitKey)) {
    return [];
  }

  visited.add(visitKey);
  const exactMatches: ResolvedExportTarget[] = [];
  const exportBindings = exportBindingsByFile.get(filePath) ?? [];

  for (const binding of exportBindings) {
    if (binding.exportedName !== exportName) {
      continue;
    }

    if (binding.kind === "namespace") {
      continue;
    }

    if (!binding.sourceSpecifier) {
      const localSymbolName = binding.localName ?? exportName;
      const localSymbol = findLocalSymbol(symbolsByFile, filePath, localSymbolName);
      if (localSymbol) {
        exactMatches.push({
          filePath,
          targetSymbolName: localSymbol.name,
          symbol: localSymbol,
          evidence: [
            `Resolved exported symbol "${exportName}" from local export in "${filePath}".`
          ]
        });
      } else if (localSymbolName.length > 0) {
        exactMatches.push({
          filePath,
          targetSymbolName: localSymbolName,
          evidence: [
            `Resolved exported binding "${exportName}" in "${filePath}" without a structural symbol definition.`
          ]
        });
      }
      continue;
    }

    const dependencyEdge = findDependencyForSpecifier(dependencyEdgesByFile, filePath, binding.sourceSpecifier);
    if (dependencyEdge?.resolution !== "internal" || !dependencyEdge.targetPath) {
      continue;
    }

    const nestedExportName = binding.localName ?? exportName;
    for (const candidateFile of candidateTargetFiles(dependencyEdge.targetPath, dependencyEdgesByFile, fileSet)) {
      for (const resolved of resolveExportedSymbol(
        candidateFile,
        nestedExportName,
        exportBindingsByFile,
        symbolsByFile,
        dependencyEdgesByFile,
        fileSet,
        visited
      )) {
        exactMatches.push({
          ...resolved,
          evidence: [
            `Resolved exported symbol "${exportName}" via re-export "${binding.sourceSpecifier}".`,
            ...dependencyEdge.evidence,
            ...resolved.evidence
          ]
        });
      }
    }
  }

  for (const binding of exportBindings) {
    if (binding.kind !== "all" || !binding.sourceSpecifier) {
      continue;
    }

    const dependencyEdge = findDependencyForSpecifier(dependencyEdgesByFile, filePath, binding.sourceSpecifier);
    if (dependencyEdge?.resolution !== "internal" || !dependencyEdge.targetPath) {
      continue;
    }

    for (const candidateFile of candidateTargetFiles(dependencyEdge.targetPath, dependencyEdgesByFile, fileSet)) {
      for (const resolved of resolveExportedSymbol(
        candidateFile,
        exportName,
        exportBindingsByFile,
        symbolsByFile,
        dependencyEdgesByFile,
        fileSet,
        visited
      )) {
        exactMatches.push({
          ...resolved,
          evidence: [
            `Resolved exported symbol "${exportName}" via export-all "${binding.sourceSpecifier}".`,
            ...dependencyEdge.evidence,
            ...resolved.evidence
          ]
        });
      }
    }
  }

  if (exactMatches.length > 0) {
    return exactMatches;
  }

  const localSymbol = findLocalSymbol(symbolsByFile, filePath, exportName);
  return localSymbol
    ? [
        {
          filePath,
          targetSymbolName: localSymbol.name,
          symbol: localSymbol,
          evidence: [`Resolved symbol "${exportName}" directly in "${filePath}".`]
        }
      ]
    : [];
}

function resolveExportedNamespaceTargets(
  filePath: string,
  namespaceName: string,
  exportBindingsByFile: Map<string, ExportBinding[]>,
  dependencyEdgesByFile: Map<string, DependencyGraphEdge[]>,
  fileSet: Set<string>,
  visited: Set<string> = new Set()
): ResolvedNamespaceTarget[] {
  const visitKey = `${filePath}::namespace::${namespaceName}`;
  if (visited.has(visitKey)) {
    return [];
  }

  visited.add(visitKey);
  const exportBindings = exportBindingsByFile.get(filePath) ?? [];
  const targets: ResolvedNamespaceTarget[] = [];

  for (const binding of exportBindings) {
    if (binding.exportedName !== namespaceName || !binding.sourceSpecifier) {
      continue;
    }

    const dependencyEdge = findDependencyForSpecifier(dependencyEdgesByFile, filePath, binding.sourceSpecifier);
    if (dependencyEdge?.resolution !== "internal" || !dependencyEdge.targetPath) {
      continue;
    }

    if (binding.kind === "namespace") {
      for (const candidateFile of candidateTargetFiles(dependencyEdge.targetPath, dependencyEdgesByFile, fileSet)) {
        targets.push({
          filePath: candidateFile,
          evidence: [
            `Resolved namespace "${namespaceName}" via export namespace "${binding.sourceSpecifier}".`,
            ...dependencyEdge.evidence
          ]
        });
      }
      continue;
    }

    for (const candidateFile of candidateTargetFiles(dependencyEdge.targetPath, dependencyEdgesByFile, fileSet)) {
      for (const nested of resolveExportedNamespaceTargets(
        candidateFile,
        binding.localName ?? namespaceName,
        exportBindingsByFile,
        dependencyEdgesByFile,
        fileSet,
        visited
      )) {
        targets.push({
          filePath: nested.filePath,
          evidence: [
            `Resolved namespace "${namespaceName}" via re-export "${binding.sourceSpecifier}".`,
            ...dependencyEdge.evidence,
            ...nested.evidence
          ]
        });
      }
    }
  }

  const deduped = new Map<string, ResolvedNamespaceTarget>();
  for (const target of targets) {
    if (!deduped.has(target.filePath)) {
      deduped.set(target.filePath, target);
    }
  }
  return [...deduped.values()];
}

function resolveInternalTarget(
  sourceFilePath: string,
  symbolName: string,
  containerName: string | undefined,
  dependencyEdge: DependencyGraphEdge | undefined,
  symbolsByFile: Map<string, SymbolDefinition[]>,
  exportBindingsByFile: Map<string, ExportBinding[]>,
  dependencyEdgesByFile: Map<string, DependencyGraphEdge[]>,
  fileSet: Set<string>
): SymbolLink | undefined {
  if (dependencyEdge?.targetPath) {
    const rawCandidates = candidateTargetFiles(dependencyEdge.targetPath, dependencyEdgesByFile, fileSet).flatMap((candidateFile) => {
      if (containerName) {
        const namespaceCandidates = resolveExportedNamespaceTargets(
          candidateFile,
          containerName,
          exportBindingsByFile,
          dependencyEdgesByFile,
          fileSet
        ).flatMap((namespaceTarget) =>
          resolveExportedSymbol(
            namespaceTarget.filePath,
            symbolName,
            exportBindingsByFile,
            symbolsByFile,
            dependencyEdgesByFile,
            fileSet
          ).map((resolved) => ({
            filePath: resolved.filePath,
            targetSymbolName: resolved.targetSymbolName,
            symbol: resolved.symbol,
            evidence: [
              `Resolved member "${symbolName}" through namespace "${containerName}".`,
              ...namespaceTarget.evidence,
              ...resolved.evidence
            ]
          }))
        );
        if (namespaceCandidates.length > 0) {
          return namespaceCandidates;
        }

        return resolveExportedSymbol(
          candidateFile,
          containerName,
          exportBindingsByFile,
          symbolsByFile,
          dependencyEdgesByFile,
          fileSet
        )
          .flatMap((ownerCandidate) =>
            (symbolsByFile.get(ownerCandidate.filePath) ?? [])
              .filter((symbol) => {
                const effectiveContainerName =
                  ownerCandidate.symbol?.kind === "class" || ownerCandidate.symbol?.kind === "component"
                    ? ownerCandidate.targetSymbolName
                    : containerName;
                return symbol.name === symbolName && symbol.containerName === effectiveContainerName;
              })
              .map((symbol) => ({
                filePath: ownerCandidate.filePath,
                targetSymbolName: symbol.name,
                symbol,
                evidence: [
                  `Resolved member "${symbolName}" on exported container "${containerName}".`,
                  ...ownerCandidate.evidence
                ]
              }))
          );
      }

      const exportedCandidates = resolveExportedSymbol(
        candidateFile,
        symbolName,
        exportBindingsByFile,
        symbolsByFile,
        dependencyEdgesByFile,
        fileSet
      ).map((candidate) => ({
        filePath: candidate.filePath,
        targetSymbolName: candidate.targetSymbolName,
        symbol: candidate.symbol,
        evidence: candidate.evidence
      }));

      if (exportedCandidates.length > 0) {
        return exportedCandidates;
      }

      return (symbolsByFile.get(candidateFile) ?? [])
        .filter((symbol) => symbol.name === symbolName)
        .map((symbol) => ({
          filePath: candidateFile,
          targetSymbolName: symbol.name,
          symbol,
          evidence: [`Resolved symbol "${symbolName}" directly in dependency target "${candidateFile}".`]
        }));
    });
    const candidateMap = new Map<string, (typeof rawCandidates)[number]>();
    for (const candidate of rawCandidates) {
      const key = `${candidate.filePath}::${candidate.targetSymbolName}::${candidate.symbol?.containerName ?? ""}`;
      if (!candidateMap.has(key)) {
        candidateMap.set(key, candidate);
      }
    }
    const candidates = [...candidateMap.values()];

    if (candidates.length === 1) {
      const candidate = candidates[0];
      return {
        sourceFilePath,
        sourceReferenceName: symbolName,
        sourceReferenceKind: "call",
        sourceLine: dependencyEdge.line,
        targetFilePath: candidate.filePath,
        targetSymbolName: candidate.targetSymbolName,
        targetSymbolKind: candidate.symbol?.kind,
        resolution: "internal",
        confidence: 0.9,
        evidence: [
          `Resolved through dependency target "${dependencyEdge.targetPath}".`,
          ...dependencyEdge.evidence,
          ...candidate.evidence
        ]
      };
    }
  }

  return undefined;
}

function resolveNamespaceMemberTarget(
  sourceFilePath: string,
  symbolName: string,
  namespaceName: string,
  dependencyEdge: DependencyGraphEdge | undefined,
  symbolsByFile: Map<string, SymbolDefinition[]>,
  exportBindingsByFile: Map<string, ExportBinding[]>,
  dependencyEdgesByFile: Map<string, DependencyGraphEdge[]>,
  fileSet: Set<string>
): SymbolLink | undefined {
  if (!dependencyEdge?.targetPath) {
    return undefined;
  }

  const rawCandidates = candidateTargetFiles(dependencyEdge.targetPath, dependencyEdgesByFile, fileSet).flatMap((candidateFile) => {
    const directExports = resolveExportedSymbol(
      candidateFile,
      symbolName,
      exportBindingsByFile,
      symbolsByFile,
      dependencyEdgesByFile,
      fileSet
    ).map((resolved) => ({
      filePath: resolved.filePath,
      targetSymbolName: resolved.targetSymbolName,
      symbol: resolved.symbol,
      evidence: [
        `Resolved member "${symbolName}" through module namespace "${namespaceName}".`,
        ...resolved.evidence
      ]
    }));

    const namespaceExports = resolveExportedNamespaceTargets(
      candidateFile,
      namespaceName,
      exportBindingsByFile,
      dependencyEdgesByFile,
      fileSet
    ).flatMap((namespaceTarget) =>
      resolveExportedSymbol(
        namespaceTarget.filePath,
        symbolName,
        exportBindingsByFile,
        symbolsByFile,
        dependencyEdgesByFile,
        fileSet
      ).map((resolved) => ({
        filePath: resolved.filePath,
        targetSymbolName: resolved.targetSymbolName,
        symbol: resolved.symbol,
        evidence: [
          `Resolved member "${symbolName}" through exported namespace "${namespaceName}".`,
          ...namespaceTarget.evidence,
          ...resolved.evidence
        ]
      }))
    );

    return [...directExports, ...namespaceExports];
  });

  const candidateMap = new Map<string, (typeof rawCandidates)[number]>();
  for (const candidate of rawCandidates) {
    const key = `${candidate.filePath}::${candidate.targetSymbolName}::${candidate.symbol?.containerName ?? ""}`;
    if (!candidateMap.has(key)) {
      candidateMap.set(key, candidate);
    }
  }
  const candidates = [...candidateMap.values()];

  if (candidates.length !== 1) {
    return undefined;
  }

  const candidate = candidates[0];
  return {
    sourceFilePath,
    sourceReferenceName: symbolName,
    sourceReferenceKind: "call",
    sourceLine: dependencyEdge.line,
    targetFilePath: candidate.filePath,
    targetSymbolName: candidate.targetSymbolName,
    targetSymbolKind: candidate.symbol?.kind,
    resolution: "internal",
    confidence: 0.9,
    evidence: [
      `Resolved through dependency target "${dependencyEdge.targetPath}".`,
      ...dependencyEdge.evidence,
      ...candidate.evidence
    ]
  };
}

function resolveQualifiedExportPathTarget(
  sourceFilePath: string,
  exportPath: string,
  dependencyEdge: DependencyGraphEdge | undefined,
  namespacePathsByFile: Map<string, Set<string>>,
  symbolsByFile: Map<string, SymbolDefinition[]>,
  exportBindingsByFile: Map<string, ExportBinding[]>,
  dependencyEdgesByFile: Map<string, DependencyGraphEdge[]>,
  fileSet: Set<string>
): SymbolLink | undefined {
  if (!dependencyEdge?.targetPath) {
    return undefined;
  }

  const rawCandidates = candidateTargetFiles(dependencyEdge.targetPath, dependencyEdgesByFile, fileSet).flatMap(
    (candidateFile) => {
      if (!(namespacePathsByFile.get(candidateFile)?.has(exportPath) ?? false)) {
        return [];
      }

      return (
      resolveExportedSymbol(
        candidateFile,
        exportPath,
        exportBindingsByFile,
        symbolsByFile,
        dependencyEdgesByFile,
        fileSet
      ).map((resolved) => ({
        filePath: resolved.filePath,
        targetSymbolName: resolved.targetSymbolName,
        symbol: resolved.symbol,
        evidence: [
          `Resolved qualified export path "${exportPath}" through dependency target "${dependencyEdge.targetPath}".`,
          ...resolved.evidence
        ]
      }))
      );
    }
  );

  const candidateMap = new Map<string, (typeof rawCandidates)[number]>();
  for (const candidate of rawCandidates) {
    const key = `${candidate.filePath}::${candidate.targetSymbolName}::${candidate.symbol?.containerName ?? ""}`;
    if (!candidateMap.has(key)) {
      candidateMap.set(key, candidate);
    }
  }
  const candidates = [...candidateMap.values()];

  if (candidates.length !== 1) {
    return undefined;
  }

  const candidate = candidates[0];
  return {
    sourceFilePath,
    sourceReferenceName: exportPath.split(".").pop() ?? exportPath,
    sourceReferenceKind: "call",
    sourceLine: dependencyEdge.line,
    targetFilePath: candidate.filePath,
    targetSymbolName: candidate.targetSymbolName,
    targetSymbolKind: candidate.symbol?.kind,
    resolution: "internal",
    confidence: 0.9,
    evidence: [...dependencyEdge.evidence, ...candidate.evidence]
  };
}

function resolveByTypeHint(
  analysis: FileAnalysis,
  reference: FileAnalysis["references"][number],
  qualifierTypeHint: VariableTypeHint,
  symbolsByFile: Map<string, SymbolDefinition[]>,
  exportBindingsByFile: Map<string, ExportBinding[]>,
  dependencyEdgesByFile: Map<string, DependencyGraphEdge[]>,
  fileSet: Set<string>
): SymbolLink | undefined {
  const localMethod = findContainerSymbol(symbolsByFile, analysis.filePath, reference.name, qualifierTypeHint.typeName);
  if (localMethod) {
    return {
      sourceFilePath: analysis.filePath,
      sourceReferenceName: reference.name,
      sourceReferenceKind: reference.kind,
      sourceLine: reference.line,
      sourceQualifier: reference.qualifier,
      targetFilePath: analysis.filePath,
      targetSymbolName: localMethod.name,
      targetSymbolKind: localMethod.kind,
      resolution: "local",
      confidence: 0.97,
      evidence: [
        `Resolved via qualifier "${qualifierTypeHint.name}" inferred as type "${qualifierTypeHint.typeName}".`,
        qualifierTypeHint.evidence
      ]
    };
  }

  const typeBinding = analysis.importBindings.find((item) => item.localName === qualifierTypeHint.typeName);
  if (typeBinding) {
    const dependencyEdge = findDependencyForSpecifier(
      dependencyEdgesByFile,
      analysis.filePath,
      typeBinding.sourceSpecifier
    );
    if (dependencyEdge?.resolution === "external") {
      return {
        sourceFilePath: analysis.filePath,
        sourceReferenceName: reference.name,
        sourceReferenceKind: reference.kind,
        sourceLine: reference.line,
        sourceQualifier: reference.qualifier,
        targetSpecifier: typeBinding.sourceSpecifier,
        resolution: "external",
        confidence: 0.86,
        evidence: [
          `Resolved via qualifier "${qualifierTypeHint.name}" inferred as imported type "${qualifierTypeHint.typeName}".`,
          qualifierTypeHint.evidence,
          ...dependencyEdge.evidence
        ]
      };
    }

    if (dependencyEdge?.resolution === "internal") {
      const internalLink = resolveInternalTarget(
        analysis.filePath,
        reference.name,
        typeBinding.importedName ?? qualifierTypeHint.typeName,
        dependencyEdge,
        symbolsByFile,
        exportBindingsByFile,
        dependencyEdgesByFile,
        fileSet
      );
      if (internalLink) {
        return {
          ...internalLink,
          sourceReferenceName: reference.name,
          sourceReferenceKind: reference.kind,
          sourceLine: reference.line,
          sourceQualifier: reference.qualifier,
          confidence: 0.96,
          evidence: [
            `Resolved via qualifier "${qualifierTypeHint.name}" inferred as imported type "${qualifierTypeHint.typeName}".`,
            qualifierTypeHint.evidence,
            ...internalLink.evidence
          ]
        };
      }
    }
  }

  for (const dependencyEdge of dependencyEdgesByFile.get(analysis.filePath) ?? []) {
    if (dependencyEdge.resolution !== "internal") {
      continue;
    }

    const internalLink = resolveInternalTarget(
      analysis.filePath,
      reference.name,
      qualifierTypeHint.typeName,
      dependencyEdge,
      symbolsByFile,
      exportBindingsByFile,
      dependencyEdgesByFile,
      fileSet
    );
    if (internalLink) {
      return {
        ...internalLink,
        sourceReferenceName: reference.name,
        sourceReferenceKind: reference.kind,
        sourceLine: reference.line,
        sourceQualifier: reference.qualifier,
        confidence: 0.94,
        evidence: [
          `Resolved via qualifier "${qualifierTypeHint.name}" inferred as type "${qualifierTypeHint.typeName}".`,
          qualifierTypeHint.evidence,
          ...internalLink.evidence
        ]
      };
    }
  }

  return undefined;
}

function resolveByBinding(
  analysis: FileAnalysis,
  reference: FileAnalysis["references"][number],
  binding: ScopeBinding,
  namespacePathsByFile: Map<string, Set<string>>,
  symbolsByFile: Map<string, SymbolDefinition[]>,
  exportBindingsByFile: Map<string, ExportBinding[]>,
  dependencyEdgesByFile: Map<string, DependencyGraphEdge[]>,
  fileSet: Set<string>
): SymbolLink | undefined {
  const qualifierPath = parseQualifierPath(reference.qualifier);
  const qualifierMemberPath = qualifierPath?.rootName === binding.name ? qualifierPath.memberPath : [];

  if (binding.kind === "implicit-self" || binding.kind === "implicit-this" || binding.kind === "variable" || binding.kind === "parameter") {
    if (binding.typeName) {
      return resolveByTypeHint(
        analysis,
        reference,
        {
          name: binding.name,
          typeName: binding.typeName,
          line: binding.line,
          evidence: binding.evidence
        },
        symbolsByFile,
        exportBindingsByFile,
        dependencyEdgesByFile,
        fileSet
      );
    }

    return {
      sourceFilePath: analysis.filePath,
      sourceReferenceName: reference.name,
      sourceReferenceKind: reference.kind,
      sourceLine: reference.line,
      sourceQualifier: reference.qualifier,
      resolution: "unresolved",
      confidence: 0.25,
      evidence: [
        `Reference "${reference.name}" is shadowed by active ${binding.kind} binding "${binding.name}".`,
        binding.evidence
      ]
    };
  }

  if (binding.kind === "import" || binding.kind === "module") {
    if (!binding.sourceSpecifier) {
      return undefined;
    }

    const dependencyEdge = findDependencyForSpecifier(dependencyEdgesByFile, analysis.filePath, binding.sourceSpecifier);
    if (dependencyEdge?.resolution === "external" || (!dependencyEdge && binding.kind === "import")) {
      return {
        sourceFilePath: analysis.filePath,
        sourceReferenceName: reference.name,
        sourceReferenceKind: reference.kind,
        sourceLine: reference.line,
        sourceQualifier: reference.qualifier,
        targetSpecifier: binding.sourceSpecifier,
        resolution: "external",
        confidence: dependencyEdge?.confidence ?? 0.82,
        evidence: [
          `Resolved via active ${binding.kind} binding "${binding.name}" from "${binding.sourceSpecifier}".`,
          ...(dependencyEdge?.evidence ?? [])
        ]
      };
    }

    if (dependencyEdge?.resolution === "internal") {
      if (qualifierMemberPath.length > 0) {
        const qualifiedExportPath = [...qualifierMemberPath, reference.name].join(".");
        const qualifiedLink = resolveQualifiedExportPathTarget(
          analysis.filePath,
          qualifiedExportPath,
          dependencyEdge,
          namespacePathsByFile,
          symbolsByFile,
          exportBindingsByFile,
          dependencyEdgesByFile,
          fileSet
        );
        if (qualifiedLink) {
          return {
            ...qualifiedLink,
            sourceReferenceName: reference.name,
            sourceReferenceKind: reference.kind,
            sourceLine: reference.line,
            sourceQualifier: reference.qualifier,
            confidence: Math.max(qualifiedLink.confidence, 0.92),
            evidence: [
              `Resolved via active ${binding.kind} binding "${binding.name}" from "${binding.sourceSpecifier}".`,
              ...qualifiedLink.evidence
            ]
          };
        }
      }

      if (reference.qualifier) {
        const namespaceLikeTarget =
          binding.kind === "module" || binding.importedName === undefined
            ? resolveNamespaceMemberTarget(
                analysis.filePath,
                reference.name,
                binding.name,
                dependencyEdge,
                symbolsByFile,
                exportBindingsByFile,
                dependencyEdgesByFile,
                fileSet
              )
            : resolveInternalTarget(
                analysis.filePath,
                reference.name,
                binding.importedName,
                dependencyEdge,
                symbolsByFile,
                exportBindingsByFile,
                dependencyEdgesByFile,
                fileSet
              );
        if (namespaceLikeTarget) {
          return {
            ...namespaceLikeTarget,
            sourceReferenceName: reference.name,
            sourceReferenceKind: reference.kind,
            sourceLine: reference.line,
            sourceQualifier: reference.qualifier,
            confidence: Math.max(namespaceLikeTarget.confidence, 0.91),
            evidence: [
              `Resolved via active ${binding.kind} binding "${binding.name}" from "${binding.sourceSpecifier}".`,
              ...namespaceLikeTarget.evidence
            ]
          };
        }
      }

      const targetName =
        !reference.qualifier && binding.importedName === "default"
          ? "default"
          : (binding.importedName ?? reference.name);
      const internalLink = resolveInternalTarget(
        analysis.filePath,
        targetName,
        undefined,
        dependencyEdge,
        symbolsByFile,
        exportBindingsByFile,
        dependencyEdgesByFile,
        fileSet
      );
      if (internalLink) {
        return {
          ...internalLink,
          sourceReferenceName: reference.name,
          sourceReferenceKind: reference.kind,
          sourceLine: reference.line,
          sourceQualifier: reference.qualifier,
          confidence: Math.max(internalLink.confidence, 0.9),
          evidence: [
            `Resolved via active ${binding.kind} binding "${binding.name}" from "${binding.sourceSpecifier}".`,
            ...internalLink.evidence
          ]
        };
      }
    }
  }

  if (binding.kind === "symbol") {
    const localSymbol = findLocalSymbol(symbolsByFile, analysis.filePath, binding.name);
    if (localSymbol) {
      return {
        sourceFilePath: analysis.filePath,
        sourceReferenceName: reference.name,
        sourceReferenceKind: reference.kind,
        sourceLine: reference.line,
        sourceQualifier: reference.qualifier,
        targetFilePath: analysis.filePath,
        targetSymbolName: localSymbol.name,
        targetSymbolKind: localSymbol.kind,
        resolution: "local",
        confidence: 0.96,
        evidence: [
          `Resolved via active symbol binding "${binding.name}".`,
          binding.evidence
        ]
      };
    }
  }

  return undefined;
}

export function buildSymbolLinks(
  root: string,
  analyses: FileAnalysis[],
  dependencyGraph: DependencyGraph,
  namespaceGraph?: NamespaceSymbolGraph
): SymbolLinkGraph {
  const sortedAnalyses = analyses.slice().sort((left, right) => left.filePath.localeCompare(right.filePath));
  const fileSet = new Set(sortedAnalyses.map((analysis) => normalizePath(analysis.filePath)));
  const symbolsByFile = new Map<string, SymbolDefinition[]>();
  const exportBindingsByFile = new Map<string, ExportBinding[]>();
  const symbolsByName = new Map<string, Array<{ filePath: string; symbol: SymbolDefinition }>>();
  const dependencyEdgesByFile = new Map<string, DependencyGraphEdge[]>();
  const namespacePathsByFile = namespaceGraph ? buildNamespaceLookup(namespaceGraph) : new Map<string, Set<string>>();

  for (const analysis of sortedAnalyses) {
    symbolsByFile.set(analysis.filePath, analysis.symbols);
    exportBindingsByFile.set(analysis.filePath, analysis.exportBindings);
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
      const qualifierPath = parseQualifierPath(reference.qualifier);
      const activeQualifierBinding = qualifierPath
        ? findActiveBinding(analysis.scopeBindings, qualifierPath.rootName, reference.line)
        : reference.qualifier
          ? findActiveBinding(analysis.scopeBindings, reference.qualifier, reference.line)
        : undefined;
      if (activeQualifierBinding) {
        const bindingLink = resolveByBinding(
          analysis,
          reference,
          activeQualifierBinding,
          namespacePathsByFile,
          symbolsByFile,
          exportBindingsByFile,
          dependencyEdgesByFile,
          fileSet
        );
        if (bindingLink) {
          links.push(bindingLink);
          continue;
        }
      }

      const activeReferenceBinding = !reference.qualifier
        ? findActiveBinding(analysis.scopeBindings, reference.name, reference.line)
        : undefined;
      if (activeReferenceBinding) {
        const bindingLink = resolveByBinding(
          analysis,
          reference,
          activeReferenceBinding,
          namespacePathsByFile,
          symbolsByFile,
          exportBindingsByFile,
          dependencyEdgesByFile,
          fileSet
        );
        if (bindingLink) {
          links.push(bindingLink);
          continue;
        }
      }

      const qualifierTypeHint =
        reference.qualifier ? findActiveTypeHint(analysis.localTypeHints, reference.qualifier, reference.line) : undefined;
      if (reference.qualifier && qualifierTypeHint) {
        const typeHintLink = resolveByTypeHint(
          analysis,
          reference,
          qualifierTypeHint,
          symbolsByFile,
          exportBindingsByFile,
          dependencyEdgesByFile,
          fileSet
        );
        if (typeHintLink) {
          links.push(typeHintLink);
          continue;
        }
      }

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
            binding.importedName ?? reference.name,
            undefined,
            dependencyEdge,
            symbolsByFile,
            exportBindingsByFile,
            dependencyEdgesByFile,
            fileSet
          );
          if (internalLink) {
            links.push({
              ...internalLink,
              sourceReferenceName: reference.name,
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
          undefined,
          dependencyEdge,
          symbolsByFile,
          exportBindingsByFile,
          dependencyEdgesByFile,
          fileSet
        );
        if (resolvedLink) {
          links.push({
            ...resolvedLink,
            sourceReferenceName: reference.name,
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

      if (reference.qualifier) {
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
