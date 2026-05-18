import type {
  Diagnostic,
  FileAnalysis,
  NamespaceSymbolEdge,
  NamespaceSymbolGraph,
  NamespaceSymbolNode
} from "./types.js";

function nodeKey(node: NamespaceSymbolNode): string {
  return [node.filePath, node.path, node.kind, node.parentPath ?? "", node.localName ?? "", node.sourceSpecifier ?? ""].join(
    "\u0000"
  );
}

function edgeKey(edge: NamespaceSymbolEdge): string {
  return [
    edge.filePath,
    edge.fromPath,
    edge.toPath,
    edge.kind,
    edge.targetSymbolName ?? "",
    edge.targetSpecifier ?? ""
  ].join("\u0000");
}

function sortNodes(nodes: NamespaceSymbolNode[]): NamespaceSymbolNode[] {
  return [...new Map(nodes.map((node) => [nodeKey(node), node])).values()].sort((left, right) =>
    nodeKey(left).localeCompare(nodeKey(right))
  );
}

function sortEdges(edges: NamespaceSymbolEdge[]): NamespaceSymbolEdge[] {
  return [...new Map(edges.map((edge) => [edgeKey(edge), edge])).values()].sort((left, right) =>
    edgeKey(left).localeCompare(edgeKey(right))
  );
}

function pathSegments(namespacePath: string): string[] {
  return namespacePath
    .split(".")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

export function buildNamespaceSymbolGraph(root: string, analyses: FileAnalysis[]): NamespaceSymbolGraph {
  const nodes: NamespaceSymbolNode[] = [];
  const edges: NamespaceSymbolEdge[] = [];
  const diagnostics: Diagnostic[] = [];

  for (const analysis of analyses.slice().sort((left, right) => left.filePath.localeCompare(right.filePath))) {
    const knownSymbols = new Set(analysis.symbols.map((symbol) => symbol.name));

    for (const binding of analysis.exportBindings) {
      const segments = pathSegments(binding.exportedName);
      if (segments.length === 0 || binding.exportedName === "*") {
        continue;
      }

      for (let index = 0; index < segments.length - 1; index += 1) {
        const namespacePath = segments.slice(0, index + 1).join(".");
        const parentPath = index > 0 ? segments.slice(0, index).join(".") : undefined;
        nodes.push({
          filePath: analysis.filePath,
          path: namespacePath,
          kind: "namespace",
          line: binding.line,
          parentPath,
          exportKind: binding.kind
        });

        if (parentPath) {
          edges.push({
            filePath: analysis.filePath,
            fromPath: parentPath,
            toPath: namespacePath,
            kind: "contains",
            line: binding.line,
            evidence: [`Namespace "${parentPath}" contains "${namespacePath}" via export binding "${binding.exportedName}".`]
          });
        }
      }

      const leafPath = segments.join(".");
      const parentPath = segments.length > 1 ? segments.slice(0, -1).join(".") : undefined;
      nodes.push({
        filePath: analysis.filePath,
        path: leafPath,
        kind: "export",
        line: binding.line,
        parentPath,
        localName: binding.localName,
        sourceSpecifier: binding.sourceSpecifier,
        exportKind: binding.kind
      });

      if (parentPath) {
        edges.push({
          filePath: analysis.filePath,
          fromPath: parentPath,
          toPath: leafPath,
          kind: "contains",
          line: binding.line,
          evidence: [`Namespace "${parentPath}" contains exported member "${leafPath}".`]
        });
      }

      if (binding.sourceSpecifier) {
        edges.push({
          filePath: analysis.filePath,
          fromPath: leafPath,
          toPath: binding.localName ?? binding.exportedName,
          kind: "resolves-to",
          line: binding.line,
          targetSpecifier: binding.sourceSpecifier,
          targetSymbolName: binding.localName,
          evidence: [`Export "${leafPath}" resolves through "${binding.sourceSpecifier}".`]
        });
      } else if (binding.localName) {
        edges.push({
          filePath: analysis.filePath,
          fromPath: leafPath,
          toPath: binding.localName,
          kind: "resolves-to",
          line: binding.line,
          targetSymbolName: binding.localName,
          evidence: [`Export "${leafPath}" resolves to local symbol "${binding.localName}".`]
        });

        if (!knownSymbols.has(binding.localName)) {
          diagnostics.push({
            level: "warning",
            path: analysis.filePath,
            message: `Namespace export "${leafPath}" resolves to "${binding.localName}" without a structural symbol definition.`
          });
        }
      }
    }
  }

  return {
    root,
    nodes: sortNodes(nodes),
    edges: sortEdges(edges),
    diagnostics: diagnostics.sort((left, right) =>
      `${left.path ?? ""}\u0000${left.message}`.localeCompare(`${right.path ?? ""}\u0000${right.message}`)
    )
  };
}
