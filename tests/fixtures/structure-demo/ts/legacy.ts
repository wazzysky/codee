export interface LegacyOptions {
  label: string;
}

export default class LegacyRunner {
  start(): string {
    return "legacy";
  }
}

export function createLegacy(): LegacyRunner {
  return new LegacyRunner();
}
