from .pkg.module import Foo


class MotionPlanner:
    def step(self, state):
        return state


class BackupPlanner:
    def step(self, state):
        return state


def helper(value):
    foo = Foo()
    return foo.run() + value + 1
