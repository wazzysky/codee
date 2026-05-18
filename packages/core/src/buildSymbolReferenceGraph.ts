import { buildSymbolId } from "./symbolIdentity.js";
import type {
  Diagnostic,
  FileAnalysis,
  SymbolDefinition,
  SymbolLink,
  SymbolReferenceEdge,
  SymbolReferenceGraph
} from "./types.js";

function findContainingSymbol(
  analysis: FileAnalysis,
  line: number,
  containerName?: string
): SymbolDefinition | undefined {
  const candidates = analysis.symbols.filter((symbol) => symbol.startLine <= line && symbol.endLine >= line);
  if (containerName) {
    const exactContainerMatch = candidates.find(
      (symbol) => symbol.name === containerName || symbol.containerName === containerName
    );
    if (exactContainerMatch) {
      return exactContainerMatch;
    }
  }

  return candidates.sort((left, right) => {
    const leftSpan = left.endLine - left.startLine;
    const rightSpan = right.endLine - right.startLine;
    if (leftSpan !== rightSpan) {
      return leftSpan - rightSpan;
    }

    return right.startLine - left.startLine;
  })[0];
}

function edgeKey(edge: SymbolReferenceEdge): string {
  return [
    edge.sourceFilePath,
    edge.sourceSymbolId,
    edge.sourceLine,
    edge.sourceReferenceName,
    edge.sourceReferenceKind,
    edge.targetSymbolId ?? "",
    edge.targetSpecifier ?? "",
    edge.resolution
  ].join("\u0000");
}

function findTargetSymbol(
  analysisByPath: Map<string, FileAnalysis>,
  targetFilePath: string | undefined,
  targetSymbolName: string | undefined,
  targetSymbolKind: SymbolDefinition["kind"] | undefined
): SymbolDefinition | undefined {
  if (!targetFilePath || !targetSymbolName) {
    return undefined;
  }

  const analysis = analysisByPath.get(targetFilePath);
  if (!analysis) {
    return undefined;
  }

  const exactKindMatch = analysis.symbols.find(
    (symbol) => symbol.name === targetSymbolName && (!targetSymbolKind || symbol.kind === targetSymbolKind)
  );
  if (exactKindMatch) {
    return exactKindMatch;
  }

  return analysis.symbols.find((symbol) => symbol.name === targetSymbolName);
}

export function buildSymbolReferenceGraph(
  root: string,
  analyses: FileAnalysis[],
  links: SymbolLink[]
): SymbolReferenceGraph {
  const analysisByPath = new Map(analyses.map((analysis) => [analysis.filePath, analysis]));
  const linksBySource = new Map<string, SymbolLink[]>();
  for (const link of links) {
    const key = `${link.sourceFilePath}\u0000${link.sourceLine}\u0000${link.sourceReferenceName}\u0000${link.sourceReferenceKind}`;
    const bucket = linksBySource.get(key) ?? [];
    bucket.push(link);
    linksBySource.set(key, bucket);
  }

  const diagnostics: Diagnostic[] = [];
  const edges: SymbolReferenceEdge[] = [];

  for (const analysis of analyses) {
    for (const reference of analysis.references) {
      const sourceSymbol = findContainingSymbol(analysis, reference.line, reference.containerName);
      if (!sourceSymbol) {
        diagnostics.push({
          level: "warning",
          path: analysis.filePath,
          message: `Could not determine source symbol for reference "${reference.name}" on line ${reference.line}.`
        });
        continue;
      }

      const sourceSymbolId = buildSymbolId(analysis.filePath, sourceSymbol);
      const key = `${analysis.filePath}\u0000${reference.line}\u0000${reference.name}\u0000${reference.kind}`;
      const matchingLinks = linksBySource.get(key) ?? [];

      if (matchingLinks.length === 0) {
        edges.push({
          sourceFilePath: analysis.filePath,
          sourceSymbolName: sourceSymbol.name,
          sourceSymbolKind: sourceSymbol.kind,
          sourceSymbolId,
          sourceLine: reference.line,
          sourceReferenceName: reference.name,
          sourceReferenceKind: reference.kind,
          sourceQualifier: reference.qualifier,
          resolution: "unresolved",
          confidence: 0.2,
          evidence: [`No symbol link resolved for reference "${reference.name}".`]
        });
        continue;
      }

      for (const link of matchingLinks) {
        const targetSymbol = findTargetSymbol(
          analysisByPath,
          link.targetFilePath,
          link.targetSymbolName,
          link.targetSymbolKind
        );

        edges.push({
          sourceFilePath: analysis.filePath,
          sourceSymbolName: sourceSymbol.name,
          sourceSymbolKind: sourceSymbol.kind,
          sourceSymbolId,
          sourceLine: reference.line,
          sourceReferenceName: reference.name,
          sourceReferenceKind: reference.kind,
          sourceQualifier: reference.qualifier,
          targetFilePath: link.targetFilePath,
          targetSymbolName: link.targetSymbolName,
          targetSymbolKind: link.targetSymbolKind,
          targetSymbolId:
            targetSymbol && link.targetFilePath ? buildSymbolId(link.targetFilePath, targetSymbol) : undefined,
          targetSpecifier: link.targetSpecifier,
          resolution: link.resolution,
          confidence: link.confidence,
          evidence: [...link.evidence]
        });
      }
    }
  }

  const dedupedEdges = [...new Map(edges.map((edge) => [edgeKey(edge), edge])).values()].sort((left, right) =>
    edgeKey(left).localeCompare(edgeKey(right))
  );

  return {
    root,
    edges: dedupedEdges,
    diagnostics: diagnostics.sort((left, right) =>
      `${left.path ?? ""}\u0000${left.message}`.localeCompare(`${right.path ?? ""}\u0000${right.message}`)
    )
  };
}
