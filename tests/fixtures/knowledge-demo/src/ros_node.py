from rclpy.node import Node


class DemoNode(Node):
    def __init__(self) -> None:
        super().__init__("demo")
        self.create_subscription(str, "input", lambda msg: None, 10)
