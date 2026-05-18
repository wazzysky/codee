import type { SymbolDefinition } from "./types.js";

export function buildSymbolId(filePath: string, symbol: Pick<SymbolDefinition, "name" | "kind" | "startLine" | "containerName">): string {
  return [
    filePath,
    symbol.name,
    symbol.kind,
    symbol.startLine,
    symbol.containerName ?? ""
  ].join(":");
}
