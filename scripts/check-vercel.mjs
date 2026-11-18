const base = process.argv[2];
if (!base) throw new Error("Provide the deployment URL.");
const anonymous = await fetch(base + "/api/workspace", { redirect: "manual" });
console.log("Anonymous workspace status: " + anonymous.status);
if (anonymous.status !== 401) throw new Error("Workspace must require sign-in.");
const login = await fetch(base + "/api/owner-session", { method: "POST", headers: { Origin: base, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ password: process.env.LEADGEN_LOGIN_PASSWORD }), redirect: "manual" });
if (login.status !== 303) throw new Error("Workspace sign-in failed: " + login.status);
const cookie = login.headers.get("set-cookie")?.split(";")[0];
if (!cookie) throw new Error("Missing session cookie.");
for (const endpoint of ["/api/workspace", "/api/projects", "/api/places", "/api/places/instagram", "/api/places/instagram/search"]) {
  const response = await fetch(base + endpoint, { headers: { Cookie: cookie } });
  const data = await response.json();
  console.log(JSON.stringify({ endpoint, status: response.status, leads: data.state?.leads?.length, enabled: data.enabled, used: data.used, cap: data.cap }));
  if (!response.ok) throw new Error("Endpoint verification failed.");
}
