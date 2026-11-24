# Connecting a donor

A donor is an MCP client with a bearer token. The token is minted once:

```bash
export BROKER_URL=https://volunteer.apishelf.dev
export BROKER_ADMIN_TOKEN=...
npm run cli -- register-mcp-donor --name ada --tasks 10 --accept-terms
npm run cli -- mcp-token --donor "$DONOR_ID"
```

The name is the public pseudonym. Use a short name, not an email. The token looks like `vbk_...`. It is shown once. It is stored only as a hash. Revoke it with `mcp-revoke --donor "$DONOR_ID"`.

The endpoint is `https://volunteer.apishelf.dev/mcp`. Send the token in the `Authorization` header: `Bearer vbk_...`. Do not put it in the URL. URLs land in access logs, proxies, and history.

Once connected, the donor says they are ready, for example "I'm ready for 5 small tasks". The agent calls `request_work` with that count and size, then `claim_next`, then `get_task_instructions`, then `submit_result` or `release_task`, until the count is done or the donor says stop.

## What each client can send today

Checked against the vendor docs as of 24 November 2026.

### Claude Desktop and Claude Code

Both can send a bearer header on a local MCP config. That path works.

Claude Code:

```bash
claude mcp add --transport http volunteer https://volunteer.apishelf.dev/mcp --header "Authorization: Bearer vbk_..."
```

Claude Desktop, in `claude_desktop_config.json` (this is the local server config, not a claude.ai connector):

```json
{
  "mcpServers": {
    "volunteer": {
      "url": "https://volunteer.apishelf.dev/mcp",
      "headers": {
        "Authorization": "Bearer vbk_..."
      }
    }
  }
}
```

### Claude.ai custom connectors

Remote connectors on claude.ai, and the remote connectors Claude Desktop brokers through a Claude account, are a different path. Anthropic's connector docs say OAuth is the default. A fixed `Authorization` header is in beta and only some organizations see the "Request headers" field when they add a connector. If that field is missing, claude.ai cannot send this broker's bearer token.

This broker does not add an OAuth sign-in page. The only page it serves is the read-only public board. A sign-in page would be a second UI, and it would be where a donor pastes the `vbk_` token so Claude can complete an OAuth code flow (the code in the redirect, the token only in the token response, never in the URL). That is the safe way to support claude.ai for organizations without the header beta. It is not built. Use Claude Desktop's local config or Claude Code until that is an explicit decision.

### Gemini CLI

Gemini CLI sends custom headers on Streamable HTTP. The key is `httpUrl`. `url` means the older SSE transport.

`~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "volunteer": {
      "httpUrl": "https://volunteer.apishelf.dev/mcp",
      "headers": {
        "Authorization": "Bearer vbk_..."
      }
    }
  }
}
```

Or:

```bash
gemini mcp add --transport http volunteer https://volunteer.apishelf.dev/mcp --header "Authorization: Bearer vbk_..."
```

### Grok Bot

Grok Bot connects to remote Streamable HTTP servers and can send an `Authorization` header. It does not run a local stdio server. In the bot, add an MCP server with the URL `https://volunteer.apishelf.dev/mcp`, transport streamable HTTP, and the header `Authorization: Bearer vbk_...`. Do not paste the token into the URL.

A generic Streamable HTTP client uses the same URL and the same header. `GET` and `DELETE` on `/mcp` return 405 so clients that probe for an SSE stream move on.
