import path from "node:path";
import type {
  Diagnostic,
  EntryHint,
  FileAnalysis,
  ImportBinding,
  StructureParseInput,
  StructureParser,
  SymbolReference,
  SymbolDefinition,
  VariableTypeHint
} from "../types.js";

interface PythonClassCandidate extends SymbolDefinition {
  indent: number;
}

function normalizePath(filePath: string): string {
  return path.posix.normalize(filePath.split(path.sep).join(path.posix.sep));
}

function splitLines(content: string): string[] {
  return content.split(/\r?\n/u);
}

function countIndent(line: string): number {
  const match = /^(\s*)/u.exec(line);
  return match ? match[1].length : 0;
}

function findPythonBlockEnd(lines: string[], startIndex: number, indent: number): number {
  let endLine = startIndex + 1;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const trimmed = rawLine.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    const currentIndent = countIndent(rawLine);
    if (currentIndent <= indent) {
      return endLine;
    }

    endLine = index + 1;
  }

  return endLine;
}

function findBraceBlockEnd(lines: string[], startIndex: number): number {
  let depth = 0;
  let sawOpeningBrace = false;

  for (let index = startIndex; index < lines.length; index += 1) {
    for (const character of lines[index] ?? "") {
      if (character === "{") {
        depth += 1;
        sawOpeningBrace = true;
      } else if (character === "}") {
        depth -= 1;
        if (sawOpeningBrace && depth <= 0) {
          return index + 1;
        }
      }
    }
  }

  return startIndex + 1;
}

function hasUnbalancedBraces(content: string): boolean {
  let depth = 0;
  for (const character of content) {
    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth < 0) {
        return true;
      }
    }
  }

  return depth !== 0;
}

function sortSymbols(symbols: SymbolDefinition[]): SymbolDefinition[] {
  return symbols
    .slice()
    .sort((left, right) =>
      left.startLine === right.startLine
        ? `${left.kind}:${left.name}`.localeCompare(`${right.kind}:${right.name}`)
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
        previous.containerName === symbol.containerName
      );
    });
}

function sortDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics.slice().sort((left, right) => {
    const leftKey = `${left.path ?? ""}\u0000${left.level}\u0000${left.message}`;
    const rightKey = `${right.path ?? ""}\u0000${right.level}\u0000${right.message}`;
    return leftKey.localeCompare(rightKey);
  });
}

function sortReferences(references: SymbolReference[]): SymbolReference[] {
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

function sortImportBindings(importBindings: ImportBinding[]): ImportBinding[] {
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

function sortLocalTypeHints(localTypeHints: VariableTypeHint[]): VariableTypeHint[] {
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

function addReference(
  references: SymbolReference[],
  name: string,
  kind: SymbolReference["kind"],
  line: number,
  evidence: string,
  containerName?: string,
  qualifier?: string
): void {
  references.push({
    name,
    kind,
    line,
    evidence,
    containerName,
    qualifier
  });
}

function addLocalTypeHint(
  localTypeHints: VariableTypeHint[],
  name: string,
  typeName: string,
  line: number,
  evidence: string
): void {
  localTypeHints.push({
    name,
    typeName,
    line,
    evidence
  });
}

function parsePython(input: StructureParseInput): FileAnalysis {
  const filePath = normalizePath(input.filePath);
  const lines = splitLines(input.content);
  const symbols: SymbolDefinition[] = [];
  const references: SymbolReference[] = [];
  const importBindings: ImportBinding[] = [];
  const localTypeHints: VariableTypeHint[] = [];
  const imports: FileAnalysis["imports"] = [];
  const entryHints: EntryHint[] = [];
  const diagnostics: Diagnostic[] = [];
  const classes: PythonClassCandidate[] = [];

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    const fromMatch = /^from\s+([.\w]+)\s+import\s+(.+)$/u.exec(trimmed);
    if (fromMatch) {
      const importedNames = fromMatch[2]
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
      imports.push({
        specifier: fromMatch[1],
        kind: "import",
        line: index + 1,
        isInternal: fromMatch[1].startsWith("."),
        targetPath: undefined,
        resolution: fromMatch[1].startsWith(".") ? "unresolved" : "external",
        confidence: 0.72,
        evidence: [`regex: ${trimmed}`]
      });
      for (const importedName of importedNames) {
        const aliasMatch = /^([A-Za-z_]\w*)(?:\s+as\s+([A-Za-z_]\w*))?$/u.exec(importedName);
        if (!aliasMatch) {
          continue;
        }
        importBindings.push({
          localName: aliasMatch[2] ?? aliasMatch[1],
          importedName: aliasMatch[1],
          sourceSpecifier: fromMatch[1],
          kind: "named",
          line: index + 1
        });
      }
      continue;
    }

    const importMatch = /^import\s+(.+)$/u.exec(trimmed);
    if (importMatch) {
      const modules = importMatch[1]
        .split(",")
        .map((part) => part.trim().split(/\s+as\s+/u)[0]?.trim())
        .filter((part): part is string => Boolean(part));
      for (const moduleName of modules) {
        const baseName = moduleName.split(".").pop() ?? moduleName;
        imports.push({
          specifier: moduleName,
          kind: "import",
          line: index + 1,
          isInternal: moduleName.startsWith("."),
          targetPath: undefined,
          resolution: moduleName.startsWith(".") ? "unresolved" : "external",
          confidence: 0.68,
          evidence: [`regex: ${trimmed}`]
        });
        importBindings.push({
          localName: baseName,
          importedName: baseName,
          sourceSpecifier: moduleName,
          kind: "module",
          line: index + 1
        });
      }
      continue;
    }

    const classMatch = /^class\s+([A-Za-z_]\w*)\b[^:]*:/u.exec(trimmed);
    if (classMatch) {
      const indent = countIndent(line);
      const classSymbol: PythonClassCandidate = {
        name: classMatch[1],
        kind: "class",
        startLine: index + 1,
        endLine: findPythonBlockEnd(lines, index, indent),
        indent
      };
      classes.push(classSymbol);
      symbols.push(classSymbol);
      continue;
    }

    const functionMatch = /^def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:->[^:]*)?:/u.exec(trimmed);
    if (functionMatch) {
      const indent = countIndent(line);
      const container = classes
        .filter((item) => item.startLine < index + 1 && item.endLine >= index + 1 && item.indent < indent)
        .sort((left, right) => right.indent - left.indent)[0];
      const functionName = functionMatch[1];
      symbols.push({
        name: functionName,
        kind: container ? "method" : "function",
        startLine: index + 1,
        endLine: findPythonBlockEnd(lines, index, indent),
        containerName: container?.name,
        signature: `def ${functionName}(${functionMatch[2]})`
      });

      if (functionName === "main") {
        entryHints.push({
          kind: "function-main",
          line: index + 1,
          symbolName: functionName,
          evidence: "Regex parser detected Python main function candidate."
        });
      }
    }

    if (trimmed === 'if __name__ == "__main__":' || trimmed === "if __name__ == '__main__':") {
      entryHints.push({
        kind: "python-main-guard",
        line: index + 1,
        evidence: "Regex parser detected Python __main__ guard."
      });
    }

    const activeContainer = symbols
      .filter((symbol) => symbol.startLine <= index + 1 && symbol.endLine >= index + 1)
      .sort((left, right) => right.startLine - left.startLine)[0];

    const localTypeHintMatch = /^([a-z_]\w*)\s*=\s*([A-Z][A-Za-z0-9_]*)\s*\(/u.exec(trimmed);
    if (localTypeHintMatch) {
      addLocalTypeHint(
        localTypeHints,
        localTypeHintMatch[1],
        localTypeHintMatch[2],
        index + 1,
        `regex: ${trimmed}`
      );
    }

    for (const match of trimmed.matchAll(/\b([A-Za-z_]\w*)\s*\(/gu)) {
      const calleeName = match[1];
      if (calleeName === "def" || calleeName === "class") {
        continue;
      }

      addReference(references, calleeName, "call", index + 1, `regex: ${trimmed}`, activeContainer?.name);
    }

    for (const match of trimmed.matchAll(/\b([A-Z][A-Za-z0-9_]*)\s*\(/gu)) {
      addReference(references, match[1], "type", index + 1, `regex: ${trimmed}`, activeContainer?.name);
    }
  }

  return {
    filePath,
    language: "Python",
    parser: "regex-python",
    symbols: sortSymbols(symbols),
    references: sortReferences(references),
    importBindings: sortImportBindings(importBindings),
    localTypeHints: sortLocalTypeHints(localTypeHints),
    imports: imports.sort((left, right) =>
      left.line === right.line ? left.specifier.localeCompare(right.specifier) : left.line - right.line
    ),
    entryHints: entryHints.sort((left, right) =>
      left.line === right.line ? left.kind.localeCompare(right.kind) : left.line - right.line
    ),
    diagnostics: sortDiagnostics(diagnostics)
  };
}

function parseTypeScriptLike(input: StructureParseInput, language: "TypeScript" | "JavaScript"): FileAnalysis {
  const filePath = normalizePath(input.filePath);
  const lines = splitLines(input.content);
  const symbols: SymbolDefinition[] = [];
  const references: SymbolReference[] = [];
  const importBindings: ImportBinding[] = [];
  const localTypeHints: VariableTypeHint[] = [];
  const imports: FileAnalysis["imports"] = [];
  const entryHints: EntryHint[] = [];
  const diagnostics: Diagnostic[] = [];
  const classRanges: SymbolDefinition[] = [];
  const isComponentFile = /\.(tsx|jsx)$/iu.test(filePath);

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("//")) {
      continue;
    }

    const importMatch =
      /^\s*import\s+.+?\s+from\s+["']([^"']+)["']/u.exec(line) ??
      /^\s*import\s+["']([^"']+)["']/u.exec(line) ??
      /require\(\s*["']([^"']+)["']\s*\)/u.exec(line);
    if (importMatch) {
      const specifier = importMatch[1];
      imports.push({
        specifier,
        kind: "import",
        line: index + 1,
        isInternal: specifier.startsWith(".") || specifier.startsWith("/"),
        targetPath: undefined,
        resolution: specifier.startsWith(".") || specifier.startsWith("/") ? "unresolved" : "external",
        confidence: 0.75,
        evidence: [`regex: ${trimmed}`]
      });

      const clauseMatch = /^\s*import\s+(.+?)\s+from\s+["'][^"']+["']/u.exec(line);
      const clause = clauseMatch?.[1]?.trim();
      if (clause) {
        const namespaceMatch = /^\*\s+as\s+([A-Za-z_]\w*)$/u.exec(clause);
        if (namespaceMatch) {
          importBindings.push({
            localName: namespaceMatch[1],
            sourceSpecifier: specifier,
            kind: "namespace",
            line: index + 1
          });
        } else {
          const [defaultPartRaw, namedPartRaw] = clause.split(",", 2);
          const defaultPart = defaultPartRaw?.trim();
          if (defaultPart && !defaultPart.startsWith("{")) {
            importBindings.push({
              localName: defaultPart,
              importedName: "default",
              sourceSpecifier: specifier,
              kind: "default",
              line: index + 1
            });
          }

          const namedPart = (namedPartRaw ?? (defaultPart?.startsWith("{") ? defaultPart : undefined))?.trim();
          if (namedPart?.startsWith("{") && namedPart.endsWith("}")) {
            for (const member of namedPart.slice(1, -1).split(",")) {
              const trimmedMember = member.trim();
              if (trimmedMember.length === 0) {
                continue;
              }

              const aliasMatch = /^([A-Za-z_]\w*)(?:\s+as\s+([A-Za-z_]\w*))?$/u.exec(trimmedMember);
              if (!aliasMatch) {
                continue;
              }

              importBindings.push({
                localName: aliasMatch[2] ?? aliasMatch[1],
                importedName: aliasMatch[1],
                sourceSpecifier: specifier,
                kind: "named",
                line: index + 1
              });
            }
          }
        }
      }
    }

    const classMatch = /^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_]\w*)\b/u.exec(line);
    if (classMatch) {
      const classSymbol: SymbolDefinition = {
        name: classMatch[1],
        kind: "class",
        startLine: index + 1,
        endLine: findBraceBlockEnd(lines, index)
      };
      classRanges.push(classSymbol);
      symbols.push(classSymbol);
      continue;
    }

    const functionMatch = /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/u.exec(line);
    if (functionMatch) {
      const functionName = functionMatch[1];
      symbols.push({
        name: functionName,
        kind: isComponentFile && /^[A-Z]/u.test(functionName) ? "component" : "function",
        startLine: index + 1,
        endLine: findBraceBlockEnd(lines, index),
        signature: `function ${functionName}(${functionMatch[2]})`
      });

      if (functionName === "main") {
        entryHints.push({
          kind: "function-main",
          line: index + 1,
          symbolName: functionName,
          evidence: `Regex parser detected ${language} main function candidate.`
        });
      }
      continue;
    }

    const constFunctionMatch =
      /^\s*(?:export\s+)?const\s+([A-Za-z_]\w*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*(?::\s*[^=]+)?=>/u.exec(line) ??
      /^\s*(?:export\s+)?const\s+([A-Za-z_]\w*)\s*=\s*function\s*\(([^)]*)\)/u.exec(line);
    if (constFunctionMatch) {
      const functionName = constFunctionMatch[1];
      symbols.push({
        name: functionName,
        kind: isComponentFile && /^[A-Z]/u.test(functionName) ? "component" : "function",
        startLine: index + 1,
        endLine: findBraceBlockEnd(lines, index),
        signature: `const ${functionName}(${constFunctionMatch[2]})`
      });
    }

    const activeContainer = symbols
      .filter((symbol) => symbol.startLine <= index + 1 && symbol.endLine >= index + 1)
      .sort((left, right) => right.startLine - left.startLine)[0];

    const localTypeHintMatch =
      /^\s*(?:const|let|var)\s+([a-zA-Z_]\w*)\s*=\s*new\s+([A-Z][A-Za-z0-9_]*)\s*\(/u.exec(trimmed) ??
      /^\s*(?:const|let|var)\s+([a-zA-Z_]\w*)\s*:\s*([A-Z][A-Za-z0-9_.<>]*)\s*=/u.exec(trimmed);
    if (localTypeHintMatch) {
      addLocalTypeHint(
        localTypeHints,
        localTypeHintMatch[1],
        localTypeHintMatch[2].replace(/<.*$/u, ""),
        index + 1,
        `regex: ${trimmed}`
      );
    }

    for (const match of trimmed.matchAll(/\bnew\s+([A-Za-z_]\w*)\s*\(/gu)) {
      addReference(references, match[1], "new", index + 1, `regex: ${trimmed}`, activeContainer?.name);
    }
    for (const match of trimmed.matchAll(/\b([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*\(/gu)) {
      addReference(
        references,
        match[2],
        "call",
        index + 1,
        `regex: ${trimmed}`,
        activeContainer?.name,
        match[1]
      );
    }
    for (const match of trimmed.matchAll(/\b([A-Za-z_]\w*)\s*\(/gu)) {
      const calleeName = match[1];
      if (calleeName === "if" || calleeName === "for" || calleeName === "while" || calleeName === "switch") {
        continue;
      }
      addReference(references, calleeName, "call", index + 1, `regex: ${trimmed}`, activeContainer?.name);
    }
    if (isComponentFile) {
      for (const match of trimmed.matchAll(/<([A-Z][A-Za-z0-9_]*)\b/gu)) {
        addReference(references, match[1], "component", index + 1, `regex: ${trimmed}`, activeContainer?.name);
      }
    }
  }

  for (const classSymbol of classRanges) {
    for (let lineIndex = classSymbol.startLine; lineIndex < classSymbol.endLine; lineIndex += 1) {
      const line = lines[lineIndex];
      if (!line) {
        continue;
      }

      const methodMatch =
        /^\s*(?:public\s+|private\s+|protected\s+|static\s+|async\s+)*(?!constructor\b)([A-Za-z_]\w*)\s*\(([^;]*)\)\s*(?::\s*[^{]+)?\{/u.exec(
          line
        ) ?? undefined;
      if (!methodMatch) {
        continue;
      }

      symbols.push({
        name: methodMatch[1],
        kind: "method",
        startLine: lineIndex + 1,
        endLine: findBraceBlockEnd(lines, lineIndex),
        containerName: classSymbol.name,
        signature: `${methodMatch[1]}(${methodMatch[2]})`
      });
    }
  }

  for (const [index, line] of lines.entries()) {
    if (/ReactDOM\.createRoot|createRoot\(|createApp\(|new\s+Vue\(/u.test(line)) {
      entryHints.push({
        kind: "framework-bootstrap",
        line: index + 1,
        evidence: `Regex parser detected ${language} framework bootstrap.`
      });
    }
  }

  if (hasUnbalancedBraces(input.content)) {
    diagnostics.push({
      level: "warning",
      message: "Unbalanced braces detected; symbol extraction may be incomplete.",
      path: filePath
    });
  }

  return {
    filePath,
    language,
    parser: `regex-${language.toLowerCase()}`,
    symbols: sortSymbols(symbols),
    references: sortReferences(references),
    importBindings: sortImportBindings(importBindings),
    localTypeHints: sortLocalTypeHints(localTypeHints),
    imports: imports.sort((left, right) =>
      left.line === right.line ? left.specifier.localeCompare(right.specifier) : left.line - right.line
    ),
    entryHints: entryHints.sort((left, right) =>
      left.line === right.line ? left.kind.localeCompare(right.kind) : left.line - right.line
    ),
    diagnostics: sortDiagnostics(diagnostics)
  };
}

function parseCppLike(input: StructureParseInput, language: "C" | "C++"): FileAnalysis {
  const filePath = normalizePath(input.filePath);
  const lines = splitLines(input.content);
  const symbols: SymbolDefinition[] = [];
  const references: SymbolReference[] = [];
  const importBindings: ImportBinding[] = [];
  const localTypeHints: VariableTypeHint[] = [];
  const imports: FileAnalysis["imports"] = [];
  const entryHints: EntryHint[] = [];
  const diagnostics: Diagnostic[] = [];
  const classRanges: SymbolDefinition[] = [];
  const reservedNames = new Set(["if", "for", "while", "switch", "catch"]);

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    const includeMatch = /^\s*#include\s*([<"])([^>"]+)[>"]/u.exec(line);
    if (includeMatch) {
      const isInternal = includeMatch[1] === '"';
      imports.push({
        specifier: includeMatch[2],
        kind: "include",
        line: index + 1,
        isInternal,
        targetPath: undefined,
        resolution: isInternal ? "unresolved" : "external",
        confidence: 0.76,
        evidence: [`regex: ${line.trim()}`]
      });
    }

    const classMatch = /^\s*class\s+([A-Za-z_]\w*)\b/u.exec(line);
    if (classMatch) {
      const classSymbol: SymbolDefinition = {
        name: classMatch[1],
        kind: "class",
        startLine: index + 1,
        endLine: findBraceBlockEnd(lines, index)
      };
      classRanges.push(classSymbol);
      symbols.push(classSymbol);
      continue;
    }

    const functionMatch =
      /^\s*(?:template\s*<[^>]+>\s*)?(?:inline\s+)?(?:static\s+)?(?:virtual\s+)?(?:[\w:<>~*&]+\s+)+([A-Za-z_]\w*(?:::\w+)?)\s*\(([^;{}]*)\)\s*(?:const\s*)?\{/u.exec(
        line
      );
    if (functionMatch) {
      const rawName = functionMatch[1];
      const functionName = rawName.includes("::") ? rawName.split("::").pop() ?? rawName : rawName;
      if (reservedNames.has(functionName)) {
        continue;
      }

      const containerName = rawName.includes("::") ? rawName.split("::")[0] : undefined;
      const symbolKind = rawName.includes("::") ? "method" : "function";
      symbols.push({
        name: functionName,
        kind: symbolKind,
        startLine: index + 1,
        endLine: findBraceBlockEnd(lines, index),
        containerName,
        signature: `${functionName}(${functionMatch[2].trim()})`
      });

      if (functionName === "main") {
        entryHints.push({
          kind: "cpp-main",
          line: index + 1,
          symbolName: functionName,
          evidence: "Regex parser detected C/C++ main function candidate."
        });
      }
    }

    const activeContainer = symbols
      .filter((symbol) => symbol.startLine <= index + 1 && symbol.endLine >= index + 1)
      .sort((left, right) => right.startLine - left.startLine)[0];

    const localTypeHintMatch =
      /^\s*([A-Z][A-Za-z0-9_:<>]*)\s+([a-z_]\w*)\s*(?:[;=({])/u.exec(trimmed) ??
      /^\s*([A-Z][A-Za-z0-9_:<>]*)\s+([a-zA-Z_]\w*)\s*=\s*[A-Z][A-Za-z0-9_:<>]*\s*\(/u.exec(trimmed);
    if (localTypeHintMatch) {
      addLocalTypeHint(
        localTypeHints,
        localTypeHintMatch[2],
        localTypeHintMatch[1].replace(/<.*$/u, "").split("::").pop() ?? localTypeHintMatch[1],
        index + 1,
        `regex: ${trimmed}`
      );
    }

    for (const match of trimmed.matchAll(/\bnew\s+([A-Za-z_]\w*)\s*\(/gu)) {
      addReference(references, match[1], "new", index + 1, `regex: ${trimmed}`, activeContainer?.name);
    }
    for (const match of trimmed.matchAll(/\b([A-Za-z_]\w*)\s*\(/gu)) {
      const calleeName = match[1];
      if (reservedNames.has(calleeName)) {
        continue;
      }
      addReference(references, calleeName, "call", index + 1, `regex: ${trimmed}`, activeContainer?.name);
    }
    for (const match of trimmed.matchAll(/\b([A-Z][A-Za-z0-9_]*)\s+[A-Za-z_]\w*\s*(?:=|;|\{)/gu)) {
      addReference(
        references,
        match[1],
        "type",
        index + 1,
        `regex: ${trimmed}`,
        activeContainer?.name
      );
    }
  }

  for (const classSymbol of classRanges) {
    for (let lineIndex = classSymbol.startLine; lineIndex < classSymbol.endLine; lineIndex += 1) {
      const line = lines[lineIndex];
      if (!line) {
        continue;
      }

      const methodMatch = /^\s*(?:[\w:<>~*&]+\s+)+([A-Za-z_]\w*)\s*\(([^;{}]*)\)\s*(?:const\s*)?(?:\{|;)/u.exec(line);
      if (!methodMatch || reservedNames.has(methodMatch[1])) {
        continue;
      }

      symbols.push({
        name: methodMatch[1],
        kind: "method",
        startLine: lineIndex + 1,
        endLine: line.includes("{") ? findBraceBlockEnd(lines, lineIndex) : lineIndex + 1,
        containerName: classSymbol.name,
        signature: `${methodMatch[1]}(${methodMatch[2].trim()})`
      });
    }
  }

  if (hasUnbalancedBraces(input.content)) {
    diagnostics.push({
      level: "warning",
      message: "Unbalanced braces detected; symbol extraction may be incomplete.",
      path: filePath
    });
  }

  return {
    filePath,
    language,
    parser: `regex-${language.toLowerCase().replace(/\+/gu, "p")}`,
    symbols: sortSymbols(symbols),
    references: sortReferences(references),
    importBindings: sortImportBindings(importBindings),
    localTypeHints: sortLocalTypeHints(localTypeHints),
    imports: imports.sort((left, right) =>
      left.line === right.line ? left.specifier.localeCompare(right.specifier) : left.line - right.line
    ),
    entryHints: entryHints.sort((left, right) =>
      left.line === right.line ? left.kind.localeCompare(right.kind) : left.line - right.line
    ),
    diagnostics: sortDiagnostics(diagnostics)
  };
}

export const regexStructureParsers: StructureParser[] = [
  {
    language: "Python",
    parse: (input) => parsePython(input)
  },
  {
    language: "TypeScript",
    parse: (input) => parseTypeScriptLike(input, "TypeScript")
  },
  {
    language: "JavaScript",
    parse: (input) => parseTypeScriptLike(input, "JavaScript")
  },
  {
    language: "C",
    parse: (input) => parseCppLike(input, "C")
  },
  {
    language: "C++",
    parse: (input) => parseCppLike(input, "C++")
  }
];
