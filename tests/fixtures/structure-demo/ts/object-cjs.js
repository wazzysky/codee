class ObjectRunner {
  start() {
    return "object";
  }
}

function createObjectRunner() {
  return new ObjectRunner();
}

module.exports = {
  default: ObjectRunner,
  createObjectRunner,
  namedFactory: createObjectRunner,
  ["computedFactory"]: createObjectRunner,
  nested: {
    createNestedRunner: createObjectRunner,
    ["computedNestedRunner"]: createObjectRunner
  }
};
exports.inlineFactory = function inlineFactory() {
  return new ObjectRunner();
};
exports["stringFactory"] = function stringFactory() {
  return new ObjectRunner();
};
module.exports.InlineRunner = class InlineRunner {
  start() {
    return "inline";
  }
};
module.exports["ComputedRunner"] = class ComputedRunner {
  start() {
    return "computed";
  }
};
module.exports.nestedExtra = {
  extraFactory: createObjectRunner
};
