import CommonRunner = require("./legacy-cjs");
import type { LegacyOptions } from "./legacy";
import { LegacyRunner, createLegacy } from "./legacy-bridge";

export function useLegacy(options: LegacyOptions): string {
  const commonRunner = new CommonRunner();
  const legacyRunner = createLegacy();
  return commonRunner.start() + legacyRunner.start() + LegacyRunner.name + options.label;
}
