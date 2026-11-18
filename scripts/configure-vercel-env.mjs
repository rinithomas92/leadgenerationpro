import { spawnSync } from "node:child_process";
const cli = process.argv[2];
if (!cli) throw new Error("Provide the Vercel CLI JavaScript entrypoint.");
const settings = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value && /^(INSTAGRAM_|BRAVE_SEARCH_API_KEY$|OPENAI_|PLACES_|GOOGLE_PLACES_API_KEY$|GOOGLE_MAPS_BROWSER_KEY$|APPLE_MAPS_|LEADGEN_DATABASE_URL$|LEADGEN_LOGIN_PASSWORD$|LEADGEN_SESSION_SECRET$)/.test(key)));
settings.LEADGEN_HOSTING = "vercel";
for (const [key, value] of Object.entries(settings)) {
  const result = spawnSync(process.execPath, [cli, "env", "add", key, "production", "--sensitive", "--yes", "--force", "--project", "leadgenerationpro", "--scope", "team_lajEmYPE6RxRXCRZnX9eE7GW"], { input: value, encoding: "utf8" });
  // Never echo CLI output: providers may include a submitted value in errors.
  if (result.status !== 0) throw new Error(`Could not configure ${key}; exit ${result.status}.`);
  console.log(`Configured ${key}`);
}
