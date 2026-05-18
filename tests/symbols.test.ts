import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  analyzeFileStructure,
  buildDependencyGraph,
  buildSymbolLinks,
  createStructureParserRegistry,
  extractRepositorySymbols,
  scanRepository,
  type StructureParser
} from "../packages/core/src/index";

describe("analyzeFileStructure", () => {
  it("extracts Python imports, functions, classes, methods, and entry hints", async () => {
    const analysis = await analyzeFileStructure(
      "python_pkg/main.py",
      [
        "import os",
        "from .pkg.module import Foo",
        "from .utils import MotionPlanner, helper",
        "",
        "class Runner:",
        "    def execute(self):",
        "        return helper(MotionPlanner().step(Foo().run()))",
        "",
        "def main():",
        "    return Runner().execute(), os.getcwd()",
        "",
        'if __name__ == "__main__":',
        "    print(main())"
      ].join("\n"),
      "Python"
    );

    expect(analysis.imports.map((item) => item.specifier)).toEqual(["os", ".pkg.module", ".utils"]);
    expect(analysis.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Runner", kind: "class" }),
        expect.objectContaining({ name: "execute", kind: "method", containerName: "Runner" }),
        expect.objectContaining({ name: "main", kind: "function", startLine: 9 })
      ])
    );
    expect(analysis.entryHints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "function-main" }),
        expect.objectContaining({ kind: "python-main-guard" })
      ])
    );
    expect(analysis.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "helper", kind: "call" }),
        expect.objectContaining({ name: "MotionPlanner", kind: "call" }),
        expect.objectContaining({ name: "Foo", kind: "call" })
      ])
    );
    expect(analysis.importBindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ localName: "os", sourceSpecifier: "os", kind: "module" }),
        expect.objectContaining({ localName: "Foo", sourceSpecifier: ".pkg.module", kind: "named" })
      ])
    );
  });

  it("extracts TypeScript imports, classes, functions, components, and bootstrap hints", async () => {
    const analysis = await analyzeFileStructure(
      "ts/app.tsx",
      [
        'import Engine, { ArrowTool, ConsoleEngine, helper } from "./lib";',
        'import ReactDOM from "react-dom/client";',
        'import { Panel } from "./ui";',
        'import { Toolset } from "./tools/barrel";',
        'import * as ToolModule from "./tools/barrel";',
        "",
        "export class Bootstrapper {",
        "  run(): void {",
        "    const engine = new Engine();",
        "    const consoleEngine = new ConsoleEngine();",
        "    console.log(engine.start());",
        "    console.log(consoleEngine.start());",
        "  }",
        "}",
        "",
        "export function App(): JSX.Element {",
        "  const label = Toolset.createLabel(String(ArrowTool(helper(1))));",
        "  return <Panel label={ToolModule.createBadge(label)} />;",
        "}",
        "",
        "export const MainView = (): JSX.Element => <App />;",
        "",
        "export function bootstrap(): void {",
        "  new Bootstrapper().run();",
        '  ReactDOM.createRoot(document.getElementById("root")!).render(<MainView />);',
        "}"
      ].join("\n"),
      "TypeScript"
    );

    expect(analysis.imports.map((item) => item.specifier)).toEqual([
      "./lib",
      "react-dom/client",
      "./ui",
      "./tools/barrel",
      "./tools/barrel"
    ]);
    expect(analysis.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Bootstrapper", kind: "class" }),
        expect.objectContaining({ name: "run", kind: "method", containerName: "Bootstrapper" }),
        expect.objectContaining({ name: "App", kind: "component" }),
        expect.objectContaining({ name: "MainView", kind: "component" }),
        expect.objectContaining({ name: "bootstrap", kind: "function" })
      ])
    );
    expect(analysis.entryHints).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "framework-bootstrap" })])
    );
    expect(analysis.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Bootstrapper", kind: "new" }),
        expect.objectContaining({ name: "Panel", kind: "component" }),
        expect.objectContaining({ name: "createRoot", kind: "call", qualifier: "ReactDOM" })
      ])
    );
    expect(analysis.importBindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ localName: "Engine", sourceSpecifier: "./lib", kind: "default" }),
        expect.objectContaining({ localName: "ArrowTool", sourceSpecifier: "./lib", kind: "named" }),
        expect.objectContaining({ localName: "ConsoleEngine", sourceSpecifier: "./lib", kind: "named" }),
        expect.objectContaining({ localName: "ReactDOM", sourceSpecifier: "react-dom/client", kind: "default" }),
        expect.objectContaining({ localName: "Toolset", sourceSpecifier: "./tools/barrel", kind: "named" }),
        expect.objectContaining({ localName: "ToolModule", sourceSpecifier: "./tools/barrel", kind: "namespace" })
      ])
    );
    expect(analysis.exportBindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ exportedName: "Bootstrapper", localName: "Bootstrapper", kind: "named" }),
        expect.objectContaining({ exportedName: "App", localName: "App", kind: "named" }),
        expect.objectContaining({ exportedName: "MainView", localName: "MainView", kind: "named" }),
        expect.objectContaining({ exportedName: "bootstrap", localName: "bootstrap", kind: "named" })
      ])
    );
    expect(analysis.localTypeHints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "engine", typeName: "Engine" }),
        expect.objectContaining({ name: "consoleEngine", typeName: "ConsoleEngine" })
      ])
    );
    expect(analysis.scopeBindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Engine", kind: "import", sourceSpecifier: "./lib" }),
        expect.objectContaining({ name: "ReactDOM", kind: "import", sourceSpecifier: "react-dom/client" }),
        expect.objectContaining({ name: "this", kind: "implicit-this", typeName: "Bootstrapper" }),
        expect.objectContaining({ name: "engine", kind: "variable", typeName: "Engine" }),
        expect.objectContaining({ name: "consoleEngine", kind: "variable", typeName: "ConsoleEngine" })
      ])
    );
  });

  it("extracts TypeScript re-export bindings", async () => {
    const analysis = await analyzeFileStructure(
      "ts/ui/index.ts",
      'export { Panel } from "./panel";\nexport * as PanelKit from "./panel";\n',
      "TypeScript"
    );

    expect(analysis.exportBindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          exportedName: "Panel",
          localName: "Panel",
          sourceSpecifier: "./panel",
          kind: "named",
          line: 1
        }),
        expect.objectContaining({
          exportedName: "PanelKit",
          localName: "*",
          sourceSpecifier: "./panel",
          kind: "namespace",
          line: 2
        })
      ])
    );
  });

  it("extracts type-only imports/exports, export default aliases, and CommonJS exports", async () => {
    const tsAnalysis = await analyzeFileStructure(
      "ts/interop.ts",
      [
        'import CommonRunner = require("./legacy-cjs");',
        'import type { LegacyOptions } from "./legacy";',
        'import { LegacyRunner, createLegacy } from "./legacy-bridge";',
        "",
        "export function useLegacy(options: LegacyOptions): string {",
        "  const commonRunner = new CommonRunner();",
        "  const legacyRunner = createLegacy();",
        "  return commonRunner.start() + legacyRunner.start() + LegacyRunner.name + options.label;",
        "}"
      ].join("\n"),
      "TypeScript"
    );

    expect(tsAnalysis.importBindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ localName: "CommonRunner", sourceSpecifier: "./legacy-cjs", kind: "default" }),
        expect.objectContaining({ localName: "LegacyOptions", sourceSpecifier: "./legacy", kind: "named" }),
        expect.objectContaining({ localName: "LegacyRunner", sourceSpecifier: "./legacy-bridge", kind: "named" })
      ])
    );
    expect(tsAnalysis.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "CommonRunner", kind: "new" }),
        expect.objectContaining({ name: "LegacyOptions", kind: "type" }),
        expect.objectContaining({ name: "createLegacy", kind: "call" })
      ])
    );

    const exportAnalysis = await analyzeFileStructure(
      "ts/legacy-bridge.ts",
      [
        'export { default as LegacyRunner } from "./legacy";',
        'export type { LegacyOptions } from "./legacy";',
        'export * from "./legacy";'
      ].join("\n"),
      "TypeScript"
    );

    expect(exportAnalysis.exportBindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          exportedName: "LegacyRunner",
          localName: "default",
          sourceSpecifier: "./legacy",
          kind: "named"
        }),
        expect.objectContaining({
          exportedName: "LegacyOptions",
          localName: "LegacyOptions",
          sourceSpecifier: "./legacy",
          kind: "named"
        }),
        expect.objectContaining({
          exportedName: "*",
          sourceSpecifier: "./legacy",
          kind: "all"
        })
      ])
    );

    const defaultAliasAnalysis = await analyzeFileStructure(
      "ts/default-alias.ts",
      ["const createAlias = () => 'ok';", "export { createAlias as default };"].join("\n"),
      "TypeScript"
    );

    expect(defaultAliasAnalysis.exportBindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          exportedName: "default",
          localName: "createAlias",
          kind: "named"
        })
      ])
    );

    const cjsAnalysis = await analyzeFileStructure(
      "ts/legacy-cjs.js",
      [
        "class CommonRunner {",
        "  start() { return 'ok'; }",
        "}",
        "",
        "function createCommonRunner() {",
        "  return new CommonRunner();",
        "}",
        "",
        "module.exports = CommonRunner;",
        "exports.createCommonRunner = createCommonRunner;"
      ].join("\n"),
      "JavaScript"
    );

    expect(cjsAnalysis.exportBindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ exportedName: "default", localName: "CommonRunner", kind: "default" }),
        expect.objectContaining({ exportedName: "createCommonRunner", localName: "createCommonRunner", kind: "named" })
      ])
    );

    const cjsObjectAnalysis = await analyzeFileStructure(
      "ts/object-cjs.js",
      [
        "class ObjectRunner {",
        "  start() { return 'ok'; }",
        "}",
        "",
        "function createObjectRunner() {",
        "  return new ObjectRunner();",
        "}",
        "",
        "module.exports = {",
        "  default: ObjectRunner,",
        "  createObjectRunner,",
        "  namedFactory: createObjectRunner,",
        '  ["computedFactory"]: createObjectRunner,',
        "  nested: {",
        "    createNestedRunner: createObjectRunner,",
        '    ["computedNestedRunner"]: createObjectRunner',
        "  }",
        "};",
        "exports.inlineFactory = function inlineFactory() {",
        "  return new ObjectRunner();",
        "};",
        'exports["stringFactory"] = function stringFactory() {',
        "  return new ObjectRunner();",
        "};",
        "module.exports.InlineRunner = class InlineRunner {};",
        'module.exports["ComputedRunner"] = class ComputedRunner {};',
        "module.exports.nestedExtra = { extraFactory: createObjectRunner };"
      ].join("\n"),
      "JavaScript"
    );

    expect(cjsObjectAnalysis.exportBindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ exportedName: "default", localName: "ObjectRunner", kind: "default" }),
        expect.objectContaining({
          exportedName: "createObjectRunner",
          localName: "createObjectRunner",
          kind: "named"
        }),
        expect.objectContaining({ exportedName: "namedFactory", localName: "createObjectRunner", kind: "named" }),
        expect.objectContaining({ exportedName: "computedFactory", localName: "createObjectRunner", kind: "named" }),
        expect.objectContaining({
          exportedName: "nested.createNestedRunner",
          localName: "createObjectRunner",
          kind: "named"
        }),
        expect.objectContaining({
          exportedName: "nested.computedNestedRunner",
          localName: "createObjectRunner",
          kind: "named"
        }),
        expect.objectContaining({ exportedName: "inlineFactory", localName: "inlineFactory", kind: "named" }),
        expect.objectContaining({ exportedName: "stringFactory", localName: "stringFactory", kind: "named" }),
        expect.objectContaining({ exportedName: "InlineRunner", localName: "InlineRunner", kind: "named" }),
        expect.objectContaining({ exportedName: "ComputedRunner", localName: "ComputedRunner", kind: "named" }),
        expect.objectContaining({
          exportedName: "nestedExtra.extraFactory",
          localName: "createObjectRunner",
          kind: "named"
        })
      ])
    );
    expect(cjsObjectAnalysis.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "inlineFactory", kind: "function" }),
        expect.objectContaining({ name: "stringFactory", kind: "function" }),
        expect.objectContaining({ name: "InlineRunner", kind: "class" }),
        expect.objectContaining({ name: "ComputedRunner", kind: "class" })
      ])
    );
  });

  it("extracts C++ includes, classes, methods, functions, and main", async () => {
    const analysis = await analyzeFileStructure(
      "cpp/main.cpp",
      [
        "#include <vector>",
        '#include "local.hpp"',
        '#include "utils/math.h"',
        "",
        "void Greeter::greet() {}",
        "",
        "int main() {",
        "  std::vector<int> values = {compute_value(1)};",
        "  return values.front();",
        "}"
      ].join("\n"),
      "C++"
    );

    expect(analysis.imports.map((item) => item.specifier)).toEqual(["vector", "local.hpp", "utils/math.h"]);
    expect(analysis.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "greet", kind: "method", containerName: "Greeter" }),
        expect.objectContaining({ name: "main", kind: "function" })
      ])
    );
    expect(analysis.entryHints).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "cpp-main" })])
    );
    expect(analysis.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "compute_value", kind: "call" })
      ])
    );
  });
});

describe("StructureParserRegistry", () => {
  it("uses native tree-sitter parsers when they are available", async () => {
    const analysis = await analyzeFileStructure(
      "python_pkg/main.py",
      "def main():\n    return 1\n",
      "Python"
    );

    expect(analysis.parser).toBe("tree-sitter-python");
    expect(analysis.symbols).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "main", kind: "function" })])
    );
  });

  it("selects the fallback parser when no tree-sitter parser is available", async () => {
    const registry = createStructureParserRegistry({
      treeSitterResolver: async () => null
    });

    const parser = await registry.getParser("Python");
    expect(parser?.language).toBe("Python");

    const analysis = await registry.parse({
      filePath: "python_pkg/main.py",
      content: "def main():\n    return 1\n",
      language: "Python"
    });

    expect(analysis.parser).toBe("regex-python");
  });

  it("falls back when the preferred tree-sitter parser throws", async () => {
    const failingParser: StructureParser = {
      language: "TypeScript",
      parse: () => {
        throw new Error("synthetic tree-sitter failure");
      }
    };
    const registry = createStructureParserRegistry({
      treeSitterResolver: async (language) => (language === "TypeScript" ? failingParser : null)
    });

    const analysis = await analyzeFileStructure(
      "ts/app.tsx",
      'import value from "./lib";\nexport function App(): JSX.Element { return <div />; }\n',
      "TypeScript",
      registry
    );

    expect(analysis.parser).toBe("regex-typescript");
    expect(analysis.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warning",
          message: expect.stringContaining("Preferred parser failed")
        })
      ])
    );
  });
});

describe("extractRepositorySymbols", () => {
  it("records parser diagnostics without aborting the repository", async () => {
    const scanResult = await scanRepository(path.resolve("tests/fixtures/structure-demo"));
    const injectedParser: StructureParser = {
      language: "TypeScript",
      parse: (input) => {
        if (input.filePath === "broken/bad.ts") {
          throw new Error("synthetic parser failure");
        }

        return {
          filePath: input.filePath,
          language: input.language,
          parser: "synthetic-typescript",
          symbols: [],
          references: [],
          importBindings: [],
          exportBindings: [],
          scopeBindings: [],
          localTypeHints: [],
          imports: [],
          entryHints: [],
          diagnostics: []
        };
      }
    };
    const registry = createStructureParserRegistry({
      treeSitterResolver: async (language) => (language === "TypeScript" ? injectedParser : null)
    });
    const result = await extractRepositorySymbols(scanResult, registry);

    expect(result.files.some((analysis) => analysis.filePath === "broken/bad.ts")).toBe(true);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warning",
          path: "broken/bad.ts",
          message: expect.stringContaining("Preferred parser failed")
        })
      ])
    );
  });

  it("builds explicit symbol links for external and internal targets", async () => {
    const scanResult = await scanRepository(path.resolve("tests/fixtures/structure-demo"));
    const symbolResult = await extractRepositorySymbols(scanResult);
    const dependencyGraph = buildDependencyGraph(scanResult.root, symbolResult.files);
    const linkGraph = buildSymbolLinks(scanResult.root, symbolResult.files, dependencyGraph, symbolResult.namespaces);

    expect(symbolResult.namespaces.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: "ts/object-cjs.js",
          path: "nested",
          kind: "namespace"
        }),
        expect.objectContaining({
          filePath: "ts/object-cjs.js",
          path: "nested.createNestedRunner",
          kind: "export",
          localName: "createObjectRunner"
        }),
        expect.objectContaining({
          filePath: "ts/object-cjs.js",
          path: "nestedExtra",
          kind: "namespace"
        }),
        expect.objectContaining({
          filePath: "ts/object-cjs.js",
          path: "nestedExtra.extraFactory",
          kind: "export",
          localName: "createObjectRunner"
        })
      ])
    );

    expect(symbolResult.namespaces.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: "ts/object-cjs.js",
          fromPath: "nested",
          toPath: "nested.createNestedRunner",
          kind: "contains"
        }),
        expect.objectContaining({
          filePath: "ts/object-cjs.js",
          fromPath: "nested.createNestedRunner",
          toPath: "createObjectRunner",
          kind: "resolves-to",
          targetSymbolName: "createObjectRunner"
        })
      ])
    );

    expect(symbolResult.coreSymbols.rankings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: "ts/object-cjs.js",
          symbolName: "createObjectRunner",
          namespaceExportCount: expect.any(Number),
          score: expect.any(Number)
        }),
        expect.objectContaining({
          filePath: "ts/tools/index.ts",
          symbolName: "createLabel",
          incomingCallCount: expect.any(Number),
          score: expect.any(Number)
        })
      ])
    );

    expect(linkGraph.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceFilePath: "ts/app.tsx",
          sourceReferenceName: "createRoot",
          sourceQualifier: "ReactDOM",
          targetSpecifier: "react-dom/client",
          resolution: "external"
        }),
        expect.objectContaining({
          sourceFilePath: "ts/app.tsx",
          sourceReferenceName: "start",
          sourceQualifier: "consoleEngine",
          targetFilePath: "ts/lib/index.ts",
          targetSymbolName: "start",
          resolution: "internal"
        }),
        expect.objectContaining({
          sourceFilePath: "ts/app.tsx",
          sourceReferenceName: "Panel",
          targetFilePath: "ts/ui/panel.tsx",
          targetSymbolName: "Panel",
          resolution: "internal"
        }),
        expect.objectContaining({
          sourceFilePath: "ts/app.tsx",
          sourceReferenceName: "createLabel",
          sourceQualifier: "Toolset",
          targetFilePath: "ts/tools/index.ts",
          targetSymbolName: "createLabel",
          resolution: "internal"
        }),
        expect.objectContaining({
          sourceFilePath: "ts/app.tsx",
          sourceReferenceName: "createBadge",
          sourceQualifier: "ToolModule",
          targetFilePath: "ts/tools/index.ts",
          targetSymbolName: "createBadge",
          resolution: "internal"
        }),
        expect.objectContaining({
          sourceFilePath: "cpp/main.cpp",
          sourceReferenceName: "compute_value",
          targetFilePath: "cpp/utils/math.cpp",
          targetSymbolName: "compute_value",
          resolution: "internal"
        }),
        expect.objectContaining({
          sourceFilePath: "python_pkg/main.py",
          sourceReferenceName: "step",
          sourceQualifier: "planner",
          targetFilePath: "python_pkg/utils.py",
          targetSymbolName: "step",
          resolution: "internal"
        }),
        expect.objectContaining({
          sourceFilePath: "ts/interop.ts",
          sourceReferenceName: "createLegacy",
          targetFilePath: "ts/legacy.ts",
          targetSymbolName: "createLegacy",
          resolution: "internal"
        }),
        expect.objectContaining({
          sourceFilePath: "ts/interop.ts",
          sourceReferenceName: "CommonRunner",
          targetFilePath: "ts/legacy-cjs.js",
          targetSymbolName: "CommonRunner",
          resolution: "internal"
        }),
        expect.objectContaining({
          sourceFilePath: "ts/object-interop.ts",
          sourceReferenceName: "createAlias",
          targetFilePath: "ts/default-alias.ts",
          targetSymbolName: "createAlias",
          resolution: "internal"
        }),
        expect.objectContaining({
          sourceFilePath: "ts/object-interop.ts",
          sourceReferenceName: "namedFactory",
          targetFilePath: "ts/object-cjs.js",
          targetSymbolName: "createObjectRunner",
          resolution: "internal"
        }),
        expect.objectContaining({
          sourceFilePath: "ts/object-interop.ts",
          sourceReferenceName: "inlineFactory",
          targetFilePath: "ts/object-cjs.js",
          targetSymbolName: "inlineFactory",
          resolution: "internal"
        }),
        expect.objectContaining({
          sourceFilePath: "ts/object-interop.ts",
          sourceReferenceName: "InlineRunner",
          targetFilePath: "ts/object-cjs.js",
          targetSymbolName: "InlineRunner",
          resolution: "internal"
        }),
        expect.objectContaining({
          sourceFilePath: "ts/object-interop.ts",
          sourceReferenceName: "createNestedRunner",
          sourceQualifier: "ObjectModule.nested",
          targetFilePath: "ts/object-cjs.js",
          targetSymbolName: "createObjectRunner",
          resolution: "internal"
        }),
        expect.objectContaining({
          sourceFilePath: "ts/object-interop.ts",
          sourceReferenceName: "extraFactory",
          sourceQualifier: "ObjectModule.nestedExtra",
          targetFilePath: "ts/object-cjs.js",
          targetSymbolName: "createObjectRunner",
          resolution: "internal"
        })
      ])
    );

    expect(symbolResult.calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          callerFilePath: "ts/app.tsx",
          callerSymbolName: "App",
          calleeFilePath: "ts/tools/index.ts",
          calleeSymbolName: "createLabel",
          resolution: "internal"
        }),
        expect.objectContaining({
          callerFilePath: "ts/app.tsx",
          callerSymbolName: "App",
          calleeFilePath: "ts/tools/index.ts",
          calleeSymbolName: "createBadge",
          resolution: "internal"
        })
      ])
    );

    expect(symbolResult.referenceEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceFilePath: "ts/app.tsx",
          sourceSymbolName: "App",
          sourceReferenceName: "createLabel",
          sourceQualifier: "Toolset",
          targetFilePath: "ts/tools/index.ts",
          targetSymbolName: "createLabel",
          resolution: "internal"
        }),
        expect.objectContaining({
          sourceFilePath: "ts/app.tsx",
          sourceSymbolName: "App",
          sourceReferenceName: "createBadge",
          sourceQualifier: "ToolModule",
          targetFilePath: "ts/tools/index.ts",
          targetSymbolName: "createBadge",
          resolution: "internal"
        }),
        expect.objectContaining({
          sourceFilePath: "ts/interop.ts",
          sourceSymbolName: "useLegacy",
          sourceReferenceName: "LegacyOptions",
          targetFilePath: "ts/legacy.ts",
          targetSymbolName: "LegacyOptions",
          targetSymbolKind: "type",
          resolution: "internal"
        }),
        expect.objectContaining({
          sourceFilePath: "ts/object-interop.ts",
          sourceSymbolName: "useObjectInterop",
          sourceReferenceName: "namedFactory",
          targetFilePath: "ts/object-cjs.js",
          targetSymbolName: "createObjectRunner",
          resolution: "internal"
        }),
        expect.objectContaining({
          sourceFilePath: "ts/object-interop.ts",
          sourceSymbolName: "useObjectInterop",
          sourceReferenceName: "inlineFactory",
          targetFilePath: "ts/object-cjs.js",
          targetSymbolName: "inlineFactory",
          resolution: "internal"
        }),
        expect.objectContaining({
          sourceFilePath: "ts/object-interop.ts",
          sourceSymbolName: "useObjectInterop",
          sourceReferenceName: "createNestedRunner",
          sourceQualifier: "ObjectModule.nested",
          targetFilePath: "ts/object-cjs.js",
          targetSymbolName: "createObjectRunner",
          resolution: "internal"
        })
      ])
    );
  });

  it("resolves this/self bindings before falling back to global guesses", async () => {
    const tsAnalysis = await analyzeFileStructure(
      "ts/bindings.ts",
      [
        "class Runner {",
        "  helper(): number { return 1; }",
        "  execute(): number {",
        "    return this.helper();",
        "  }",
        "}"
      ].join("\n"),
      "TypeScript"
    );
    const pyAnalysis = await analyzeFileStructure(
      "python_pkg/bindings.py",
      [
        "class Runner:",
        "    def helper(self):",
        "        return 1",
        "",
        "    def execute(self):",
        "        return self.helper()"
      ].join("\n"),
      "Python"
    );

    const tsGraph = buildDependencyGraph("/tmp/repo", [tsAnalysis]);
    const pyGraph = buildDependencyGraph("/tmp/repo", [pyAnalysis]);
    const tsLinks = buildSymbolLinks("/tmp/repo", [tsAnalysis], tsGraph);
    const pyLinks = buildSymbolLinks("/tmp/repo", [pyAnalysis], pyGraph);

    expect(tsLinks.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceFilePath: "ts/bindings.ts",
          sourceReferenceName: "helper",
          sourceQualifier: "this",
          targetFilePath: "ts/bindings.ts",
          targetSymbolName: "helper",
          resolution: "local"
        })
      ])
    );
    expect(pyLinks.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceFilePath: "python_pkg/bindings.py",
          sourceReferenceName: "helper",
          sourceQualifier: "self",
          targetFilePath: "python_pkg/bindings.py",
          targetSymbolName: "helper",
          resolution: "local"
        })
      ])
    );
  });

  it("treats active parameter bindings as semantic shadows", async () => {
    const analysis = await analyzeFileStructure(
      "ts/shadow.ts",
      [
        'import { helper } from "./lib";',
        "",
        "export function execute(helper: () => void): void {",
        "  helper();",
        "}"
      ].join("\n"),
      "TypeScript"
    );
    const graph = buildDependencyGraph("/tmp/repo", [analysis]);
    const links = buildSymbolLinks("/tmp/repo", [analysis], graph);

    expect(analysis.scopeBindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "helper", kind: "import", sourceSpecifier: "./lib" }),
        expect.objectContaining({ name: "helper", kind: "parameter", containerName: "execute" })
      ])
    );
    expect(links.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceFilePath: "ts/shadow.ts",
          sourceReferenceName: "helper",
          resolution: "unresolved",
          evidence: expect.arrayContaining([expect.stringContaining("shadowed by active parameter binding")])
        })
      ])
    );
  });
});
