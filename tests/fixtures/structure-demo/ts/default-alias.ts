class DefaultAliasRunner {
  start(): string {
    return "alias";
  }
}

function createAlias(): DefaultAliasRunner {
  return new DefaultAliasRunner();
}

export { createAlias as default, DefaultAliasRunner };
