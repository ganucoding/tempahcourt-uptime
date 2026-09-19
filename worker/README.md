# The Cloudflare Worker that actually runs the check

`src/index.js` is the live monitor. It runs on a Cloudflare Cron Trigger every
five minutes, probes `https://tempahcourt.com/up`, and sends a Telegram message
when the site stops answering.

## Why not the GitHub workflow in the repository root

Measured on 19 Sep 2026: **GitHub's cron never fired at all.** Across ~47
minutes on this public repository and ~75 minutes on the private application
repository, every single run was a manual `workflow_dispatch` — read the
`event` column, not the `conclusion`, when you check this:

    gh run list --workflow=uptime.yml --json event,createdAt

A monitor that never runs is worse than no monitor, because everyone believes
they are covered. The GitHub workflow is kept only as a probe you can fire by
hand from the Actions tab.

## Secrets

Two, both set outside this repository (Worker → Settings → Variables and
Secrets, or `wrangler secret put`):

| name | what it is |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | from `@BotFather`. A credential — never commit it. |
| `TELEGRAM_CHAT_ID` | the conversation to post into. |

⛔ **Do not add either to a `[vars]` block in `wrangler.toml`.** Vars and
secrets share one namespace, so a declared var silently overwrites the stored
secret on the next deploy.

⛔ **`account_id` in `wrangler.toml` is a placeholder on purpose.** The machine
this was built on also held a wrangler login for a *different* Cloudflare
account, and deploying to the wrong account does not error. Pin it.

## Deploying

    npx wrangler deploy

## Endpoints, for testing without an outage

| path | does |
| --- | --- |
| `/` | runs the probe now; 200 when healthy, 503 when not |
| `/test-alert` | sends a Telegram message without checking the site |
| `/chat-id` | lists chat ids the bot can see, to find `TELEGRAM_CHAT_ID` |

⚠️ These are unauthenticated on the `workers.dev` hostname. They leak nothing
but the site's own health, and `/chat-id` returns ids and names only, never
message bodies — but consider removing `/chat-id` and `/test-alert` once setup
is done.
