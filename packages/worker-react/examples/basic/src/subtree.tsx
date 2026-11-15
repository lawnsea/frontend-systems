import { useState } from "react";
import { renderInWorker } from "worker-react/worker";

declare const importScripts: unknown;

function Greeting({ name, count }: { name: string; count: number }) {
  const [clicks, setClicks] = useState(0);
  return (
    <section>
      <p className="greeting">
        Hello, {name}! Host count: {count}
      </p>
      <p className="realm">In a worker: {typeof importScripts === "function" ? "yes" : "no"}</p>
      <button onClick={() => setClicks((c) => c + 1)}>Clicked {clicks} times in the worker</button>
      {/* The host's sanitizer drops both of these. */}
      <iframe title="dropped" src="about:blank" />
      <a href="javascript:alert(1)">Link without an href</a>
    </section>
  );
}

renderInWorker(Greeting);
