# tempahcourt-uptime

An external uptime probe for [tempahcourt.com](https://tempahcourt.com), and
nothing else.

It runs every five minutes on GitHub Actions and asserts that
`https://tempahcourt.com/up` answers HTTP 200 **carrying the string
`Application up`** — not merely that it answers 200, because a CDN, a catch-all
route or a parked page will all happily return 200 for a site that is not
serving. On three consecutive failures it opens a deduplicated issue here.

## Why this is a separate, public repository

The application itself lives in a private repository. GitHub bills a minimum of
one minute per job, so a five-minute cron costs ~288 minutes a day — around
8,640 a month against the 2,000-minute monthly free tier that private
repositories share with CI. Public repositories get unmetered Actions minutes.

The probe reads a public URL and holds no secrets, so there is no reason for it
to consume a private budget the test suite needs. It lives here for that reason
alone.

## Why it is not on the server

Everything else that watches the application runs on the same droplet that
serves it. If that droplet dies, so does every watcher — which is precisely the
outage a monitor exists to catch. This one runs somewhere else.
