#include <vector>
#include "local.hpp"
#include "utils/math.h"

void Greeter::greet() {}

int main() {
  Greeter greeter;
  greeter.greet();
  std::vector<int> values = {compute_value(1)};
  return values.front();
}
