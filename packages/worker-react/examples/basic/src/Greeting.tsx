"use worker";

import { useState, type ReactNode } from "react";

declare const importScripts: unknown;

export function Greeting({ name, count, children }: { name: string; count: number; children?: ReactNode }) {
  const [clicks, setClicks] = useState(0);
  return (
    <section>
      <p className="greeting">
        Hello, {name}! Host count: {count}
      </p>
      <p className="realm">In a worker: {typeof importScripts === "function" ? "yes" : "no"}</p>
      <button onClick={() => setClicks((c) => c + 1)}>Clicked {clicks} times in the worker</button>
      <div className="children">{children}</div>
      {/* The host's sanitizer drops both of these. */}
      <iframe title="dropped" src="about:blank" />
      <a href="javascript:alert(1)">Link without an href</a>
    </section>
  );
}
