import type { FileAnalysis, ScopeBinding, SymbolDefinition } from "./types.js";

function uniqueSorted(bindings: ScopeBinding[]): ScopeBinding[] {
  return bindings
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

function maxLine(analysis: Pick<FileAnalysis, "symbols" | "references" | "imports" | "entryHints" | "localTypeHints">): number {
  return Math.max(
    1,
    ...analysis.symbols.map((item) => item.endLine),
    ...analysis.references.map((item) => item.line),
    ...analysis.imports.map((item) => item.line),
    ...analysis.entryHints.map((item) => item.line),
    ...analysis.localTypeHints.map((item) => item.line)
  );
}

function findContainingSymbol(symbols: SymbolDefinition[], line: number): SymbolDefinition | undefined {
  return symbols
    .filter((symbol) => symbol.startLine <= line && symbol.endLine >= line)
    .sort((left, right) => {
      const leftSpan = left.endLine - left.startLine;
      const rightSpan = right.endLine - right.startLine;
      return leftSpan === rightSpan ? right.startLine - left.startLine : leftSpan - rightSpan;
    })[0];
}

function normalizeTypeName(typeText: string): string | undefined {
  const raw = typeText.trim().replace(/<.*$/u, "").replace(/\[\]$/u, "");
  const match = /([A-Za-z_]\w*)$/u.exec(raw);
  return match?.[1];
}

function parseParameters(signature: string | undefined, language: string): Array<{ name: string; typeName?: string }> {
  if (!signature) {
    return [];
  }

  const start = signature.indexOf("(");
  const end = signature.lastIndexOf(")");
  if (start < 0 || end <= start) {
    return [];
  }

  const parameterText = signature.slice(start + 1, end).trim();
  if (parameterText.length === 0) {
    return [];
  }

  const parts = parameterText.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
  if (language === "Python") {
    const bindings: Array<{ name: string; typeName?: string }> = [];
    for (const part of parts) {
      const cleaned = part.replace(/=.*/u, "").trim();
      const match = /^([A-Za-z_]\w*)(?::\s*([^=]+))?$/u.exec(cleaned);
      if (!match) {
        continue;
      }

      bindings.push({
        name: match[1],
        typeName: match[2] ? normalizeTypeName(match[2]) : undefined
      });
    }

    return bindings;
  }

  const bindings: Array<{ name: string; typeName?: string }> = [];
  for (const part of parts) {
    const cleaned = part.replace(/=.*/u, "").trim();
    const match =
      /^([A-Za-z_]\w*)\s*:\s*(.+)$/u.exec(cleaned) ??
      /^(?:const\s+)?(?:[\w:<>*&]+\s+)+([A-Za-z_]\w*)$/u.exec(cleaned);
    if (!match) {
      continue;
    }

    if (match.length >= 3) {
      bindings.push({
        name: match[1],
        typeName: normalizeTypeName(match[2])
      });
      continue;
    }

    bindings.push({
      name: match[1]
    });
  }

  return bindings;
}

export function buildScopeBindings(
  analysis: Pick<
    FileAnalysis,
    "filePath" | "language" | "symbols" | "importBindings" | "localTypeHints" | "references" | "imports" | "entryHints"
  >
): ScopeBinding[] {
  const bindings: ScopeBinding[] = [];
  const fileEndLine = maxLine(analysis);

  for (const symbol of analysis.symbols) {
    const owner = symbol.containerName
      ? analysis.symbols.find((candidate) => candidate.name === symbol.containerName && candidate.kind === "class")
      : undefined;
    bindings.push({
      name: symbol.name,
      kind: "symbol",
      line: symbol.startLine,
      scopeStartLine: owner?.startLine ?? symbol.startLine,
      scopeEndLine: owner?.endLine ?? fileEndLine,
      containerName: symbol.containerName,
      symbolKind: symbol.kind,
      evidence: `symbol:${symbol.kind}`
    });

    const parameters = parseParameters(symbol.signature, analysis.language);
    for (const parameter of parameters) {
      bindings.push({
        name: parameter.name,
        kind: "parameter",
        line: symbol.startLine,
        scopeStartLine: symbol.startLine,
        scopeEndLine: symbol.endLine,
        containerName: symbol.name,
        typeName: parameter.typeName,
        evidence: `parameter:${symbol.name}`
      });
    }

    if (symbol.kind === "method" && symbol.containerName) {
      const implicitName = analysis.language === "Python" ? "self" : "this";
      bindings.push({
        name: implicitName,
        kind: analysis.language === "Python" ? "implicit-self" : "implicit-this",
        line: symbol.startLine,
        scopeStartLine: symbol.startLine,
        scopeEndLine: symbol.endLine,
        containerName: symbol.name,
        typeName: symbol.containerName,
        evidence: `implicit:${implicitName}`
      });
    }
  }

  for (const importBinding of analysis.importBindings) {
    bindings.push({
      name: importBinding.localName,
      kind: importBinding.kind === "module" ? "module" : "import",
      line: importBinding.line,
      scopeStartLine: 1,
      scopeEndLine: fileEndLine,
      sourceSpecifier: importBinding.sourceSpecifier,
      importedName: importBinding.importedName,
      evidence: `import:${importBinding.kind}`
    });
  }

  for (const localTypeHint of analysis.localTypeHints) {
    const container = findContainingSymbol(analysis.symbols, localTypeHint.line);
    bindings.push({
      name: localTypeHint.name,
      kind: "variable",
      line: localTypeHint.line,
      scopeStartLine: container?.startLine ?? 1,
      scopeEndLine: container?.endLine ?? fileEndLine,
      containerName: container?.name,
      typeName: localTypeHint.typeName,
      evidence: localTypeHint.evidence
    });
  }

  return uniqueSorted(bindings);
}
