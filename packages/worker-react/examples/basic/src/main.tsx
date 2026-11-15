import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { WorkerReactConfig, createSanitizer } from "worker-react";
import { Greeting } from "./Greeting.js";
import Badge from "./Badge.js";

const workerConfig = {
  config: {
    sanitizer: createSanitizer({
      node: (node) => node.nodeName !== "IFRAME",
      attribute: (_, name, value) => !(name === "href" && value !== null && /^\s*javascript:/i.test(value)),
    }),
  },
};

function App() {
  const [name, setName] = useState("world");
  const [count, setCount] = useState(0);
  const [shown, setShown] = useState(true);
  return (
    <main>
      <h1>Host</h1>
      <label>
        Name <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <button onClick={() => setCount((c) => c + 1)}>Increment host count</button>
      <label>
        <input type="checkbox" checked={shown} onChange={(e) => setShown(e.target.checked)} /> Show subtree
      </label>
      {shown && (
        <Greeting name={name} count={count}>
          <Badge label={`${name} is new`} />
          <Badge label="worker-rendered" />
        </Greeting>
      )}
    </main>
  );
}

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <WorkerReactConfig value={workerConfig}>
      <App />
    </WorkerReactConfig>
  </StrictMode>,
);
