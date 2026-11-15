import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { WorkerSubtree, createSanitizer } from "worker-react";

// Served by vite.config.ts.
const domURL = "/worker-dom.js";

const config = {
  sanitizer: createSanitizer({
    node: (node) => node.nodeName !== "IFRAME",
    attribute: (_, name, value) => !(name === "href" && value !== null && /^\s*javascript:/i.test(value)),
  }),
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
      {shown && <WorkerSubtree className="subtree" src="/subtree.js" domURL={domURL} props={{ name, count }} config={config} />}
    </main>
  );
}

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
