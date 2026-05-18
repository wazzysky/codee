import { promises as fs } from "node:fs";
import path from "node:path";
import { buildSymbolCallGraph } from "./buildSymbolCallGraph.js";
import { buildSymbolCentralityGraph } from "./buildSymbolCentralityGraph.js";
import { buildDependencyGraph } from "./buildDependencyGraph.js";
import { buildNamespaceSymbolGraph } from "./buildNamespaceSymbolGraph.js";
import { buildSymbolReferenceGraph } from "./buildSymbolReferenceGraph.js";
import { buildSymbolLinks } from "./buildSymbolLinks.js";
import { createStructureParserRegistry, StructureParserRegistry } from "./structureParserRegistry.js";
import { buildScopeBindings } from "./scopeBindings.js";
import type { Diagnostic, FileAnalysis, ScanResult, StructureParseInput, SymbolExtractionResult } from "./types.js";

const SUPPORTED_LANGUAGES = new Set(["Python", "TypeScript", "JavaScript", "C", "C++"]);

function normalizePath(filePath: string): string {
  return path.posix.normalize(filePath.split(path.sep).join(path.posix.sep));
}

function uniqSortedDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics
    .slice()
    .sort((left, right) => {
      const leftKey = `${left.path ?? ""}\u0000${left.level}\u0000${left.message}`;
      const rightKey = `${right.path ?? ""}\u0000${right.level}\u0000${right.message}`;
      return leftKey.localeCompare(rightKey);
    })
    .filter((diagnostic, index, items) => {
      if (index === 0) {
        return true;
      }

      const previous = items[index - 1];
      return !(
        previous.path === diagnostic.path &&
        previous.level === diagnostic.level &&
        previous.message === diagnostic.message
      );
    });
}

function uniqSortedSymbols(symbols: FileAnalysis["symbols"]): FileAnalysis["symbols"] {
  return symbols
    .slice()
    .sort((left, right) =>
      left.startLine === right.startLine
        ? `${left.kind}:${left.name}:${left.containerName ?? ""}`.localeCompare(
            `${right.kind}:${right.name}:${right.containerName ?? ""}`
          )
        : left.startLine - right.startLine
    )
    .filter((symbol, index, items) => {
      if (index === 0) {
        return true;
      }

      const previous = items[index - 1];
      return !(
        previous.name === symbol.name &&
        previous.kind === symbol.kind &&
        previous.startLine === symbol.startLine &&
        previous.endLine === symbol.endLine &&
        previous.containerName === symbol.containerName
      );
    });
}

function uniqSortedImports(imports: FileAnalysis["imports"]): FileAnalysis["imports"] {
  return imports
    .slice()
    .sort((left, right) =>
      left.line === right.line ? left.specifier.localeCompare(right.specifier) : left.line - right.line
    )
    .filter((reference, index, items) => {
      if (index === 0) {
        return true;
      }

      const previous = items[index - 1];
      return !(
        previous.line === reference.line &&
        previous.kind === reference.kind &&
        previous.specifier === reference.specifier
      );
    });
}

function uniqSortedImportBindings(importBindings: FileAnalysis["importBindings"]): FileAnalysis["importBindings"] {
  return importBindings
    .slice()
    .sort((left, right) =>
      left.line === right.line
        ? `${left.sourceSpecifier}:${left.localName}`.localeCompare(`${right.sourceSpecifier}:${right.localName}`)
        : left.line - right.line
    )
    .filter((binding, index, items) => {
      if (index === 0) {
        return true;
      }

      const previous = items[index - 1];
      return !(
        previous.line === binding.line &&
        previous.localName === binding.localName &&
        previous.importedName === binding.importedName &&
        previous.sourceSpecifier === binding.sourceSpecifier &&
        previous.kind === binding.kind
      );
    });
}

function uniqSortedExportBindings(exportBindings: FileAnalysis["exportBindings"]): FileAnalysis["exportBindings"] {
  return exportBindings
    .slice()
    .sort((left, right) =>
      left.line === right.line
        ? `${left.exportedName}:${left.localName ?? ""}:${left.sourceSpecifier ?? ""}`.localeCompare(
            `${right.exportedName}:${right.localName ?? ""}:${right.sourceSpecifier ?? ""}`
          )
        : left.line - right.line
    )
    .filter((binding, index, items) => {
      if (index === 0) {
        return true;
      }

      const previous = items[index - 1];
      return !(
        previous.line === binding.line &&
        previous.exportedName === binding.exportedName &&
        previous.localName === binding.localName &&
        previous.sourceSpecifier === binding.sourceSpecifier &&
        previous.kind === binding.kind
      );
    });
}

function uniqSortedLocalTypeHints(localTypeHints: FileAnalysis["localTypeHints"]): FileAnalysis["localTypeHints"] {
  return localTypeHints
    .slice()
    .sort((left, right) =>
      left.line === right.line
        ? `${left.name}:${left.typeName}`.localeCompare(`${right.name}:${right.typeName}`)
        : left.line - right.line
    )
    .filter((hint, index, items) => {
      if (index === 0) {
        return true;
      }

      const previous = items[index - 1];
      return !(
        previous.line === hint.line &&
        previous.name === hint.name &&
        previous.typeName === hint.typeName &&
        previous.evidence === hint.evidence
      );
    });
}

function uniqSortedScopeBindings(scopeBindings: FileAnalysis["scopeBindings"]): FileAnalysis["scopeBindings"] {
  return scopeBindings
    .slice()
    .sort((left, right) =>
      left.line === right.line
        ? `${left.name}:${left.kind}:${left.containerName ?? ""}`.localeCompare(
            `${right.name}:${right.kind}:${right.containerName ?? ""}`
          )
        : left.line - right.line
    )
    .filter((binding, index, items) => {
      if (index === 0) {
        return true;
      }

      const previous = items[index - 1];
      return !(
        previous.name === binding.name &&
        previous.kind === binding.kind &&
        previous.line === binding.line &&
        previous.scopeStartLine === binding.scopeStartLine &&
        previous.scopeEndLine === binding.scopeEndLine &&
        previous.containerName === binding.containerName &&
        previous.typeName === binding.typeName &&
        previous.sourceSpecifier === binding.sourceSpecifier &&
        previous.importedName === binding.importedName &&
        previous.symbolKind === binding.symbolKind
      );
    });
}

function uniqSortedReferences(references: FileAnalysis["references"]): FileAnalysis["references"] {
  return references
    .slice()
    .sort((left, right) =>
      left.line === right.line
        ? `${left.kind}:${left.name}:${left.containerName ?? ""}`.localeCompare(
            `${right.kind}:${right.name}:${right.containerName ?? ""}`
          )
        : left.line - right.line
    )
    .filter((reference, index, items) => {
      if (index === 0) {
        return true;
      }

      const previous = items[index - 1];
      return !(
        previous.line === reference.line &&
        previous.name === reference.name &&
        previous.kind === reference.kind &&
        previous.containerName === reference.containerName
      );
    });
}

function uniqSortedEntryHints(entryHints: FileAnalysis["entryHints"]): FileAnalysis["entryHints"] {
  return entryHints
    .slice()
    .sort((left, right) =>
      left.line === right.line ? left.kind.localeCompare(right.kind) : left.line - right.line
    )
    .filter((hint, index, items) => {
      if (index === 0) {
        return true;
      }

      const previous = items[index - 1];
      return !(
        previous.line === hint.line &&
        previous.kind === hint.kind &&
        previous.symbolName === hint.symbolName &&
        previous.evidence === hint.evidence
      );
    });
}

export async function analyzeFileStructure(
  filePath: string,
  content: string,
  language: string,
  registry: StructureParserRegistry = createStructureParserRegistry()
): Promise<FileAnalysis> {
  const input: StructureParseInput = {
    filePath: normalizePath(filePath),
    content,
    language
  };

  try {
    const analysis = await registry.parse(input);
    const normalizedAnalysis = {
      ...analysis,
      scopeBindings:
        analysis.scopeBindings.length > 0
          ? analysis.scopeBindings
          : buildScopeBindings({
              filePath: analysis.filePath,
              language: analysis.language,
              symbols: analysis.symbols,
              importBindings: analysis.importBindings,
              localTypeHints: analysis.localTypeHints,
              references: analysis.references,
              imports: analysis.imports,
              entryHints: analysis.entryHints
            })
    };
    return {
      ...normalizedAnalysis,
      filePath: normalizePath(normalizedAnalysis.filePath),
      symbols: uniqSortedSymbols(normalizedAnalysis.symbols),
      references: uniqSortedReferences(normalizedAnalysis.references),
      importBindings: uniqSortedImportBindings(normalizedAnalysis.importBindings),
      exportBindings: uniqSortedExportBindings(normalizedAnalysis.exportBindings),
      scopeBindings: uniqSortedScopeBindings(normalizedAnalysis.scopeBindings),
      localTypeHints: uniqSortedLocalTypeHints(normalizedAnalysis.localTypeHints),
      imports: uniqSortedImports(normalizedAnalysis.imports),
      entryHints: uniqSortedEntryHints(normalizedAnalysis.entryHints),
      diagnostics: uniqSortedDiagnostics(normalizedAnalysis.diagnostics)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      filePath: input.filePath,
      language: input.language,
      parser: "failed",
      symbols: [],
      references: [],
      importBindings: [],
      exportBindings: [],
      scopeBindings: [],
      localTypeHints: [],
      imports: [],
      entryHints: [],
      diagnostics: [
        {
          level: "warning",
          message: `Structure parser failed: ${message}`,
          path: input.filePath
        }
      ]
    };
  }
}

export async function extractRepositorySymbols(
  scanResult: ScanResult,
  registry: StructureParserRegistry = createStructureParserRegistry()
): Promise<SymbolExtractionResult> {
  const supportedFiles = scanResult.files
    .filter((file) => SUPPORTED_LANGUAGES.has(file.language))
    .sort((left, right) => left.path.localeCompare(right.path));
  const files: FileAnalysis[] = [];
  const diagnostics: Diagnostic[] = [];

  for (const file of supportedFiles) {
    try {
      const content = await fs.readFile(path.resolve(scanResult.root, file.path), "utf8");
      const analysis = await analyzeFileStructure(file.path, content, file.language, registry);
      files.push(analysis);
      diagnostics.push(...analysis.diagnostics.map((diagnostic) => ({ ...diagnostic, path: diagnostic.path ?? file.path })));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      diagnostics.push({
        level: "warning",
        message: `Failed to analyze file structure: ${message}`,
        path: file.path
      });
      files.push({
        filePath: file.path,
        language: file.language,
        parser: "failed",
        symbols: [],
        references: [],
        importBindings: [],
        exportBindings: [],
        scopeBindings: [],
        localTypeHints: [],
        imports: [],
        entryHints: [],
        diagnostics: [
          {
            level: "warning",
            message: `Failed to analyze file structure: ${message}`,
            path: file.path
          }
        ]
      });
    }
  }

  const dependencyGraph = buildDependencyGraph(scanResult.root, files);
  const namespaceGraph = buildNamespaceSymbolGraph(scanResult.root, files);
  const symbolLinkGraph = buildSymbolLinks(scanResult.root, files, dependencyGraph, namespaceGraph);
  const symbolReferenceGraph = buildSymbolReferenceGraph(scanResult.root, files, symbolLinkGraph.links);
  const symbolCallGraph = buildSymbolCallGraph(scanResult.root, symbolReferenceGraph);
  const symbolCentralityGraph = buildSymbolCentralityGraph(
    scanResult.root,
    files,
    namespaceGraph,
    symbolReferenceGraph,
    symbolCallGraph
  );

  return {
    root: scanResult.root,
    files,
    namespaces: namespaceGraph,
    links: symbolLinkGraph.links,
    referenceEdges: symbolReferenceGraph.edges,
    calls: symbolCallGraph.calls,
    coreSymbols: symbolCentralityGraph,
    diagnostics: uniqSortedDiagnostics([
      ...diagnostics,
      ...namespaceGraph.diagnostics,
      ...symbolLinkGraph.diagnostics,
      ...symbolReferenceGraph.diagnostics,
      ...symbolCallGraph.diagnostics,
      ...symbolCentralityGraph.diagnostics
    ])
  };
}
