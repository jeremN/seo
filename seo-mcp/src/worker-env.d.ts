import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

// Ambient Worker bindings: the wrangler.jsonc bindings/vars, the GitHub OAuth
// secrets, and the OAuthHelpers the provider injects into env at runtime.
// Declared globally so the handlers can refer to `Env` directly.
declare global {
  interface Env {
    OAUTH_KV: KVNamespace;
    ALLOWED_GITHUB_LOGINS: string;
    GITHUB_CLIENT_ID: string;
    GITHUB_CLIENT_SECRET: string;
    CRUX_API_KEY?: string; // optional: enables Core Web Vitals in audit_site
    OAUTH_PROVIDER: OAuthHelpers;
  }
}

export {};
