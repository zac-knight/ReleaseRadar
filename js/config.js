// Deployment settings.
//
// PROXY_URL: the address of your Cloudflare Worker (see worker/README.md), e.g.
//   'https://rr-proxy.your-name.workers.dev'
// When it's set, visitors get live TMDB data with no key of their own, and the key stays secret
// on the Worker. Leave it '' to run without a proxy (local dev with .env, or demo mode).
export const PROXY_URL = 'https://rr-proxy.zac-knight.workers.dev'
