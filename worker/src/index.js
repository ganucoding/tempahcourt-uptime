/**
 * External uptime probe for tempahcourt.com, alerting to Telegram.
 *
 * Everything else that watches that application runs ON its droplet: the alert
 * rail, ops:health, the scheduler. If the droplet dies they all die with it and
 * nobody is told, which is the one outage a monitor exists to catch. This runs
 * on Cloudflare's network instead, so it survives the thing it watches.
 *
 * It is not in GitHub Actions because, measured on 19 Sep 2026, GitHub's cron
 * never fired at all -- every run in either repository was a manual
 * workflow_dispatch -- and when it does fire it bills a minimum of one minute
 * per job, which on a five-minute schedule is ~288 minutes a day.
 *
 * /up is not a static route. The listener registered in the application makes
 * it run `select 1` against MySQL and write to the cache, so a 200 carrying
 * "Application up" means the app, the database and Redis are all alive.
 * Asserting on that STRING rather than on the status code is deliberate:
 * Cloudflare, a catch-all route or a parked page will all answer 200 for a site
 * that is not actually serving.
 */

const TARGET = "https://tempahcourt.com/up";
const NEEDLE = "Application up";

// Dedupe key. Uses this Worker's own hostname so it is a URL the account owns.
const ALERT_KEY = "https://tempahcourt-uptime.sportifyincorporated.workers.dev/__alerted";

// At most one "it is down" message per hour while an outage continues. A
// monitor that pings every five minutes is a monitor somebody mutes.
const ALERT_TTL_SECONDS = 3600;

async function probeOnce() {
  try {
    const res = await fetch(TARGET, {
      headers: { "cache-control": "no-cache" },
      cf: { cacheTtl: 0, cacheEverything: false },
      signal: AbortSignal.timeout(20000),
    });
    const body = await res.text();
    return { ok: res.status === 200 && body.includes(NEEDLE), status: res.status, found: body.includes(NEEDLE) };
  } catch (err) {
    return { ok: false, status: 0, found: false, error: String(err) };
  }
}

// Three attempts over ~30s. One dropped packet is not an outage.
async function probe() {
  let last = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    last = await probeOnce();
    if (last.ok) return Object.assign({}, last, { attempts: attempt });
    if (attempt < 3) await new Promise((r) => setTimeout(r, 15000));
  }
  return Object.assign({}, last, { attempts: 3 });
}

/**
 * Sends a Telegram message. Throws on failure, so a broken alert path shows up
 * in the Worker's own logs instead of failing silently -- an alerting rail that
 * fails quietly is worse than none.
 */
async function tell(env, text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    throw new Error("TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not set on this Worker");
  }
  const res = await fetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/sendMessage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_CHAT_ID,
      text: text,
      disable_web_page_preview: true,
    }),
  });
  const payload = await res.text();
  if (!res.ok) {
    throw new Error("Telegram refused the message: HTTP " + res.status + " " + payload);
  }
  return payload;
}

export default {
  async scheduled(event, env, ctx) {
    const result = await probe();
    const cache = caches.default;
    const key = new Request(ALERT_KEY);
    const alreadyAlerted = await cache.match(key);
    const when = new Date().toISOString();

    if (!result.ok) {
      console.log("DOWN " + JSON.stringify(result));
      if (!alreadyAlerted) {
        await tell(
          env,
          [
            "⚠️ tempahcourt.com is not answering.",
            "",
            "No HTTP 200 carrying \"" + NEEDLE + "\" from " + TARGET,
            "in three attempts over about 30 seconds.",
            "",
            "Last attempt: HTTP " + result.status + ", needle found: " + result.found,
            result.error ? "Error: " + result.error : "",
            "Checked at " + when + " (UTC).",
            "",
            "This probe runs on Cloudflare, not on the droplet, so it still",
            "works when the server itself is down. You will not get another of",
            "these for an hour, and you will get a message when it recovers.",
          ].join("\n")
        );
        await cache.put(
          key,
          new Response("1", { headers: { "Cache-Control": "max-age=" + ALERT_TTL_SECONDS } })
        );
      }
      return;
    }

    console.log("UP " + JSON.stringify(result));
    if (alreadyAlerted) {
      await tell(env, "✅ tempahcourt.com is answering again, HTTP 200 with \"" + NEEDLE + "\".\nRecovered at " + when + " (UTC).");
      await cache.delete(key);
    }
  },

  /**
   * Manual probe, so the check and the alert path can each be exercised without
   * waiting for the cron or taking the site down.
   *   /            -> run the probe, 200 when healthy and 503 when not
   *   /test-alert  -> send a Telegram message, without checking the site
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/test-alert") {
      try {
        await tell(env, "🔔 Test from the tempahcourt.com uptime probe. The site was not checked; this only proves the alert path works.");
        return new Response("telegram message sent\n", { status: 200 });
      } catch (err) {
        return new Response(String(err) + "\n", { status: 500 });
      }
    }

    if (url.pathname === "/chat-id") {
      if (!env.TELEGRAM_BOT_TOKEN) {
        return new Response("TELEGRAM_BOT_TOKEN is not set yet\n", { status: 400 });
      }
      const res = await fetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/getUpdates");
      const data = await res.json();
      // Only ids and names -- never message bodies.
      const chats = (data.result || [])
        .map((u) => (u.message && u.message.chat) || (u.channel_post && u.channel_post.chat))
        .filter(Boolean)
        .map((c) => ({ id: c.id, type: c.type, name: c.title || c.first_name || c.username || null }));
      const unique = Array.from(new Map(chats.map((c) => [c.id, c])).values());
      return new Response(JSON.stringify({ chats: unique, hint: unique.length ? "set TELEGRAM_CHAT_ID to one of these ids" : "send your bot a message first, then reload" }, null, 2) + "\n", {
        headers: { "content-type": "application/json" },
      });
    }

    const result = await probe();
    return new Response(JSON.stringify(result, null, 2) + "\n", {
      status: result.ok ? 200 : 503,
      headers: { "content-type": "application/json" },
    });
  },
};
