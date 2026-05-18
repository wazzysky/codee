import createAlias, { DefaultAliasRunner } from "./default-alias";
import DefaultObjectRunner, {
  ComputedRunner,
  createObjectRunner,
  computedFactory,
  inlineFactory,
  namedFactory,
  InlineRunner,
  stringFactory
} from "./object-cjs";
import * as ObjectModule from "./object-cjs";

export function useObjectInterop(): string {
  const aliasRunner = createAlias();
  const explicitRunner = new DefaultAliasRunner();
  const objectRunner = new DefaultObjectRunner();
  const inlineRunner = new InlineRunner();
  const computedRunner = new ComputedRunner();
  return (
    aliasRunner.start() +
    explicitRunner.start() +
    objectRunner.start() +
    inlineRunner.start() +
    computedRunner.start() +
    createObjectRunner().start() +
    computedFactory().start() +
    ObjectModule.nested.createNestedRunner().start() +
    ObjectModule.nestedExtra.extraFactory().start() +
    inlineFactory().start() +
    stringFactory().start() +
    namedFactory().start()
  );
}
