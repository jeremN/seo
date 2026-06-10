import type { AuthRequest } from "@cloudflare/workers-oauth-provider";

// GitHub OAuth upstream endpoints.
const GH_AUTHORIZE = "https://github.com/login/oauth/authorize";
const GH_TOKEN = "https://github.com/login/oauth/access_token";
const GH_USER = "https://api.github.com/user";

const STATE_PREFIX = "gh_state:";
const STATE_TTL_S = 600; // 10 minutes to complete the round-trip

const callbackUrl = (request: Request): string => new URL("/callback", request.url).href;

// Step 1: a client hits /authorize. Persist the parsed OAuth request under a
// random state key (CSRF protection for the GitHub leg + carrier across the
// round-trip), then bounce the human to GitHub to authenticate.
async function handleAuthorize(request: Request, env: Env): Promise<Response> {
  const oauthReqInfo = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  if (!oauthReqInfo.clientId) return new Response("Invalid OAuth request", { status: 400 });

  const state = crypto.randomUUID();
  await env.OAUTH_KV.put(`${STATE_PREFIX}${state}`, JSON.stringify(oauthReqInfo), { expirationTtl: STATE_TTL_S });

  const gh = new URL(GH_AUTHORIZE);
  gh.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  gh.searchParams.set("redirect_uri", callbackUrl(request));
  gh.searchParams.set("scope", "read:user");
  gh.searchParams.set("state", state);
  gh.searchParams.set("response_type", "code");
  return Response.redirect(gh.href, 302);
}

// Step 2: GitHub redirects back to /callback. Validate state, exchange the code
// for a token, read the GitHub login, then mint the bound MCP token. The `login`
// is placed in props — the tool layer reads it via getMcpAuthContext().props.login
// and enforces the allowlist there.
async function handleCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return new Response("Missing code or state", { status: 400 });

  const stored = await env.OAUTH_KV.get(`${STATE_PREFIX}${state}`);
  if (!stored) return new Response("Invalid or expired state", { status: 400 });
  await env.OAUTH_KV.delete(`${STATE_PREFIX}${state}`);
  const oauthReqInfo = JSON.parse(stored) as AuthRequest;

  const tokenRes = await fetch(GH_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: callbackUrl(request),
    }).toString(),
  });
  if (!tokenRes.ok) return new Response("GitHub token exchange failed", { status: 502 });
  const accessToken = ((await tokenRes.json()) as { access_token?: string }).access_token;
  if (!accessToken) return new Response("GitHub did not return an access token", { status: 502 });

  const userRes = await fetch(GH_USER, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json", "User-Agent": "seo-guard-mcp" },
  });
  if (!userRes.ok) return new Response("GitHub user lookup failed", { status: 502 });
  const user = (await userRes.json()) as { login: string; name: string | null };

  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthReqInfo,
    userId: user.login,
    metadata: { label: user.name ?? user.login },
    scope: oauthReqInfo.scope,
    props: { login: user.login, name: user.name ?? user.login },
  });
  // `redirectTo` is NOT attacker-controlled: the provider built it from the OAuth
  // client's redirect_uri, which it already validated against the registered client
  // during parseAuthRequest/completeAuthorization (OAuth 2.1 redirect_uri allowlisting).
  return Response.redirect(redirectTo, 302); // nosemgrep
}

// The OAuthProvider's defaultHandler: authenticates the human via GitHub before
// the provider issues an MCP token. Plain ExportedHandler — no web framework.
export const GitHubHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/authorize") return handleAuthorize(request, env);
    if (pathname === "/callback") return handleCallback(request, env);
    return new Response("Not found", { status: 404 });
  },
};
