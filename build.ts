import { $ } from "bun";

await $`rm -rf dist`;

await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  format: "esm",
  target: "node",
  sourcemap: "linked",
  naming: "[dir]/[name].js",
});

await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  format: "cjs",
  target: "node",
  sourcemap: "linked",
  naming: "[dir]/[name].cjs",
});

await $`bunx tsc --emitDeclarationOnly`;

console.log("Build complete.");
