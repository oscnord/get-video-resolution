import { readdir } from "node:fs/promises";
import { join } from "node:path";
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

// TypeScript emits relative imports without extensions; node16/nodenext
// resolution requires `.js` extensions on the .d.ts files. Post-process and
// emit a `.d.cts` twin so dual-package consumers resolve types correctly.
await rewriteDeclarations("./dist");

console.log("Build complete.");

async function rewriteDeclarations(dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".d.ts")) continue;
    const path = join(entry.parentPath ?? dir, entry.name);
    const original = await Bun.file(path).text();
    const rewritten = original
      .replace(/(from\s+["'])(\.\.?\/[^"']+?)(["'])/g, (_m, pre, spec, post) =>
        spec.endsWith(".js")
          ? `${pre}${spec}${post}`
          : `${pre}${spec}.js${post}`,
      )
      .replace(
        /(import\s*\(\s*["'])(\.\.?\/[^"']+?)(["']\s*\))/g,
        (_m, pre, spec, post) =>
          spec.endsWith(".js")
            ? `${pre}${spec}${post}`
            : `${pre}${spec}.js${post}`,
      );
    await Bun.write(path, rewritten);
    // Emit a CJS-typed twin alongside the ESM-typed declaration. Same content;
    // the .d.cts extension itself signals CJS to Node and TypeScript.
    const ctsPath = path.replace(/\.d\.ts$/, ".d.cts");
    await Bun.write(ctsPath, rewritten);
  }
}
