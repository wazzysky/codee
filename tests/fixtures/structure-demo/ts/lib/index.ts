export default class Engine {
  start(): string {
    return "ok";
  }
}

export class ConsoleEngine {
  start(): string {
    return "console";
  }
}

export function helper(value: number): number {
  return value + 1;
}

export const ArrowTool = (value: number): number => value * 2;
