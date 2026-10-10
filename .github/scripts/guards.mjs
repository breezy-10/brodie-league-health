// Static checks for failures that don't show up in a build (run in PR checks).
// Each one has cost a silent outage in a Brodie app before:
//   1. middleware.ts in the wrong folder: Next ignores it, so sign-in is never
//      enforced (8 apps, found Sep 2026).
//   2. A scheduled job (vercel.json "crons") whose route doesn't check
//      CRON_SECRET: anyone can trigger it.
//   3. A scheduled job whose route file is missing (renamed or deleted).
//   4. An env file committed to the repo.
// Usage: node .github/scripts/guards.mjs
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const problems = [];

// 1. Middleware placement (Next apps only).
const nextConfig = ["next.config.ts", "next.config.mjs", "next.config.js"].some((f) => existsSync(f));
if (nextConfig) {
  const inSrc = existsSync("src/app");
  const want = inSrc ? ["src/middleware.ts", "src/proxy.ts"] : ["middleware.ts", "proxy.ts"];
  const wrong = inSrc ? ["middleware.ts", "proxy.ts"] : ["src/middleware.ts", "src/proxy.ts"];
  if (!want.some((f) => existsSync(f))) {
    problems.push(`No ${want.join(" or ")}: sign-in isn't enforced. The app lives in ${inSrc ? "src/" : "the repo root"}, so the middleware must too.`);
  }
  for (const f of wrong) {
    if (existsSync(f)) problems.push(`${f} is in the wrong folder and Next ignores it. Move it to ${want[0]}.`);
  }
}

// 2 + 3. Every scheduled job has a route that checks CRON_SECRET.
const crons = existsSync("vercel.json") ? (JSON.parse(readFileSync("vercel.json", "utf8")).crons ?? []) : [];
for (const { path } of crons) {
  const route = path.split("?")[0].replace(/^\//, "");
  const candidates = [
    join("src/app", route, "route.ts"),
    join("app", route, "route.ts"),
    `${route}.mjs`, `${route}.ts`, `${route}.js`, // Vercel functions in /api (brodie-crm)
  ];
  const file = candidates.find((f) => existsSync(f));
  if (!file) {
    problems.push(`Scheduled job ${path} has no route file (looked for ${candidates.slice(0, 2).join(", ")}).`);
    continue;
  }
  const src = readFileSync(file, "utf8");
  const checksSecret = src.includes("CRON_SECRET") || /cron-auth|verifyCron|isCronRequest|requireCron/i.test(src);
  if (!checksSecret) problems.push(`${file} (scheduled job ${path}) doesn't check CRON_SECRET, so anyone can trigger it.`);
}

// 4. No env files in git (examples are fine).
const tracked = execSync("git ls-files", { encoding: "utf8" }).split("\n");
for (const f of tracked) {
  const name = f.split("/").pop() ?? "";
  if (/^\.env(\..+)?$/.test(name) && !/\.(example|sample|template)$/.test(name)) {
    problems.push(`${f} is committed. Remove it from git and rotate any keys in it.`);
  }
}

if (problems.length > 0) {
  console.error("Guard checks failed:\n" + problems.map((p) => `- ${p}`).join("\n"));
  process.exit(1);
}
console.log(`Guard checks passed (${crons.length} scheduled job${crons.length === 1 ? "" : "s"} checked).`);
