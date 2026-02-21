import { $ } from "bun";

// Clean dist
await $`rm -rf dist`;

// Bundle ESM with Bun
await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  format: "esm",
  target: "node",
  external: ["@remotion/media-parser"],
});

// Generate declaration files
await $`bunx tsc --emitDeclarationOnly`;

console.log("Build complete.");
