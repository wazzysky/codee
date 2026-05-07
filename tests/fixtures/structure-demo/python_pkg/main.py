import os

from .pkg.module import Foo
from .utils import MotionPlanner, helper


class Runner:
    def execute(self):
        planner = MotionPlanner()
        foo = Foo()
        return helper(planner.step(foo.run()))


def main():
    return Runner().execute(), os.getcwd()


if __name__ == "__main__":
    print(main())
