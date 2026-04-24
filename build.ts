import { $ } from "bun";

// Clean dist
await $`rm -rf dist`;

// Bundle ESM
await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  format: "esm",
  target: "node",
  naming: "[dir]/[name].js",
});

// Bundle CJS
await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  format: "cjs",
  target: "node",
  naming: "[dir]/[name].cjs",
});

// Generate declaration files
await $`bunx tsc --emitDeclarationOnly`;

console.log("Build complete.");
