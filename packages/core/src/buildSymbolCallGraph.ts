import type {
  Diagnostic,
  SymbolCallEdge,
  SymbolCallGraph,
  SymbolReferenceEdge,
  SymbolReferenceGraph
} from "./types.js";

function keyForCall(call: SymbolCallEdge): string {
  return [
    call.callerFilePath,
    call.callerSymbolId,
    call.callerSymbolName,
    call.callerLine,
    call.calleeSymbolId ?? "",
    call.calleeFilePath ?? "",
    call.calleeSpecifier ?? "",
    call.calleeSymbolName,
    call.referenceKind,
    call.resolution
  ].join("\u0000");
}

export function buildSymbolCallGraph(root: string, referenceGraph: SymbolReferenceGraph | SymbolReferenceEdge[]): SymbolCallGraph {
  const edges = Array.isArray(referenceGraph) ? referenceGraph : referenceGraph.edges;
  const diagnostics: Diagnostic[] = Array.isArray(referenceGraph) ? [] : referenceGraph.diagnostics;
  const callableEdges = edges.filter(
    (edge): edge is SymbolReferenceEdge & { sourceReferenceKind: "call" | "new" | "component" } =>
      edge.sourceReferenceKind !== "type"
  );
  const calls: SymbolCallEdge[] = callableEdges
    .map((edge) => ({
      callerFilePath: edge.sourceFilePath,
      callerSymbolName: edge.sourceSymbolName,
      callerSymbolKind: edge.sourceSymbolKind,
      callerSymbolId: edge.sourceSymbolId,
      callerLine: edge.sourceLine,
      calleeFilePath: edge.targetFilePath,
      calleeSymbolName: edge.targetSymbolName ?? edge.sourceReferenceName,
      calleeSymbolKind: edge.targetSymbolKind,
      calleeSymbolId: edge.targetSymbolId,
      calleeSpecifier: edge.targetSpecifier,
      referenceKind: edge.sourceReferenceKind,
      resolution: edge.resolution,
      confidence: edge.confidence,
      evidence: [...edge.evidence]
    }));

  const dedupedCalls = [...new Map(calls.map((call) => [keyForCall(call), call])).values()].sort((left, right) => {
    const leftKey = keyForCall(left);
    const rightKey = keyForCall(right);
    return leftKey.localeCompare(rightKey);
  });

  return {
    root,
    calls: dedupedCalls,
    diagnostics: diagnostics.sort((left, right) =>
      `${left.path ?? ""}\u0000${left.message}`.localeCompare(`${right.path ?? ""}\u0000${right.message}`)
    )
  };
}
