export interface KnowledgePoint {
  id: string;
  name: string;
  domain: string;
  aliases: string[];
  keywords: string[];
  description: string;
}

export const knowledgePoints: KnowledgePoint[] = [
  {
    id: "pid-control",
    name: "PID Control",
    domain: "control",
    aliases: ["pid", "pid controller", "proportional integral derivative"],
    keywords: ["pid", "kp", "ki", "kd", "proportional", "integral", "derivative"],
    description: "Classic feedback control using proportional, integral, and derivative terms."
  },
  {
    id: "lqr",
    name: "LQR",
    domain: "control",
    aliases: ["linear quadratic regulator"],
    keywords: ["lqr", "linear quadratic regulator", "riccati", "state cost", "control cost"],
    description: "Optimal state feedback control based on a quadratic cost function."
  },
  {
    id: "mpc",
    name: "MPC",
    domain: "control",
    aliases: ["model predictive control"],
    keywords: ["mpc", "model predictive control", "prediction horizon", "control horizon", "optimizer", "qp"],
    description: "Model predictive control using a horizon-based optimization problem."
  },
  {
    id: "kalman-filter",
    name: "Kalman Filter",
    domain: "estimation",
    aliases: ["kf"],
    keywords: ["kalman", "state estimate", "covariance", "prediction step", "update step"],
    description: "Recursive estimator for linear systems with noisy observations."
  },
  {
    id: "extended-kalman-filter",
    name: "Extended Kalman Filter",
    domain: "estimation",
    aliases: ["ekf", "extended kalman"],
    keywords: ["extended kalman", "ekf", "jacobian", "linearization"],
    description: "Nonlinear Kalman filtering using local linearization."
  },
  {
    id: "sensor-fusion",
    name: "Sensor Fusion",
    domain: "estimation",
    aliases: ["multi-sensor fusion"],
    keywords: ["sensor fusion", "fuse", "imu", "lidar", "camera", "radar", "gps"],
    description: "Combining observations from multiple sensors into one estimate."
  },
  {
    id: "slam",
    name: "SLAM",
    domain: "robotics",
    aliases: ["simultaneous localization and mapping"],
    keywords: ["slam", "localization and mapping", "loop closure", "pose graph", "map optimization"],
    description: "Simultaneous localization and mapping for robot state and environment estimation."
  },
  {
    id: "ros-node",
    name: "ROS Node",
    domain: "robotics",
    aliases: ["rclcpp node", "rclpy node", "rospy node"],
    keywords: ["rclcpp::node", "rclpy.node", "rospy.init_node", "ros::nodehandle", "create_publisher", "create_subscription"],
    description: "ROS or ROS 2 executable node participating in graph communication."
  },
  {
    id: "ros-launch",
    name: "ROS Launch",
    domain: "robotics",
    aliases: ["launch file", "launchdescription"],
    keywords: ["launchdescription", "launch_ros", ".launch", ".launch.py", "generate_launch_description"],
    description: "ROS launch files that compose and start runtime systems."
  },
  {
    id: "astar-search",
    name: "A* Search",
    domain: "planning",
    aliases: ["astar", "a star", "a*"],
    keywords: ["astar", "a_star", "a*", "heuristic", "open set", "closed set"],
    description: "Heuristic graph search for shortest path planning."
  },
  {
    id: "rrt",
    name: "RRT",
    domain: "planning",
    aliases: ["rapidly exploring random tree"],
    keywords: ["rrt", "rapidly exploring random tree", "sample free", "nearest", "steer"],
    description: "Sampling-based path planning using a rapidly exploring random tree."
  },
  {
    id: "occupancy-grid",
    name: "Occupancy Grid",
    domain: "mapping",
    aliases: ["occupancygrid", "grid map"],
    keywords: ["occupancy grid", "occupancygrid", "nav_msgs/occupancygrid", "costmap", "grid map"],
    description: "Grid-based environment representation storing occupancy likelihood."
  },
  {
    id: "trajectory-planning",
    name: "Trajectory Planning",
    domain: "planning",
    aliases: ["trajectory generation"],
    keywords: ["trajectory", "waypoint", "path planning", "quintic", "cubic spline", "time-optimal"],
    description: "Planning continuous trajectories or waypoint sequences for motion."
  },
  {
    id: "cmake",
    name: "CMake",
    domain: "tooling",
    aliases: ["cmakelists"],
    keywords: ["cmake", "cmakelists", "find_package", "add_executable", "ament_package", "catkin_package"],
    description: "Cross-platform native build system driven by CMake configuration."
  },
  {
    id: "docker",
    name: "Docker",
    domain: "tooling",
    aliases: ["container", "dockerfile"],
    keywords: ["docker", "dockerfile", "from ", "container"],
    description: "Container build and runtime packaging using Docker."
  },
  {
    id: "typescript-frontend",
    name: "TypeScript Frontend",
    domain: "frontend",
    aliases: ["react frontend", "vue frontend", "web frontend"],
    keywords: ["tsx", "react", "vue", "vite", "next.js", "frontend", "component"],
    description: "Frontend application or UI layer built with TypeScript-oriented web tooling."
  },
  {
    id: "python-package",
    name: "Python Package",
    domain: "python",
    aliases: ["python project", "poetry package", "uv package"],
    keywords: ["pyproject.toml", "requirements.txt", "setup.py", "poetry", "uv", "pip"],
    description: "Python package metadata and dependency management layout."
  }
];
