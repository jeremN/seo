import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp";
import { createServer } from "./server.js";
import { parseAllowlist } from "./auth.js";
import { GitHubHandler } from "./github-handler.js";

// A fresh McpServer + handler per request — the MCP SDK 1.26+ isolation
// requirement (shared instances can leak one client's response to another).
const apiHandler = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const server = createServer(parseAllowlist(env.ALLOWED_GITHUB_LOGINS), env.CRUX_API_KEY);
    return createMcpHandler(server)(request, env, ctx);
  },
};

// The OAuthProvider is the OAuth 2.1 server: it fronts /mcp with token auth,
// delegates human authentication to GitHubHandler, and issues bound MCP tokens.
export default new OAuthProvider<Env>({
  apiRoute: "/mcp",
  apiHandler,
  defaultHandler: GitHubHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});
