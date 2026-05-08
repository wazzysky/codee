import type { FileAnalysis, StructureParseInput, StructureParser } from "./types.js";
import { regexStructureParsers } from "./structureParsers/regexParsers.js";
import { getTreeSitterParser } from "./structureParsers/treeSitterParsers.js";

export interface StructureParserRegistryOptions {
  treeSitterResolver?: (language: string) => Promise<StructureParser | null>;
  fallbackParsers?: StructureParser[];
}

export class StructureParserRegistry {
  private readonly treeSitterResolver: (language: string) => Promise<StructureParser | null>;
  private readonly fallbackParsers: StructureParser[];

  public constructor(options: StructureParserRegistryOptions = {}) {
    this.treeSitterResolver = options.treeSitterResolver ?? getTreeSitterParser;
    this.fallbackParsers = options.fallbackParsers ?? regexStructureParsers;
  }

  private getFallbackParser(language: string): StructureParser | undefined {
    return this.fallbackParsers.find((parser) => parser.language === language);
  }

  public async getParser(language: string): Promise<StructureParser | undefined> {
    const treeSitterParser = await this.treeSitterResolver(language);
    if (treeSitterParser) {
      return treeSitterParser;
    }

    return this.getFallbackParser(language);
  }

  private shouldFallbackFromResult(analysis: FileAnalysis): boolean {
    return (
      analysis.parser.startsWith("tree-sitter") &&
      analysis.diagnostics.length > 0 &&
      analysis.symbols.length === 0 &&
      analysis.imports.length === 0 &&
      analysis.entryHints.length === 0
    );
  }

  public async parse(input: StructureParseInput): Promise<FileAnalysis> {
    const preferredParser = await this.getParser(input.language);
    const fallbackParser = this.getFallbackParser(input.language);

    if (!preferredParser) {
      return {
        filePath: input.filePath,
        language: input.language,
        parser: "unsupported",
        symbols: [],
        references: [],
        importBindings: [],
        localTypeHints: [],
        imports: [],
        entryHints: [],
        diagnostics: []
      };
    }

    const runFallback = async (diagnostics: FileAnalysis["diagnostics"]): Promise<FileAnalysis> => {
      if (!fallbackParser || fallbackParser === preferredParser) {
        return {
          filePath: input.filePath,
          language: input.language,
          parser: "failed",
          symbols: [],
          references: [],
          importBindings: [],
          localTypeHints: [],
          imports: [],
          entryHints: [],
          diagnostics
        };
      }

      const fallbackAnalysis = await fallbackParser.parse(input);
      return {
        ...fallbackAnalysis,
        diagnostics: [...diagnostics, ...fallbackAnalysis.diagnostics]
      };
    };

    try {
      const analysis = await preferredParser.parse(input);
      if (this.shouldFallbackFromResult(analysis)) {
        return runFallback(analysis.diagnostics);
      }

      return analysis;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return runFallback([
        {
          level: "warning",
          message: `Preferred parser failed: ${message}`,
          path: input.filePath
        }
      ]);
    }
  }
}

export function createStructureParserRegistry(
  options?: StructureParserRegistryOptions
): StructureParserRegistry {
  return new StructureParserRegistry(options);
}
