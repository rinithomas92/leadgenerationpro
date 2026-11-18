export default function Login() {
  return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#fff7fb", padding: 24 }}>
    <section style={{ maxWidth: 440, width: "100%", padding: 36, borderRadius: 24, background: "white", boxShadow: "0 20px 80px #5d244211" }}>
      <p>LEAD GENERATION PRO</p><h1 style={{ fontSize: 32, margin: "16px 0" }}>Welcome back.</h1>
      <p>Your private workspace for better connections.</p>
      <form action="/api/owner-session" method="post" style={{ display: "grid", gap: 16, marginTop: 24 }}>
        <label htmlFor="password">Workspace password</label>
        <input id="password" name="password" type="password" required autoComplete="current-password" maxLength={200} style={{ padding: 14, border: "1px solid #ddcbd5", borderRadius: 10 }} />
        <button style={{ padding: 14, color: "white", background: "#a83f70", borderRadius: 10 }}>Open workspace</button>
      </form><p style={{ fontSize: 12, marginTop: 20 }}>Use the workspace password provided with your deployment. This is separate from your database password.</p>
    </section>
  </main>;
}
