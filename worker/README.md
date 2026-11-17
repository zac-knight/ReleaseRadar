# TMDB proxy (Cloudflare Worker)

Keeps your TMDB API key secret: the site calls this Worker, the Worker adds the key and talks to TMDB.

```bash
cd worker
npx wrangler login                    # opens the browser to sign in to Cloudflare (free account)
npx wrangler deploy                   # prints your Worker URL, e.g. https://rr-proxy.<you>.workers.dev
npx wrangler secret put TMDB_API_KEY  # paste your TMDB key when asked (stored encrypted, never in git)
```

Then put the Worker URL in `js/config.js` (`PROXY_URL`), commit and push.

Test it (should return JSON; the key never appears in the request):
`curl "https://rr-proxy.<you>.workers.dev/3/configuration"`

Safeguards: GET only, an allowlist of TMDB paths, an origin allowlist (`ALLOWED_ORIGINS`), one-hour edge caching.
Because the Worker URL is public, also add a rate-limiting rule in the Cloudflare dashboard (Security → WAF → Rate limiting)
and keep an eye on usage (Workers & Pages → rr-proxy → Metrics).
