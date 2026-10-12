// Load test of the public read paths (catalog, product page, home) against a running stack.
// Usage: node load.mjs [siteUrl] [apiUrl]   e.g. node load.mjs http://localhost:3100 http://localhost:4100
// Prints requests per second and latency percentiles; fails if p99 or errors exceed the budget.
import autocannon from 'autocannon';

const site = process.argv[2] ?? 'http://localhost:3000';
const api = process.argv[3] ?? 'http://localhost:4000';
const DURATION = Number(process.env.LOAD_SECONDS ?? 20);
const CONNECTIONS = Number(process.env.LOAD_CONNECTIONS ?? 50);
/** Budget for a single small server: p99 under this, no errors. */
const P99_BUDGET_MS = Number(process.env.LOAD_P99_MS ?? 1000);

const catalog = await (await fetch(`${api}/api/v1/catalog/products?limit=24`)).json();
const product = catalog.items?.[0];
if (!product) throw new Error('No public products to load-test; publish some first.');

const targets = [
  {
    name: 'API catalog (filters, 24 items)',
    url: `${api}/api/v1/catalog/products?limit=24&sort=discount`,
  },
  {
    name: 'API catalog search',
    url: `${api}/api/v1/catalog/products?q=${encodeURIComponent('кроссовки')}`,
  },
  { name: 'API product', url: `${api}/api/v1/catalog/products/${product.shortId}` },
  { name: 'Site home (SSR)', url: `${site}/` },
  { name: 'Site catalog page (SSR)', url: `${site}/catalog` },
];

let failed = false;
for (const target of targets) {
  const result = await autocannon({
    url: target.url,
    connections: CONNECTIONS,
    duration: DURATION,
    headers: { accept: target.url.startsWith(api) ? 'application/json' : 'text/html' },
  });
  const errors = result.errors + result.timeouts + (result.non2xx ?? 0);
  const p99 = result.latency.p99;
  const ok = errors === 0 && p99 <= P99_BUDGET_MS;
  if (!ok) failed = true;
  process.stdout.write(
    `${ok ? 'OK  ' : 'FAIL'} ${target.name.padEnd(32)} ${String(Math.round(result.requests.average)).padStart(6)} req/s  ` +
      `p50 ${result.latency.p50} ms  p97.5 ${result.latency.p97_5} ms  p99 ${p99} ms  errors ${errors}\n`,
  );
}
process.stdout.write(
  `\n${CONNECTIONS} connections, ${DURATION} s per target, p99 budget ${P99_BUDGET_MS} ms\n`,
);
process.exit(failed ? 1 : 0);
