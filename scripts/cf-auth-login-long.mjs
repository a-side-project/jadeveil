/**
 * Long-lived OAuth helper for the Cloudflare `cf` CLI.
 *
 * 用法：先用 `cf auth login` 拿到它打印的授权 URL（存成 /tmp/cf-auth-url.txt 或设
 *  CF_AUTH_URL_FILE），停掉那条命令，再 `node scripts/cf-auth-login-long.mjs &`,
 *  然后把 /tmp/cf-oauth-url.txt 的链接在浏览器里打开、由本人确认授权。
 *
 * Why: `cf auth login` builds the right consent URL but its local callback
 * server is hard-capped at LOGIN_TIMEOUT_MS = 120s (cf-cli src/lib/oauth).
 * A human approving the consent form asynchronously usually needs longer, and
 * when the cap fires the consent page goes stale.
 *
 * This script does exactly what the CLI does — same public OAuth client, same
 * PKCE, same endpoints, same callback path, same stored-token format — but the
 * callback server stays up for 45 minutes and it writes ~/.cf/config.toml in
 * the CLI's own format so `cf` works again afterwards.
 *
 * It never prints or logs token material.
 */
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync, readFileSync, mkdirSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CLIENT_ID = "cbca97e7-c331-4cdd-8fd8-e25a451b98bf";
const AUTHORIZE = "https://dash.cloudflare.com/oauth2/auth";
const TOKEN = "https://dash.cloudflare.com/oauth2/token";
const PORT = 8877;
const PATH = "/oauth/callback";
const REDIRECT = `http://localhost:${PORT}${PATH}`;

// Reuse the exact scope list the CLI requested (taken from the URL the CLI
// itself printed) so the consent screen shows the same permissions.
const cliUrl = new URL(readFileSync(process.env.CF_AUTH_URL_FILE || "/tmp/cf-auth-url.txt", "utf8").trim());
const SCOPES = cliUrl.searchParams.get("scope");
if (!SCOPES) throw new Error("no scope found in /tmp/cf-auth-url.txt");

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const verifier = b64url(randomBytes(32));
const challenge = b64url(createHash("sha256").update(verifier).digest());
const state = b64url(randomBytes(16));

const authUrl = new URL(AUTHORIZE);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("client_id", CLIENT_ID);
authUrl.searchParams.set("redirect_uri", REDIRECT);
authUrl.searchParams.set("scope", SCOPES);
authUrl.searchParams.set("state", state);
authUrl.searchParams.set("code_challenge", challenge);
authUrl.searchParams.set("code_challenge_method", "S256");
writeFileSync("/tmp/cf-oauth-url.txt", authUrl.toString());

const result = (obj) => writeFileSync("/tmp/cf-oauth-result.json", JSON.stringify(obj, null, 2));
const html = (res, status, heading, detail) => {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><meta charset="utf-8"><title>${heading}</title>
<body style="font:15px -apple-system,system-ui;margin:3rem"><h1>${heading}</h1><p>${detail}</p></body>`);
};

let done = false;
const handler = async (req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (u.pathname !== PATH) return html(res, 404, "Not Found", "Wrong path.");
  const err = u.searchParams.get("error");
  const code = u.searchParams.get("code");
  const gotState = u.searchParams.get("state");

  if (err) {
    done = true;
    result({ ok: false, step: "consent", error: err, description: u.searchParams.get("error_description") });
    console.log("CONSENT_DENIED", err);
    html(res, 200, "Authorization denied", "You can close this window.");
    setTimeout(() => process.exit(1), 300);
    return;
  }
  if (!code || gotState !== state) {
    // Stale challenge from an earlier flow: answer politely but keep waiting.
    result({ ok: false, step: "state", note: "state mismatch — stale consent page" });
    console.log("STATE_MISMATCH (ignored, still waiting)");
    return html(res, 409, "This link has expired", "Ask for a fresh authorization link and try again.");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT,
    client_id: CLIENT_ID,
    code_verifier: verifier,
  });
  const resp = await fetch(TOKEN, {
    method: "POST",
    body: body.toString(),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    signal: AbortSignal.timeout(20000),
  });
  const text = await resp.text();
  if (!resp.ok) {
    done = true;
    result({ ok: false, step: "exchange", status: resp.status, body: text.slice(0, 400) });
    console.log("EXCHANGE_FAILED", resp.status);
    html(res, 500, "Token exchange failed", "See the task report.");
    setTimeout(() => process.exit(1), 300);
    return;
  }

  const tok = JSON.parse(text);
  const expiresAt = new Date(Date.now() + tok.expires_in * 1000).toISOString();
  const scopes = tok.scope ? tok.scope.split(" ") : [];
  const cfgDir = join(homedir(), ".cf");
  mkdirSync(cfgDir, { recursive: true, mode: 0o700 });
  const cfg = `# CF CLI OAuth Configuration
# This file is auto-generated. Do not edit manually.

access_token = "${tok.access_token}"
refresh_token = "${tok.refresh_token}"
expires_at = "${expiresAt}"
scopes = [${scopes.map((s) => `"${s}"`).join(", ")}]
`;
  const cfgFile = join(cfgDir, "config.toml");
  writeFileSync(cfgFile, cfg, { mode: 0o600 });
  chmodSync(cfgFile, 0o600);

  done = true;
  result({
    ok: true,
    expiresAt,
    scopeCount: scopes.length,
    hasAccessWrite: scopes.includes("access:write"),
    hasAccessRead: scopes.includes("access:read"),
    writtenTo: "~/.cf/config.toml",
  });
  console.log("AUTHORIZED — ~/.cf/config.toml written");
  html(res, 200, "Authorized", "The Cloudflare CLI (cf) is now logged in. You can close this window.");
  setTimeout(() => process.exit(0), 500);
};

const v4 = createServer(handler);
const v6 = createServer(handler);
v4.listen(PORT, "127.0.0.1", () => console.log("listening on 127.0.0.1:" + PORT));
v6.on("error", () => {});
v6.listen(PORT, "::1", () => console.log("listening on [::1]:" + PORT));

setTimeout(() => {
  if (!done) {
    console.log("TIMEOUT_NO_CALLBACK");
    process.exit(2);
  }
}, 45 * 60 * 1000);
