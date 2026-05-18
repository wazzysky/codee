class CommonRunner {
  start() {
    return "common";
  }
}

function createCommonRunner() {
  return new CommonRunner();
}

module.exports = CommonRunner;
exports.createCommonRunner = createCommonRunner;
