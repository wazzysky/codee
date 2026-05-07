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
        'import Engine, { ArrowTool, helper } from "./lib";',
        'import ReactDOM from "react-dom/client";',
        'import { Panel } from "./ui";',
        "",
        "export class Bootstrapper {",
        "  run(): void {",
        "    const engine = new Engine();",
        "    console.log(engine.start());",
        "  }",
        "}",
        "",
        "export function App(): JSX.Element {",
        "  return <Panel label={String(ArrowTool(helper(1)))} />;",
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

    expect(analysis.imports.map((item) => item.specifier)).toEqual(["./lib", "react-dom/client", "./ui"]);
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
        expect.objectContaining({ localName: "ReactDOM", sourceSpecifier: "react-dom/client", kind: "default" })
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
    const linkGraph = buildSymbolLinks(scanResult.root, symbolResult.files, dependencyGraph);

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
          sourceFilePath: "cpp/main.cpp",
          sourceReferenceName: "compute_value",
          targetFilePath: "cpp/utils/math.cpp",
          targetSymbolName: "compute_value",
          resolution: "internal"
        })
      ])
    );
  });
});
