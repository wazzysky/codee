import Engine, { ArrowTool, ConsoleEngine, helper } from "./lib";
import ReactDOM from "react-dom/client";
import { Panel } from "./ui";

export class Bootstrapper {
  run(): void {
    const engine = new Engine();
    const consoleEngine = new ConsoleEngine();
    console.log(engine.start());
    console.log(consoleEngine.start());
  }
}

export function App(): JSX.Element {
  return <Panel label={String(ArrowTool(helper(1)))} />;
}

export const MainView = (): JSX.Element => <App />;

export function bootstrap(): void {
  new Bootstrapper().run();
  ReactDOM.createRoot(document.getElementById("root")!).render(<MainView />);
}
