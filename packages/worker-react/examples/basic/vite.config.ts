import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { workerReact } from "worker-react/vite";

export default defineConfig({
  plugins: [workerReact(), react()],
});
