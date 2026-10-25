# PLOGME

PLOGME is the organization and community hub for CRYSNOVA AI and CODY AI. It includes the original CODY pairing console, deployment guides, an approved plugin marketplace, AI support, service status, developer tools, and a user Control Center.

## Platform features

- `/pair` preserves the original CODY_PAIR console and pairing flow.
- `/plugins` provides GitHub-gated submissions, admin review, code editing, TXT CDN publication, install commands, versions, and marketplace search.
- `/admin` provides moderation, history, permanent removal, request logs, and daily/weekly/monthly per-endpoint analytics.
- `/dashboard` provides the authenticated user Control Center for identity, submissions, published plugins, AI conversations, API keys, and global search.
- `/status` provides a live service-status view.
- `/crysnova` contains the ready-to-copy CRYSNOVA AI deployment script and instructions.
- `/services`, `/api`, `/tutorials`, and `/community` organize the wider ecosystem.
- CODY AI uses the CODYEBOT knowledge family with provider order: Groq, OpenAI-compatible provider, fast no-key Prexzy `/ai/ch`, DeepQuery, and AiServ fallback.
- The portal includes global blur transitions, responsive navigation, a command-center visual system, PWA metadata, and an offline shell.

## Persistence architecture

The production persistence schema is provisioned in Cloudflare D1 database `plogme-platform` with identifier `627154bc-8048-4071-b45a-e39e3c79c6d0`. It covers users, sessions, submissions, plugins, plugin versions, audit events, request logs, AI conversations, service status, notifications, and developer API keys.

The application uses `data-store.js`. When `PLOGME_DATA_API_URL` and `PLOGME_DATA_SECRET` are configured, request logs, users, marketplace queries, dashboards, notifications, and API-key operations use the authenticated D1 gateway. Without those variables, local JSON storage remains available for development and preview environments.

The D1 gateway source is `cloudflare/plogme-data-worker.js`; its binding configuration is in `cloudflare/wrangler.toml`:

```bash
cd cloudflare
npx wrangler secret put PLOGME_DATA_SECRET
npx wrangler deploy
```

Then configure the Node deployment with:

```bash
PLOGME_DATA_API_URL="https://plogme-data.<your-subdomain>.workers.dev"
PLOGME_DATA_SECRET="same-secret-used-by-the-worker"
```

The existing Cloudflare KV namespaces `SESSION_KV` and `GROQ_STATS` remain available for edge sessions and AI-rate-limit acceleration. D1 is the source of truth for relational platform data.

## Production deployment

Install Node.js 20 or newer:

```bash
git clone https://github.com/crysnovax/CODYSITE.git
cd CODYSITE
npm install
ADMIN_PASSWORD="replace-with-a-long-random-password" \
CDN_URL="https://cdn.crysnovax.link" \
GITHUB_CLIENT_ID="your-github-oauth-client-id" \
GITHUB_CLIENT_SECRET="your-github-oauth-client-secret" \
GITHUB_CALLBACK_URL="https://your-domain.example/auth/github/callback" \
PLOGME_DATA_API_URL="https://plogme-data.<your-subdomain>.workers.dev" \
PLOGME_DATA_SECRET="your-gateway-secret" \
PORT=8091 node index.js
```

For production, use PM2:

```bash
pm2 start index.js --name plogme
pm2 save
pm2 startup
```

Use a long random `ADMIN_PASSWORD`, HTTPS, secure reverse-proxy cookies, and keep all secrets out of Git. Configure the GitHub OAuth callback URL to exactly match `GITHUB_CALLBACK_URL`.
