import { buildSymbolId } from "./symbolIdentity.js";
import type {
  Diagnostic,
  FileAnalysis,
  NamespaceSymbolGraph,
  SymbolCallGraph,
  SymbolCentralityGraph,
  SymbolCentralityScore,
  SymbolReferenceGraph
} from "./types.js";

interface MutableCentrality {
  symbolId: string;
  filePath: string;
  symbolName: string;
  symbolKind: SymbolCentralityScore["symbolKind"];
  incomingReferenceCount: number;
  incomingCallCount: number;
  outgoingCallCount: number;
  namespaceExportCount: number;
  score: number;
  evidence: string[];
}

function pushEvidence(evidence: string[], value: string): void {
  if (!evidence.includes(value)) {
    evidence.push(value);
  }
}

function ensureBucket(
  buckets: Map<string, MutableCentrality>,
  filePath: string,
  symbol: FileAnalysis["symbols"][number]
): MutableCentrality {
  const symbolId = buildSymbolId(filePath, symbol);
  const existing = buckets.get(symbolId);
  if (existing) {
    return existing;
  }

  const created: MutableCentrality = {
    symbolId,
    filePath,
    symbolName: symbol.name,
    symbolKind: symbol.kind,
    incomingReferenceCount: 0,
    incomingCallCount: 0,
    outgoingCallCount: 0,
    namespaceExportCount: 0,
    score: 0,
    evidence: []
  };
  buckets.set(symbolId, created);
  return created;
}

export function buildSymbolCentralityGraph(
  root: string,
  analyses: FileAnalysis[],
  namespaceGraph: NamespaceSymbolGraph,
  referenceGraph: SymbolReferenceGraph,
  callGraph: SymbolCallGraph
): SymbolCentralityGraph {
  const buckets = new Map<string, MutableCentrality>();
  const symbolIdToBucket = new Map<string, MutableCentrality>();
  const diagnostics: Diagnostic[] = [
    ...namespaceGraph.diagnostics,
    ...referenceGraph.diagnostics,
    ...callGraph.diagnostics
  ];

  for (const analysis of analyses) {
    for (const symbol of analysis.symbols) {
      const bucket = ensureBucket(buckets, analysis.filePath, symbol);
      symbolIdToBucket.set(bucket.symbolId, bucket);
    }
  }

  for (const edge of referenceGraph.edges) {
    const sourceBucket = symbolIdToBucket.get(edge.sourceSymbolId);
    if (sourceBucket && edge.sourceReferenceKind !== "type") {
      sourceBucket.score += 0.5;
      pushEvidence(sourceBucket.evidence, `Outgoing ${edge.sourceReferenceKind} reference from "${edge.sourceSymbolName}".`);
    }

    if (edge.targetSymbolId) {
      const targetBucket = symbolIdToBucket.get(edge.targetSymbolId);
      if (targetBucket) {
        targetBucket.incomingReferenceCount += 1;
        targetBucket.score += edge.sourceReferenceKind === "type" ? 1.5 : 2.5;
        pushEvidence(
          targetBucket.evidence,
          `Referenced by "${edge.sourceSymbolName}" via ${edge.sourceReferenceKind}.`
        );
      }
    }
  }

  for (const call of callGraph.calls) {
    const callerBucket = symbolIdToBucket.get(call.callerSymbolId);
    if (callerBucket) {
      callerBucket.outgoingCallCount += 1;
      callerBucket.score += 1.2;
      pushEvidence(callerBucket.evidence, `Calls "${call.calleeSymbolName}".`);
    }

    if (call.calleeSymbolId) {
      const calleeBucket = symbolIdToBucket.get(call.calleeSymbolId);
      if (calleeBucket) {
        calleeBucket.incomingCallCount += 1;
        calleeBucket.score += 4;
        pushEvidence(calleeBucket.evidence, `Called by "${call.callerSymbolName}".`);
      }
    }
  }

  const namespaceLeafToSymbolId = new Map<string, string>();
  for (const edge of namespaceGraph.edges) {
    if (edge.kind !== "resolves-to" || !edge.targetSymbolName) {
      continue;
    }

    const targetBucket = [...symbolIdToBucket.values()].find(
      (bucket) => bucket.filePath === edge.filePath && bucket.symbolName === edge.targetSymbolName
    );
    if (!targetBucket) {
      continue;
    }

    namespaceLeafToSymbolId.set(`${edge.filePath}\u0000${edge.fromPath}`, targetBucket.symbolId);
    targetBucket.namespaceExportCount += 1;
    targetBucket.score += edge.fromPath.includes(".") ? 2.5 : 1.5;
    pushEvidence(targetBucket.evidence, `Exported through namespace path "${edge.fromPath}".`);
  }

  for (const edge of namespaceGraph.edges) {
    if (edge.kind !== "contains") {
      continue;
    }

    const targetSymbolId = namespaceLeafToSymbolId.get(`${edge.filePath}\u0000${edge.toPath}`);
    if (!targetSymbolId) {
      continue;
    }

    const bucket = symbolIdToBucket.get(targetSymbolId);
    if (!bucket) {
      continue;
    }

    bucket.score += 0.5;
    pushEvidence(bucket.evidence, `Contained by namespace "${edge.fromPath}".`);
  }

  const maxScore = Math.max(1, ...[...symbolIdToBucket.values()].map((bucket) => bucket.score));
  const rankings: SymbolCentralityScore[] = [...symbolIdToBucket.values()]
    .map((bucket) => ({
      symbolId: bucket.symbolId,
      filePath: bucket.filePath,
      symbolName: bucket.symbolName,
      symbolKind: bucket.symbolKind,
      score: Number(bucket.score.toFixed(2)),
      normalizedScore: Number((bucket.score / maxScore).toFixed(4)),
      incomingReferenceCount: bucket.incomingReferenceCount,
      incomingCallCount: bucket.incomingCallCount,
      outgoingCallCount: bucket.outgoingCallCount,
      namespaceExportCount: bucket.namespaceExportCount,
      evidence: bucket.evidence.sort((left, right) => left.localeCompare(right))
    }))
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      const leftKey = `${left.filePath}:${left.symbolName}:${left.symbolKind}`;
      const rightKey = `${right.filePath}:${right.symbolName}:${right.symbolKind}`;
      return leftKey.localeCompare(rightKey);
    });

  return {
    root,
    rankings,
    diagnostics: diagnostics.sort((left, right) =>
      `${left.path ?? ""}\u0000${left.message}`.localeCompare(`${right.path ?? ""}\u0000${right.message}`)
    )
  };
}
