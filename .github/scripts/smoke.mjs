// Checks the live site right after a production deploy, without signing in
// and without running anything:
//   - the home page redirects to /login (the sign-in check is running),
//   - /login loads,
//   - every scheduled job's route is reachable. An OPTIONS request reaches the
//     route without running the job; a redirect means the sign-in check is
//     blocking it, which silently stops the job.
// Usage: PROD_URL=https://example.vercel.app node .github/scripts/smoke.mjs
// SMOKE_MODE=spa (brodie-crm): the home page just has to load; jobs are skipped
// because an OPTIONS request would run a plain Vercel function.
import { existsSync, readFileSync } from "node:fs";

const base = (process.env.PROD_URL ?? "").replace(/\/$/, "");
if (!base) throw new Error("PROD_URL isn't set");
const spa = process.env.SMOKE_MODE === "spa";
const problems = [];

async function hit(method, path) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await fetch(base + path, { method, redirect: "manual", signal: AbortSignal.timeout(20_000) });
    } catch (err) {
      if (attempt === 3) return { status: 0, headers: new Headers(), error: String(err) };
      await new Promise((r) => setTimeout(r, 5_000));
    }
  }
}

const home = await hit("GET", "/");
if (spa) {
  if (home.status !== 200) problems.push(`GET / returned ${home.status}, expected 200.`);
} else {
  const to = home.headers.get("location") ?? "";
  if (!(home.status >= 300 && home.status < 400 && to.includes("/login"))) {
    problems.push(`GET / returned ${home.status}${to ? ` -> ${to}` : ""}. Expected a redirect to /login: is the sign-in check (middleware) running?`);
  }
  const login = await hit("GET", "/login");
  if (login.status !== 200) problems.push(`GET /login returned ${login.status}, expected 200.`);

  const crons = existsSync("vercel.json") ? (JSON.parse(readFileSync("vercel.json", "utf8")).crons ?? []) : [];
  for (const { path } of crons) {
    const p = path.split("?")[0];
    const r = await hit("OPTIONS", p);
    if (r.status >= 300 && r.status < 400) problems.push(`Scheduled job ${p} is redirected (${r.status}) to ${r.headers.get("location")}: the sign-in check is blocking it, so it never runs.`);
    else if (r.status === 404) problems.push(`Scheduled job ${p} returned 404: the route is missing.`);
    else if (r.status === 0 || r.status >= 500) problems.push(`Scheduled job ${p} returned ${r.status || r.error}.`);
  }
}

if (problems.length > 0) {
  console.error(`Smoke test failed for ${base}:\n` + problems.map((p) => `- ${p}`).join("\n"));
  process.exit(1);
}
console.log(`Smoke test passed for ${base}.`);
