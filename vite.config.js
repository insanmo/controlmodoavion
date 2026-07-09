import { defineConfig, loadEnv } from "vite";

// La base se lee desde VITE_BASE_PATH (.env.local para desarrollo, .env.production para GitHub Pages).
// Vite carga .env.[mode]: `npm run dev` => modo development (usa .env.local),
// `npm run build` => modo production (usa .env.production).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const base = env.VITE_BASE_PATH || "/";
  return {
    root: ".",
    base,
    build: {
      outDir: "dist",
      emptyOutDir: true,
      target: "es2020"
    }
  };
});
