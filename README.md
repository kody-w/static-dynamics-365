# Static Dynamics 365

**Deterministic, zero-dependency Dataverse and Customer Service simulator.**

Static Dynamics 365 is an independently authored, browser-based environment for demos, tests,
training, and integration prototyping. It combines a high-density Customer Service Hub interface,
read-only OData-shaped JSON fixtures, and an injectable fetch-like runtime with deterministic
queries, writes, failures, retries, concurrency, virtual time, traces, export, reset, and replay.

**Live demo:** https://kody-w.github.io/static-dynamics-365/

The fictional tenant is **Aster Lane Office Systems** at
`https://crm.asterlane.example`. Every customer domain uses `.example`, phone data uses reserved
555 numbers, and all records are synthetic.

## Quickstart

Requirements are Python 3.11+ and Node.js 20+. There is nothing to install.

```sh
python3 build.py --check
python3 -m http.server --directory site 8000
```

Open <http://localhost:8000/>. Opening `site/index.html` directly is unsupported because browsers
restrict module and fixture loading from `file:` URLs.

The Pages workflow publishes exactly the `site/` directory. A repository administrator enables
GitHub Pages with **GitHub Actions** as the source once; deployments then require no application
secret.

To regenerate committed fixtures:

```sh
python3 build.py
git diff --check
```

The build uses Python's standard library, a fixed UTC epoch, UUIDv5 identifiers, canonical JSON,
content-derived weak ETags, sorted output, and no wall clock or randomness.

## Static fixture example

GitHub Pages serves collection snapshots as ordinary, read-only JSON:

```js
const response = await fetch("./api/data/v9.2/accounts.json");
const accounts = await response.json();
console.log(accounts["@odata.count"], accounts.value[0].name);
```

From a shell:

```sh
curl 'http://localhost:8000/api/data/v9.2/incidents.json'
```

Static collection files contain `@odata.context`, `@odata.count`, and `value`. Metadata and identity
fixtures are available at:

- `api/data/v9.2/$metadata.json`
- `api/data/v9.2/WhoAmI.json`

## Injected simulator examples

The runtime is an ESM module for browsers and Node.js. Inject its fetch-like method into the code
under test; do not replace global `fetch`.

### Browser (served from the `site/` root)

```js
import { createTwin } from "./twin-core.mjs";

const seed = await fetch("./data/seed.json").then((response) => response.json());
const twin = createTwin({
  seed,
  retry: { maxAttempts: 3, baseDelayMs: 250, maxDelayMs: 5_000 },
});

const created = await twin.fetch("/api/data/v9.2/accounts", {
  method: "POST",
  headers: {
    Prefer: "return=representation",
    "x-logical-request-id": "create-account-001",
  },
  body: { name: "Prairie Lantern Supply" },
});

console.log(created.status, await created.json());
console.log(twin.clock.now(), twin.stateDigest(), twin.trace);
```

### Node.js (run from the repository root)

```js
import { readFile } from "node:fs/promises";
import { createTwin } from "./site/twin-core.mjs";

const seed = JSON.parse(
  await readFile(new URL("./data/seed.json", import.meta.url), "utf8"),
);
const twin = createTwin({ seed });
const response = await twin.fetch("/api/data/v9.2/accounts?$top=1");

console.log(response.status, (await response.json()).value[0].name);
```

`createTwin()` returns a `TwinCore` instance. Its primary API is:

- `fetch(input, init)` — fetch-like response behavior with optional virtual retry policy.
- `request(input, init)` — same behavior, but throws `TwinRetryExhaustedError` on retryable HTTP
  exhaustion.
- `injectableFetch()` — a bound function suitable for dependency injection.
- `advanceTime(milliseconds)` — advances only the injected UTC clock.
- `setFaultPlan(plan)` / `clearFaults()` — configure deterministic attempt-level behavior.
- `state()` / `stateDigest()` / `contentDigest()` / `traceDigest()` — inspect canonical runtime
  state and reset-stable content.
- `reset()` / `exportRun()` / `replay(run)` — restore and reproduce a session.

## Static versus runtime boundary

| Capability | GitHub Pages JSON | Injected browser/Node runtime |
| --- | --- | --- |
| Read committed collection snapshots | Yes | Yes |
| Live `$select`, `$filter`, `$orderby`, `$top`, `$skip`, `$count` | No | Yes |
| Record GET and OData-shaped errors | No | Yes |
| POST, PATCH, DELETE | No | Yes |
| `If-Match`, ABA-safe ETags, idempotent logical requests | No | Yes |
| 429, 503, network, timeout, malformed, and post-commit-loss faults | No | Yes |
| Virtual retry/backoff and virtual UTC advancement | No | Yes |
| Append-only trace, reset, export, replay | No | Yes |

GitHub Pages cannot execute an API. A request to `accounts.json` reads a committed file; a request to
`accounts?$filter=...` is meaningful only inside `TwinCore`. Browser writes are memory-only and
disappear when the tab closes or the simulation is reset.

## Supported runtime matrix

| Area | Supported subset |
| --- | --- |
| Entities | accounts, contacts, incidents, tasks, emails, connections |
| Reads | collection and record GET; deterministic stable ordering |
| Queries | `$select`; simple typed `$filter` comparisons and `contains`, `startswith`, `endswith`; multi-field `$orderby`; `$top`; `$skip`; `$count` |
| Writes | POST, merged PATCH validation, DELETE with relationship guards |
| Concurrency | weak ETags, `If-Match`, monotonic revisions that resist ABA cycles |
| Idempotency | `x-logical-request-id` caches successful mutations by canonical request fingerprint |
| Faults | network, timeout, malformed response, 429, 503, delay, post-commit response loss |
| Time | strict offset-bearing input, fixed epoch, injected monotonic UTC clock, no wall-time sleeps |
| Reproduction | canonical SHA-256 digests, append-only event trace, export and replay |

Unsupported query grammar is rejected with a deterministic 400 response rather than ignored.

## Customer Service Hub

The independently authored interface includes:

- App launcher, global search, Quick Create, responsive sitemap, command bars, and accessible
  dialogs.
- Customer Service and Service Activity dashboards with different derived components.
- Accounts, Contacts, Cases, and combined Email/Task Activities with system views,
  display-value search, stable sorting, selection, and 50-row paging.
- Summary, Details, and Related form tabs with roving keyboard behavior, exact dirty-state
  reversion, browser Back/Forward protection, stale-ETag handling, and closed-record read-only
  behavior.
- Explicit task Complete/Cancel and case Resolve/Cancel/Reopen commands.
- Account and Contact related activities plus resolved Contact relationships.
- Truthful empty Queues, Knowledge Articles, and Knowledge Search experiences.
- Service Management pages for virtual time, fault plans, API inspection, trace, export, replay,
  reset, and the deployment-boundary disclosure.

The UI uses original CSS, safe inline SVG geometry, system fonts, and no copied product assets.

## Fixture profile

The deterministic source generates:

| Entity set | Count |
| --- | ---: |
| accounts | 12 |
| contacts | 30 |
| incidents (cases) | 24 |
| tasks | 36 |
| emails | 60 |
| connections | 40 |

Records include ownership display fields, customer and regarding lookups, reciprocal relationships,
priority and lifecycle distributions, sent and received email, open/completed/canceled tasks,
overdue tasks, active/resolved/canceled cases, explicit UTC timestamps, and content-derived ETags.
All lookup targets resolve.

## Deterministic scenarios

The API & simulation page and `runBuiltInScenario()` include:

1. Create/read/update behavior with an exact state diff.
2. Transient 503 responses followed by virtual retry.
3. Virtual-time advancement without implicit task completion.

Custom fault plans can model stale-client concurrency, rate limiting, service unavailability,
transport loss, timeout, malformed response, deterministic delay, and a response lost after commit.

## Architecture

```text
data/source.json
      │
      ▼
  build.py ─────► data/seed.json
      │          registry.json
      └────────► site/data/seed.json
                 site/api/data/v9.2/*.json

site/index.html ─► site/app.mjs ─► app-helpers.mjs
                               └► twin-core.mjs ─► browser-local state
```

The build validates source shape before writing, constructs every output in memory, validates
required fields, GUID uniqueness, UTC dates, lifecycle pairs, lookup integrity, reciprocal
connections, and source independence, then stages deterministic bytes inside the repository before
replacement.

## Repository layout

```text
.github/workflows/       CI and Pages deployment
data/                    deterministic source and generated runtime seed
site/                    deployable application root
site/api/data/v9.2/      read-only OData-shaped JSON fixtures
tests/                   Node built-in tests and Python unittest suites
build.py                 standard-library deterministic generator
manifest.json            project capability manifest
registry.json            generated output hashes, sizes, and counts
LIMITATIONS.md           explicit compatibility boundaries
SECURITY.md              security and synthetic-data policy
CONTRIBUTING.md          contribution workflow
llms.txt                 concise machine-readable project guide
```

## Validation

Run the same focused checks as CI:

```sh
python3 build.py
python3 build.py --check
node --test tests/*.test.mjs
python3 -m unittest discover -s tests -p 'test_*.py' -v
node --check site/twin-core.mjs
node --check site/app-helpers.mjs
node --check site/app.mjs
git diff --check
```

Tests cover byte-identical generation, exact fixture vectors and distributions, metadata and lookup
integrity, CRUD and malformed requests, query rejection, ETag concurrency and ABA safety,
idempotency, retries and faults, post-commit loss, virtual time, replay/reset, deletion guards, UI
helpers and lifecycle labels, history and tabs, source security contracts, project-subpath loading,
and local static HTTP smoke.

## Security and synthetic-data policy

- Strict meta CSP for directives browsers enforce from markup; external same-origin JavaScript and
  CSS only. Anti-framing requires a `Content-Security-Policy: frame-ancestors ...` HTTP response
  header from a capable host. GitHub Pages does not provide that project-controlled response
  header, so this deployment does not claim anti-framing protection.
- No telemetry, analytics, credentials, remote fonts, third-party runtime requests, database,
  backend, offline worker, or dependency installation.
- Untrusted values enter the DOM through text nodes and `textContent`; URL links accept only HTTP
  and HTTPS and use `noopener noreferrer`.
- No unsafe HTML sinks, dynamic evaluation, native alert/confirm calls, randomness, wall-clock reads,
  or locale-dependent core ordering.
- Customer names, people, email addresses, phone numbers, tenant identifiers, and record content are
  fictional. Do not submit production exports or secrets.

See [SECURITY.md](SECURITY.md) for reporting guidance.

## License and trademarks

Released under the [MIT License](LICENSE).

Microsoft, Dynamics 365, and Dataverse are trademarks of the Microsoft group of companies. This
project is not affiliated with, endorsed by, or supported by Microsoft. It is a compatibility
simulator for development and education, not a production replacement for Microsoft Dynamics 365
or Microsoft Dataverse.
