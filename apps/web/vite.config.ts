import { defineConfig } from "vite";

export default defineConfig({
  // Relative Pfade → läuft auch unter Sub-Pfaden (GitHub Pages)
  base: "./",
  // brands/ liegt im Repo-Root und wird als statisches Verzeichnis ausgeliefert
  publicDir: "public",
  server: {
    fs: { allow: ["../.."] },
  },
});
