import { createContext, useContext, type ComponentType } from "react";
import type { UpgradeConfiguration } from "@lawnsea/worker-dom";
import { WorkerSubtree } from "./WorkerSubtree.js";
import { WORKER_REF, serializeProps } from "./serialize.js";

export interface WorkerReactConfig {
  /** worker-dom configuration for each worker below this provider. Read when the worker starts. */
  config?: UpgradeConfiguration;
  onError?: (error: unknown) => void;
}

/** Configures the workers that `'use worker'` components below it start. */
export const WorkerReactConfig = createContext<WorkerReactConfig>({});

export interface WorkerScripts {
  /** URL of the worker bundle of `'use worker'` modules. */
  src: string;
  /** URL of `@lawnsea/worker-dom/worker.js`. */
  domURL: string;
}

/**
 * Creates the component the host renders in place of export `name` of the
 * `'use worker'` module `id`. The `worker-react/vite` plugin calls this.
 */
export function createWorkerReference(id: string, name: string, scripts: WorkerScripts): ComponentType<any> {
  const ref = `${id}#${name}`;
  function WorkerReference(props: Record<string, unknown>) {
    const { config, onError } = useContext(WorkerReactConfig);
    return (
      <WorkerSubtree
        name={ref}
        src={scripts.src}
        domURL={scripts.domURL}
        props={{ ref, props: serializeProps(props, `<${name}> props`) }}
        config={config}
        onError={onError}
      />
    );
  }
  WorkerReference.displayName = name === "default" ? id : name;
  (WorkerReference as unknown as Record<string, unknown>)[WORKER_REF] = ref;
  return WorkerReference;
}
