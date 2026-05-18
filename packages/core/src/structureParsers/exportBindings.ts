import type { ExportBinding, SymbolDefinition } from "../types.js";

export interface ScriptAssignedSymbolCandidate {
  name: string;
  kind: SymbolDefinition["kind"];
  signature?: string;
}

export interface ScriptAssignedSymbolArtifact extends ScriptAssignedSymbolCandidate {
  line: number;
}

export interface ScriptExportArtifacts {
  bindings: ExportBinding[];
  assignedSymbols: ScriptAssignedSymbolArtifact[];
}

function countLineAtIndex(text: string, index: number): number {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (text[cursor] === "\n") {
      line += 1;
    }
  }

  return line;
}

function splitTopLevel(text: string, delimiter: string): string[] {
  const parts: string[] = [];
  let current = "";
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;
  let quote: "'" | '"' | "`" | undefined;
  let escaped = false;

  for (const character of text) {
    current += character;

    if (escaped) {
      escaped = false;
      continue;
    }

    if (quote) {
      if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }

    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }

    if (character === "{") {
      braceDepth += 1;
      continue;
    }
    if (character === "}") {
      braceDepth -= 1;
      continue;
    }
    if (character === "[") {
      bracketDepth += 1;
      continue;
    }
    if (character === "]") {
      bracketDepth -= 1;
      continue;
    }
    if (character === "(") {
      parenDepth += 1;
      continue;
    }
    if (character === ")") {
      parenDepth -= 1;
      continue;
    }

    if (
      character === delimiter &&
      braceDepth === 0 &&
      bracketDepth === 0 &&
      parenDepth === 0
    ) {
      parts.push(current.slice(0, -1));
      current = "";
    }
  }

  if (current.trim().length > 0) {
    parts.push(current);
  }

  return parts;
}

function stripTrailingSemicolon(text: string): string {
  return text.trim().replace(/;\s*$/u, "").trim();
}

function parseObjectLiteralKey(rawKey: string): string | undefined {
  const trimmed = rawKey.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const identifierMatch = /^([A-Za-z_$][\w$]*)$/u.exec(trimmed);
  if (identifierMatch) {
    return identifierMatch[1];
  }

  const quotedMatch = /^["']([^"']+)["']$/u.exec(trimmed);
  if (quotedMatch) {
    return quotedMatch[1];
  }

  const computedQuotedMatch = /^\[\s*["']([^"']+)["']\s*\]$/u.exec(trimmed);
  if (computedQuotedMatch) {
    return computedQuotedMatch[1];
  }

  return undefined;
}

function splitObjectMember(memberText: string): { key: string; value?: string } | undefined {
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;
  let quote: "'" | '"' | "`" | undefined;
  let escaped = false;

  for (let index = 0; index < memberText.length; index += 1) {
    const character = memberText[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (quote) {
      if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }

    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }

    if (character === "{") {
      braceDepth += 1;
      continue;
    }
    if (character === "}") {
      braceDepth -= 1;
      continue;
    }
    if (character === "[") {
      bracketDepth += 1;
      continue;
    }
    if (character === "]") {
      bracketDepth -= 1;
      continue;
    }
    if (character === "(") {
      parenDepth += 1;
      continue;
    }
    if (character === ")") {
      parenDepth -= 1;
      continue;
    }

    if (character === ":" && braceDepth === 0 && bracketDepth === 0 && parenDepth === 0) {
      return {
        key: memberText.slice(0, index).trim(),
        value: memberText.slice(index + 1).trim()
      };
    }
  }

  const shorthand = memberText.trim();
  return shorthand.length > 0 ? { key: shorthand } : undefined;
}

function parseCommonJsObjectExportMembersDeep(
  membersText: string,
  line: number,
  prefix = ""
): ScriptExportArtifacts {
  const bindings: ExportBinding[] = [];
  const assignedSymbols: ScriptAssignedSymbolArtifact[] = [];

  for (const rawMember of splitTopLevel(membersText, ",")) {
    const member = splitObjectMember(rawMember);
    if (!member) {
      continue;
    }

    const key = parseObjectLiteralKey(member.key);
    if (!key) {
      continue;
    }

    const exportedName = prefix.length > 0 ? `${prefix}.${key}` : key;
    if (!member.value) {
      bindings.push({
        exportedName,
        localName: key,
        kind: exportedName === "default" ? "default" : "named",
        line
      });
      continue;
    }

    const value = stripTrailingSemicolon(member.value);
    if (value.startsWith("{") && value.endsWith("}")) {
      const nested = parseCommonJsObjectExportMembersDeep(value.slice(1, -1), line, exportedName);
      bindings.push(...nested.bindings);
      assignedSymbols.push(...nested.assignedSymbols);
      continue;
    }

    const symbol = parseAssignedSymbolName(key, value);
    if (symbol) {
      bindings.push({
        exportedName,
        localName: symbol.name,
        kind: exportedName === "default" ? "default" : "named",
        line
      });
      assignedSymbols.push({
        ...symbol,
        line
      });
      continue;
    }

    const identifierMatch = /^([A-Za-z_$][\w$]*)$/u.exec(value);
    if (identifierMatch) {
      bindings.push({
        exportedName,
        localName: identifierMatch[1],
        kind: exportedName === "default" ? "default" : "named",
        line
      });
    }
  }

  return { bindings, assignedSymbols };
}

function parseCommonJsExportPath(rawPath: string): string[] | undefined {
  const trimmed = rawPath.trim();
  let remainder = "";

  if (trimmed === "exports" || trimmed.startsWith("exports.")) {
    remainder = trimmed.slice("exports".length);
  } else if (trimmed === "module.exports" || trimmed.startsWith("module.exports.")) {
    remainder = trimmed.slice("module.exports".length);
  } else if (trimmed.startsWith("exports[")) {
    remainder = trimmed.slice("exports".length);
  } else if (trimmed.startsWith("module.exports[")) {
    remainder = trimmed.slice("module.exports".length);
  } else {
    return undefined;
  }

  const segments: string[] = [];
  let cursor = remainder.trim();
  while (cursor.length > 0) {
    const dotMatch = /^\.\s*([A-Za-z_$][\w$]*)/u.exec(cursor);
    if (dotMatch) {
      segments.push(dotMatch[1]);
      cursor = cursor.slice(dotMatch[0].length).trimStart();
      continue;
    }

    const bracketMatch = /^\[\s*["']([^"']+)["']\s*\]/u.exec(cursor);
    if (bracketMatch) {
      segments.push(bracketMatch[1]);
      cursor = cursor.slice(bracketMatch[0].length).trimStart();
      continue;
    }

    return undefined;
  }

  return segments;
}

function extractBalancedBraces(text: string, braceStart: number): { text: string; end: number } | undefined {
  let depth = 0;
  let quote: "'" | '"' | "`" | undefined;
  let escaped = false;

  for (let index = braceStart; index < text.length; index += 1) {
    const character = text[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (quote) {
      if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }

    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }

    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return {
          text: text.slice(braceStart, index + 1),
          end: index + 1
        };
      }
    }
  }

  return undefined;
}

function normalizeExportMember(member: string): string {
  return member.replace(/^\s*type\s+/u, "").trim();
}

function parseNamedExportMembers(
  membersText: string,
  line: number,
  sourceSpecifier?: string
): ExportBinding[] {
  const bindings: ExportBinding[] = [];

  for (const member of membersText.split(",")) {
    const trimmedMember = normalizeExportMember(member);
    if (trimmedMember.length === 0) {
      continue;
    }

    const aliasMatch = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/u.exec(trimmedMember);
    if (!aliasMatch) {
      continue;
    }

    bindings.push({
      exportedName: aliasMatch[2] ?? aliasMatch[1],
      localName: aliasMatch[1],
      sourceSpecifier,
      kind: sourceSpecifier ? "named" : "named",
      line
    });
  }

  return bindings;
}

function parseCommonJsObjectExportMembers(membersText: string, line: number): ExportBinding[] {
  return parseCommonJsObjectExportMembersDeep(membersText, line).bindings;
}

function parseAssignedSymbolName(
  exportedName: string,
  valueExpression: string
): ScriptAssignedSymbolCandidate | undefined {
  const functionMatch = /^(?:async\s+)?function(?:\s+([A-Za-z_$][\w$]*))?\s*\(/u.exec(valueExpression);
  if (functionMatch) {
    return {
      name: functionMatch[1] ?? exportedName,
      kind: "function",
      signature: valueExpression
    };
  }

  const classMatch = /^class(?:\s+([A-Za-z_$][\w$]*))?\b/u.exec(valueExpression);
  if (classMatch) {
    return {
      name: classMatch[1] ?? exportedName,
      kind: "class",
      signature: valueExpression
    };
  }

  return undefined;
}

export function parseScriptAssignedSymbolFromText(
  text: string
): ScriptAssignedSymbolCandidate | undefined {
  const trimmed = text.trim();

  const propertyAssignmentMatch = /^(exports|module\.exports)(?:[\s\S]*)=\s*(.+?)\s*;?$/u.exec(trimmed);
  if (propertyAssignmentMatch) {
    const pathSegments = parseCommonJsExportPath(trimmed.split("=")[0] ?? "");
    if (pathSegments && pathSegments.length > 0) {
      return parseAssignedSymbolName(pathSegments[pathSegments.length - 1], propertyAssignmentMatch[2].trim());
    }
  }

  const defaultAssignmentMatch =
    /^module\.exports\s*=\s*(.+?)\s*;?$/u.exec(trimmed) ??
    /^exports\.default\s*=\s*(.+?)\s*;?$/u.exec(trimmed) ??
    /^module\.exports\.default\s*=\s*(.+?)\s*;?$/u.exec(trimmed);
  if (defaultAssignmentMatch) {
    return parseAssignedSymbolName("default", defaultAssignmentMatch[1].trim());
  }

  return undefined;
}

export function parseScriptExportBindingsFromText(text: string, line: number): ExportBinding[] {
  const trimmed = text.trim();

  const exportAssignmentMatch = /^export\s*=\s*([A-Za-z_$][\w$]*)\s*;?$/u.exec(trimmed);
  if (exportAssignmentMatch) {
    return [
      {
        exportedName: "default",
        localName: exportAssignmentMatch[1],
        kind: "default",
        line
      }
    ];
  }

  const moduleExportsDefaultMatch =
    /^module\.exports\s*=\s*([A-Za-z_$][\w$]*)\s*;?$/u.exec(trimmed) ??
    /^exports\.default\s*=\s*([A-Za-z_$][\w$]*)\s*;?$/u.exec(trimmed) ??
    /^module\.exports\.default\s*=\s*([A-Za-z_$][\w$]*)\s*;?$/u.exec(trimmed);
  if (moduleExportsDefaultMatch) {
    return [
      {
        exportedName: "default",
        localName: moduleExportsDefaultMatch[1],
        kind: "default",
        line
      }
    ];
  }

  const moduleExportsObjectMatch = /^module\.exports\s*=\s*\{([\s\S]+)\}\s*;?$/u.exec(trimmed);
  if (moduleExportsObjectMatch) {
    return parseCommonJsObjectExportMembers(moduleExportsObjectMatch[1], line);
  }

  const commonJsAssignmentMatch =
    /^(exports(?:[\s\S]*?)|module\.exports(?:[\s\S]*?))\s*=\s*([\s\S]+?)\s*;?$/u.exec(trimmed);
  if (commonJsAssignmentMatch) {
    const pathSegments = parseCommonJsExportPath(commonJsAssignmentMatch[1]);
    if (pathSegments && pathSegments.length > 0) {
      const exportedName = pathSegments.join(".");
      const valueExpression = stripTrailingSemicolon(commonJsAssignmentMatch[2]);

      if (valueExpression.startsWith("{") && valueExpression.endsWith("}")) {
        return parseCommonJsObjectExportMembersDeep(
          valueExpression.slice(1, -1),
          line,
          exportedName
        ).bindings;
      }

      const symbol = parseAssignedSymbolName(pathSegments[pathSegments.length - 1], valueExpression);
      if (symbol) {
        return [
          {
            exportedName,
            localName: symbol.name,
            kind: exportedName === "default" ? "default" : "named",
            line
          }
        ];
      }

      const identifierMatch = /^([A-Za-z_$][\w$]*)$/u.exec(valueExpression);
      if (identifierMatch) {
        return [
          {
            exportedName,
            localName: identifierMatch[1],
            kind: exportedName === "default" ? "default" : "named",
            line
          }
        ];
      }
    }
  }

  if (!trimmed.startsWith("export ")) {
    return [];
  }

  const exportAllMatch = /^export\s+\*\s+from\s+["']([^"']+)["']/u.exec(trimmed);
  if (exportAllMatch) {
    return [
      {
        exportedName: "*",
        sourceSpecifier: exportAllMatch[1],
        kind: "all",
        line
      }
    ];
  }

  const exportNamespaceMatch = /^export\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+["']([^"']+)["']/u.exec(trimmed);
  if (exportNamespaceMatch) {
    return [
      {
        exportedName: exportNamespaceMatch[1],
        localName: "*",
        sourceSpecifier: exportNamespaceMatch[2],
        kind: "namespace",
        line
      }
    ];
  }

  const exportDefaultClassOrFunctionMatch =
    /^export\s+default\s+class\s+([A-Za-z_$][\w$]*)\b/u.exec(trimmed) ??
    /^export\s+default\s+function\s+([A-Za-z_$][\w$]*)\b/u.exec(trimmed);
  if (exportDefaultClassOrFunctionMatch) {
    return [
      {
        exportedName: "default",
        localName: exportDefaultClassOrFunctionMatch[1],
        kind: "default",
        line
      }
    ];
  }

  const exportDefaultIdentifierMatch = /^export\s+default\s+([A-Za-z_$][\w$]*)\s*;?$/u.exec(trimmed);
  if (exportDefaultIdentifierMatch) {
    return [
      {
        exportedName: "default",
        localName: exportDefaultIdentifierMatch[1],
        kind: "default",
        line
      }
    ];
  }

  const exportNamedDeclarationMatch =
    /^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\b/u.exec(trimmed) ??
    /^export\s+class\s+([A-Za-z_$][\w$]*)\b/u.exec(trimmed) ??
    /^export\s+interface\s+([A-Za-z_$][\w$]*)\b/u.exec(trimmed) ??
    /^export\s+type\s+([A-Za-z_$][\w$]*)\b/u.exec(trimmed) ??
    /^export\s+const\s+([A-Za-z_$][\w$]*)\b/u.exec(trimmed) ??
    /^export\s+let\s+([A-Za-z_$][\w$]*)\b/u.exec(trimmed) ??
    /^export\s+var\s+([A-Za-z_$][\w$]*)\b/u.exec(trimmed);
  if (exportNamedDeclarationMatch) {
    return [
      {
        exportedName: exportNamedDeclarationMatch[1],
        localName: exportNamedDeclarationMatch[1],
        kind: "named",
        line
      }
    ];
  }

  const exportNamedFromMatch = /^export\s+(?:type\s+)?\{([^}]+)\}\s*from\s*["']([^"']+)["']/u.exec(trimmed);
  if (exportNamedFromMatch) {
    return parseNamedExportMembers(exportNamedFromMatch[1], line, exportNamedFromMatch[2]);
  }

  const exportNamedMatch = /^export\s+(?:type\s+)?\{([^}]+)\}/u.exec(trimmed);
  if (exportNamedMatch) {
    return parseNamedExportMembers(exportNamedMatch[1], line);
  }

  return [];
}

export function parseScriptExportArtifactsFromContent(content: string): ScriptExportArtifacts {
  const bindings: ExportBinding[] = [];
  const assignedSymbols: ScriptAssignedSymbolArtifact[] = [];
  const assignmentPattern =
    /(module\.exports(?:\s*(?:\.\s*[A-Za-z_$][\w$]*|\[\s*["'][^"']+["']\s*\]))*|exports(?:\s*(?:\.\s*[A-Za-z_$][\w$]*|\[\s*["'][^"']+["']\s*\]))*)\s*=\s*\{/gu;

  for (const match of content.matchAll(assignmentPattern)) {
    const matchedText = match[0];
    const matchIndex = match.index ?? 0;
    const braceOffset = matchedText.lastIndexOf("{");
    if (braceOffset < 0) {
      continue;
    }

    const braceStart = matchIndex + braceOffset;
    const literal = extractBalancedBraces(content, braceStart);
    if (!literal) {
      continue;
    }

    const pathSegments = parseCommonJsExportPath(match[1] ?? "");
    const line = countLineAtIndex(content, matchIndex);
    const prefix = pathSegments && pathSegments.length > 0 ? pathSegments.join(".") : "";
    const parsed = parseCommonJsObjectExportMembersDeep(literal.text.slice(1, -1), line, prefix);
    bindings.push(...parsed.bindings);
    assignedSymbols.push(...parsed.assignedSymbols);
  }

  return { bindings, assignedSymbols };
}
