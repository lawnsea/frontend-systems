import { useEffect, useRef, useState, type CSSProperties } from "react";
import { upgradeElement, type ExportedWorker, type UpgradeConfiguration } from "@lawnsea/worker-dom";
import { SET_PROPS } from "./protocol.js";

export interface WorkerSubtreeProps {
  /** URL of a classic script that calls `renderInWorker`. */
  src: string;
  /** URL of `@lawnsea/worker-dom/worker.js`. */
  domURL: string;
  /** Props for the worker's component. Must be JSON-serializable. */
  props?: Record<string, unknown>;
  /** worker-dom configuration. Read when the worker starts. */
  config?: UpgradeConfiguration;
  onError?: (error: unknown) => void;
  className?: string;
  style?: CSSProperties;
}

/**
 * Renders the component that `src` passes to `renderInWorker`, in a worker.
 * The worker restarts when `src` or `domURL` changes.
 */
export function WorkerSubtree({ src, domURL, props = {}, config, onError, className, style }: WorkerSubtreeProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [worker, setWorker] = useState<ExportedWorker | null>(null);
  const latest = useRef({ config, onError });
  latest.current = { config, onError };

  useEffect(() => {
    // worker-dom owns this container's children, so React never renders into it.
    // A fresh container per worker keeps late mutations from a terminated
    // worker off the page.
    const container = document.createElement("div");
    container.setAttribute("src", src);
    hostRef.current!.appendChild(container);

    let cancelled = false;
    let started: ExportedWorker | null = null;
    upgradeElement(container, domURL, latest.current.config).then(
      (w) => {
        if (!w) return;
        if (cancelled) {
          w.terminate();
          return;
        }
        started = w;
        w.onerror = (event) => latest.current.onError?.(event);
        setWorker(w);
      },
      (error) => {
        if (!cancelled) latest.current.onError?.(error);
      },
    );

    return () => {
      cancelled = true;
      started?.terminate();
      container.remove();
      setWorker(null);
    };
  }, [src, domURL]);

  const serialized = JSON.stringify(props);
  useEffect(() => {
    if (!worker) return;
    worker.callFunction(SET_PROPS, JSON.parse(serialized)).catch((error) => latest.current.onError?.(error));
  }, [worker, serialized]);

  return <div ref={hostRef} className={className} style={style} />;
}
