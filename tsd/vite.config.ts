import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === "build" ? "/tsd/" : "/",
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/hs": "http://127.0.0.1:8000",
    },
  },
}));
