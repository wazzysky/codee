import path from "node:path";
import type {
  Diagnostic,
  EntryHint,
  FileAnalysis,
  ImportBinding,
  StructureParseInput,
  StructureParser,
  SymbolReference,
  SymbolDefinition
} from "../types.js";

type TreeSitterModule = {
  default?: new () => {
    setLanguage: (language: unknown) => void;
    parse: (source: string) => {
      rootNode: TreeSitterNode;
    };
  };
};

interface TreeSitterNode {
  type: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  text: string;
  namedChildren: TreeSitterNode[];
  childForFieldName?: (name: string) => TreeSitterNode | null;
}

interface TreeSitterLanguageLoader {
  language: string;
  parserPackage: string;
  grammarSelector?: (module: Record<string, unknown>, filePath: string) => unknown;
}

const TREE_SITTER_LOADERS: TreeSitterLanguageLoader[] = [
  { language: "Python", parserPackage: "tree-sitter-python" },
  {
    language: "TypeScript",
    parserPackage: "tree-sitter-typescript",
    grammarSelector: (module, filePath) =>
      /\.(tsx)$/iu.test(filePath)
        ? (module.tsx ?? toRecord(module.default).tsx)
        : (module.typescript ?? toRecord(module.default).typescript)
  },
  { language: "JavaScript", parserPackage: "tree-sitter-javascript" },
  { language: "C", parserPackage: "tree-sitter-c" },
  { language: "C++", parserPackage: "tree-sitter-cpp" }
];

const parserCache = new Map<string, StructureParser | null>();

function normalizePath(filePath: string): string {
  return path.posix.normalize(filePath.split(path.sep).join(path.posix.sep));
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function createImportReference(
  specifier: string,
  line: number,
  kind: "import" | "include",
  isInternal: boolean,
  evidence: string
): FileAnalysis["imports"][number] {
  return {
    specifier,
    kind,
    line,
    isInternal,
    targetPath: undefined,
    resolution: isInternal ? "unresolved" : "external",
    confidence: 0.9,
    evidence: [evidence]
  };
}

function addSymbol(
  symbols: SymbolDefinition[],
  name: string,
  kind: SymbolDefinition["kind"],
  node: TreeSitterNode,
  containerName?: string,
  signature?: string
): void {
  symbols.push({
    name,
    kind,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    containerName,
    signature
  });
}

function addReference(
  references: SymbolReference[],
  name: string,
  kind: SymbolReference["kind"],
  node: TreeSitterNode,
  evidence: string,
  containerName?: string,
  qualifier?: string
): void {
  references.push({
    name,
    kind,
    line: node.startPosition.row + 1,
    evidence,
    containerName,
    qualifier
  });
}

function extractTrailingIdentifier(text: string): string | undefined {
  const sanitized = text.replace(/[!?]+$/gu, "").trim();
  const match = /([A-Za-z_]\w*)$/u.exec(sanitized);
  return match?.[1];
}

function extractCallTargetName(node: TreeSitterNode): string | undefined {
  const functionNode = node.childForFieldName?.("function");
  if (functionNode?.text) {
    return extractTrailingIdentifier(functionNode.text);
  }

  const match = /^([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*\(/u.exec(node.text.trim());
  if (!match) {
    return undefined;
  }

  return extractTrailingIdentifier(match[1]);
}

function extractCallQualifier(node: TreeSitterNode): string | undefined {
  const functionNode = node.childForFieldName?.("function");
  if (functionNode?.text && functionNode.text.includes(".")) {
    const parts = functionNode.text.split(".");
    if (parts.length >= 2) {
      return extractTrailingIdentifier(parts[parts.length - 2] ?? "");
    }
  }

  const match = /^([A-Za-z_]\w*)\.[A-Za-z_]\w*\s*\(/u.exec(node.text.trim());
  return match?.[1];
}

function extractConstructedTypeName(node: TreeSitterNode): string | undefined {
  const constructorNode = node.childForFieldName?.("constructor");
  if (constructorNode?.text) {
    return extractTrailingIdentifier(constructorNode.text);
  }

  const match = /^new\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*\(/u.exec(node.text.trim());
  if (!match) {
    return undefined;
  }

  return extractTrailingIdentifier(match[1]);
}

function extractJsxTagName(node: TreeSitterNode): string | undefined {
  const nameNode = node.childForFieldName?.("name");
  const rawName = nameNode?.text ?? /^<([A-Za-z_][A-Za-z0-9_.]*)\b/u.exec(node.text.trim())?.[1];
  if (!rawName) {
    return undefined;
  }

  return extractTrailingIdentifier(rawName);
}

function parseImportBindingsFromText(text: string, specifier: string, line: number, language: string): ImportBinding[] {
  const bindings: ImportBinding[] = [];

  if (language === "Python") {
    const fromMatch = /^from\s+[.\w]+\s+import\s+(.+)$/u.exec(text.trim());
    if (fromMatch) {
      for (const member of fromMatch[1].split(",")) {
        const trimmedMember = member.trim();
        const aliasMatch = /^([A-Za-z_]\w*)(?:\s+as\s+([A-Za-z_]\w*))?$/u.exec(trimmedMember);
        if (!aliasMatch) {
          continue;
        }

        bindings.push({
          localName: aliasMatch[2] ?? aliasMatch[1],
          importedName: aliasMatch[1],
          sourceSpecifier: specifier,
          kind: "named",
          line
        });
      }

      return bindings;
    }

    const importMatch = /^import\s+(.+)$/u.exec(text.trim());
    if (importMatch) {
      for (const member of importMatch[1].split(",")) {
        const trimmedMember = member.trim().split(/\s+as\s+/u)[0]?.trim();
        if (!trimmedMember) {
          continue;
        }

        const baseName = trimmedMember.split(".").pop() ?? trimmedMember;
        bindings.push({
          localName: baseName,
          importedName: baseName,
          sourceSpecifier: trimmedMember,
          kind: "module",
          line
        });
      }
    }

    return bindings;
  }

  const clauseMatch = /^\s*import\s+(.+?)\s+from\s+["'][^"']+["']/u.exec(text);
  const clause = clauseMatch?.[1]?.trim();
  if (!clause) {
    return bindings;
  }

  const namespaceMatch = /^\*\s+as\s+([A-Za-z_]\w*)$/u.exec(clause);
  if (namespaceMatch) {
    bindings.push({
      localName: namespaceMatch[1],
      sourceSpecifier: specifier,
      kind: "namespace",
      line
    });
    return bindings;
  }

  const splitIndex = clause.startsWith("{") ? -1 : clause.indexOf(",");
  const defaultPartRaw = splitIndex >= 0 ? clause.slice(0, splitIndex) : clause;
  const namedPartRaw = splitIndex >= 0 ? clause.slice(splitIndex + 1) : undefined;
  const defaultPart = defaultPartRaw?.trim();
  if (defaultPart && !defaultPart.startsWith("{")) {
    bindings.push({
      localName: defaultPart,
      importedName: "default",
      sourceSpecifier: specifier,
      kind: "default",
      line
    });
  }

  const namedPart = (namedPartRaw ?? (defaultPart?.startsWith("{") ? defaultPart : undefined))?.trim();
  if (namedPart?.startsWith("{") && namedPart.endsWith("}")) {
    for (const member of namedPart.slice(1, -1).split(",")) {
      const trimmedMember = member.trim();
      const aliasMatch = /^([A-Za-z_]\w*)(?:\s+as\s+([A-Za-z_]\w*))?$/u.exec(trimmedMember);
      if (!aliasMatch) {
        continue;
      }

      bindings.push({
        localName: aliasMatch[2] ?? aliasMatch[1],
        importedName: aliasMatch[1],
        sourceSpecifier: specifier,
        kind: "named",
        line
      });
    }
  }

  return bindings;
}

function collectDiagnostics(filePath: string, error: unknown): Diagnostic[] {
  const message = error instanceof Error ? error.message : String(error);
  return [
    {
      level: "warning",
      message: `Tree-sitter parser unavailable: ${message}`,
      path: filePath
    }
  ];
}

async function importNativeTreeSitterModule<T>(specifier: string): Promise<T> {
  const previousElectronRunAsNode = process.env.ELECTRON_RUN_AS_NODE;

  try {
    delete process.env.ELECTRON_RUN_AS_NODE;
    return (await import(specifier)) as T;
  } finally {
    if (previousElectronRunAsNode === undefined) {
      delete process.env.ELECTRON_RUN_AS_NODE;
    } else {
      process.env.ELECTRON_RUN_AS_NODE = previousElectronRunAsNode;
    }
  }
}

function parseWithTreeSitter(language: string, filePath: string, rootNode: TreeSitterNode): FileAnalysis {
  const symbols: SymbolDefinition[] = [];
  const references: SymbolReference[] = [];
  const importBindings: ImportBinding[] = [];
  const imports: FileAnalysis["imports"] = [];
  const entryHints: EntryHint[] = [];

  const visit = (node: TreeSitterNode, containerName?: string): void => {
    if (language === "Python") {
      if (node.type === "import_statement" || node.type === "import_from_statement") {
        const match =
          /^import\s+(.+)$/u.exec(node.text.trim()) ?? /^from\s+([.\w]+)\s+import\s+(.+)$/u.exec(node.text.trim());
        if (match) {
          const specifier = node.text.trim().startsWith("from ") ? match[1] : match[1].split(",")[0]?.trim();
          if (specifier) {
            imports.push(
              createImportReference(
                specifier,
                node.startPosition.row + 1,
                "import",
                specifier.startsWith("."),
                `tree-sitter:${node.type}`
              )
            );
            importBindings.push(
              ...parseImportBindingsFromText(node.text, specifier, node.startPosition.row + 1, language)
            );
          }
        }
      } else if (node.type === "class_definition") {
        const nameNode = node.childForFieldName?.("name");
        if (nameNode) {
          addSymbol(symbols, nameNode.text, "class", node);
        }
      } else if (node.type === "function_definition") {
        const nameNode = node.childForFieldName?.("name");
        if (nameNode) {
          const kind = containerName ? "method" : "function";
          addSymbol(symbols, nameNode.text, kind, node, containerName, node.text.split(/\r?\n/u)[0]?.trim());
          if (nameNode.text === "main") {
            entryHints.push({
              kind: "function-main",
              line: node.startPosition.row + 1,
              symbolName: nameNode.text,
              evidence: "Tree-sitter detected Python main function candidate."
            });
          }
        }
      } else if (
        node.type === "if_statement" &&
        /__name__\s*==\s*['"]__main__['"]/u.test(node.text)
      ) {
        entryHints.push({
          kind: "python-main-guard",
          line: node.startPosition.row + 1,
          evidence: "Tree-sitter detected Python __main__ guard."
        });
      } else if (node.type === "call") {
        const calleeName = extractCallTargetName(node);
        if (calleeName) {
          addReference(
            references,
            calleeName,
            "call",
            node,
            `tree-sitter:${node.type}`,
            containerName,
            extractCallQualifier(node)
          );
        }
      }
    } else if (language === "TypeScript" || language === "JavaScript") {
      if (node.type === "import_statement") {
        const sourceNode = node.childForFieldName?.("source");
        const specifier = sourceNode?.text.replace(/^['"]|['"]$/gu, "");
        if (specifier) {
          imports.push(
            createImportReference(
              specifier,
              node.startPosition.row + 1,
              "import",
              specifier.startsWith(".") || specifier.startsWith("/"),
                `tree-sitter:${node.type}`
              )
            );
          importBindings.push(
            ...parseImportBindingsFromText(node.text, specifier, node.startPosition.row + 1, language)
          );
        }
      } else if (node.type === "class_declaration") {
        const nameNode = node.childForFieldName?.("name");
        if (nameNode) {
          addSymbol(symbols, nameNode.text, "class", node);
        }
      } else if (node.type === "function_declaration") {
        const nameNode = node.childForFieldName?.("name");
        if (nameNode) {
          const kind =
            /\.(tsx|jsx)$/iu.test(filePath) && /^[A-Z]/u.test(nameNode.text) ? "component" : "function";
          addSymbol(symbols, nameNode.text, kind, node, containerName, node.text.split(/\r?\n/u)[0]?.trim());
        }
      } else if (node.type === "method_definition") {
        const nameNode = node.childForFieldName?.("name");
        if (nameNode) {
          addSymbol(symbols, nameNode.text, "method", node, containerName, node.text.split(/\r?\n/u)[0]?.trim());
        }
      } else if (
        (node.type === "lexical_declaration" || node.type === "variable_declaration") &&
        /\.(tsx|jsx)$/iu.test(filePath)
      ) {
        const text = node.text.split(/\r?\n/u)[0]?.trim() ?? "";
        const match = /(?:const|let|var)\s+([A-Z][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?\(/u.exec(text);
        if (match) {
          addSymbol(symbols, match[1], "component", node, containerName, text);
        }
      } else if (node.type === "call_expression") {
        const calleeName = extractCallTargetName(node);
        if (calleeName) {
          addReference(
            references,
            calleeName,
            "call",
            node,
            `tree-sitter:${node.type}`,
            containerName,
            extractCallQualifier(node)
          );
        }
      } else if (node.type === "new_expression") {
        const typeName = extractConstructedTypeName(node);
        if (typeName) {
          addReference(references, typeName, "new", node, `tree-sitter:${node.type}`, containerName);
        }
      } else if (node.type === "jsx_opening_element" || node.type === "jsx_self_closing_element") {
        const tagName = extractJsxTagName(node);
        if (tagName && /^[A-Z]/u.test(tagName)) {
          addReference(references, tagName, "component", node, `tree-sitter:${node.type}`, containerName);
        }
      } else if (node.type === "type_identifier") {
        if (/^[A-Z]/u.test(node.text)) {
          addReference(references, node.text, "type", node, `tree-sitter:${node.type}`, containerName);
        }
      }

      if (/ReactDOM\.createRoot|createRoot\(|createApp\(|new\s+Vue\(/u.test(node.text)) {
        entryHints.push({
          kind: "framework-bootstrap",
          line: node.startPosition.row + 1,
          evidence: `Tree-sitter detected ${language} framework bootstrap.`
        });
      }
    } else if (language === "C" || language === "C++") {
      if (node.type === "preproc_include") {
        const match = /#include\s*([<"])([^>"]+)[>"]/u.exec(node.text);
        if (match) {
          imports.push(
            createImportReference(
              match[2],
              node.startPosition.row + 1,
              "include",
              match[1] === '"',
              `tree-sitter:${node.type}`
            )
          );
        }
      } else if (node.type === "class_specifier") {
        const nameNode = node.childForFieldName?.("name");
        if (nameNode) {
          addSymbol(symbols, nameNode.text, "class", node);
        }
      } else if (node.type === "function_definition") {
        const declarator = node.childForFieldName?.("declarator");
        const rawName = declarator?.text.split("(")[0]?.trim() ?? "";
        const functionName = rawName.includes("::") ? rawName.split("::").pop() ?? rawName : rawName;
        if (functionName.length > 0) {
          const kind = rawName.includes("::") ? "method" : "function";
          const owner = rawName.includes("::") ? rawName.split("::")[0] : containerName;
          addSymbol(symbols, functionName, kind, node, owner, node.text.split(/\r?\n/u)[0]?.trim());
          if (functionName === "main") {
            entryHints.push({
              kind: "cpp-main",
              line: node.startPosition.row + 1,
              symbolName: functionName,
              evidence: "Tree-sitter detected C/C++ main function candidate."
            });
          }
        }
      } else if (node.type === "call_expression") {
        const calleeName = extractCallTargetName(node);
        if (calleeName) {
          addReference(
            references,
            calleeName,
            "call",
            node,
            `tree-sitter:${node.type}`,
            containerName,
            extractCallQualifier(node)
          );
        }
      } else if (node.type === "new_expression") {
        const typeName = extractConstructedTypeName(node);
        if (typeName) {
          addReference(references, typeName, "new", node, `tree-sitter:${node.type}`, containerName);
        }
      }
    }

    const nextContainer =
      node.type === "class_definition" || node.type === "class_declaration" || node.type === "class_specifier"
        ? node.childForFieldName?.("name")?.text ?? containerName
        : containerName;

    for (const child of node.namedChildren) {
      visit(child, nextContainer);
    }
  };

  visit(rootNode);

  return {
    filePath: normalizePath(filePath),
    language,
    parser: `tree-sitter-${language.toLowerCase().replace(/\+/gu, "p")}`,
    symbols: symbols
      .slice()
      .sort((left, right) =>
        left.startLine === right.startLine
          ? `${left.kind}:${left.name}`.localeCompare(`${right.kind}:${right.name}`)
          : left.startLine - right.startLine
      ),
    references: references
      .slice()
      .sort((left, right) =>
        left.line === right.line
          ? `${left.kind}:${left.name}:${left.containerName ?? ""}`.localeCompare(
              `${right.kind}:${right.name}:${right.containerName ?? ""}`
            )
          : left.line - right.line
      ),
    importBindings: importBindings
      .slice()
      .sort((left, right) =>
        left.line === right.line
          ? `${left.sourceSpecifier}:${left.localName}`.localeCompare(`${right.sourceSpecifier}:${right.localName}`)
          : left.line - right.line
      ),
    imports: imports
      .slice()
      .sort((left, right) => (left.line === right.line ? left.specifier.localeCompare(right.specifier) : left.line - right.line)),
    entryHints: entryHints
      .slice()
      .sort((left, right) => (left.line === right.line ? left.kind.localeCompare(right.kind) : left.line - right.line)),
    diagnostics: []
  };
}

async function createTreeSitterParser(language: string): Promise<StructureParser | null> {
  const loader = TREE_SITTER_LOADERS.find((item) => item.language === language);
  if (!loader) {
    return null;
  }

  if (parserCache.has(language)) {
    return parserCache.get(language) ?? null;
  }

  try {
    const parserModule = await importNativeTreeSitterModule<TreeSitterModule>("tree-sitter");
    const languageModule = await importNativeTreeSitterModule<Record<string, unknown>>(loader.parserPackage);
    const ParserClass = parserModule.default;
    if (!ParserClass) {
      parserCache.set(language, null);
      return null;
    }

    const treeSitterParser: StructureParser = {
      language,
      parse: (input) => {
        try {
          const grammar = loader.grammarSelector
            ? loader.grammarSelector(languageModule, input.filePath)
            : (languageModule.default ?? languageModule);
          if (!grammar) {
            throw new Error(`No Tree-sitter grammar resolved for ${language}.`);
          }

          const parser = new ParserClass();
          parser.setLanguage(grammar);
          const tree = parser.parse(input.content);
          return parseWithTreeSitter(language, input.filePath, tree.rootNode);
        } catch (error) {
          return {
            filePath: normalizePath(input.filePath),
            language: input.language,
            parser: `tree-sitter-${language.toLowerCase()}`,
            symbols: [],
            references: [],
            importBindings: [],
            imports: [],
            entryHints: [],
            diagnostics: collectDiagnostics(input.filePath, error)
          };
        }
      }
    };

    parserCache.set(language, treeSitterParser);
    return treeSitterParser;
  } catch {
    parserCache.set(language, null);
    return null;
  }
}

export async function getTreeSitterParser(language: string): Promise<StructureParser | null> {
  return createTreeSitterParser(language);
}
