# Static Dynamics 365

**Deterministic, zero-dependency, standalone Customer Service, Sales, and Field Service tenant.**

Static Dynamics 365 is an independently authored, browser-based environment for demos, tests,
training, and integration prototyping. One shared Aster Lane Office Systems instance contains
Customer Service Hub, Sales Hub, and Field Service. The apps share customers, products, activities,
owners, currencies, virtual time, faults, trace, writes, history, reset, export, and replay.

Compatibility profile: **public-docs-subset**, source date **2026-07-12**. Behavior not established
by the canonical schema or public documentation is labeled **simulator policy**. No trial was
available for this release, so this project does not claim official, complete, certified, or
drop-in parity.

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
| Sales, case-resolution, scheduling, booking, and work-order actions | No | Yes |
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
| Entities | 39 canonical shared, Customer Service, Sales, and Field Service sets; see [API.md](API.md) |
| Reads | collection and record GET; deterministic stable ordering |
| Queries | `$select`; simple typed `$filter` comparisons and `contains`, `startswith`, `endswith`; multi-field `$orderby`; `$top`; `$skip`; `$count` |
| Writes | POST, merged PATCH validation, DELETE with relationship guards |
| Concurrency | weak ETags, `If-Match`, monotonic revisions that resist ABA cycles |
| Idempotency | `x-logical-request-id` caches successful mutations by canonical request fingerprint |
| Faults | network, timeout, malformed response, 429, 503, delay, post-commit response loss |
| Time | strict offset-bearing input, fixed epoch, injected monotonic UTC clock, no wall-time sleeps |
| Reproduction | canonical SHA-256 digests, append-only event trace, export and replay |
| Money | nonnegative canonical decimal inputs, fixed-point half-up arithmetic, and nonnegative derived totals |
| Relationships | schema-driven lookups, reverse delete guards, display propagation, reciprocal connections, and line rollups |
| Actions | schema-declared binding/output contracts with projected-state atomic validation |

Unsupported query grammar is rejected with a deterministic 400 response rather than ignored.

## One tenant, three apps

The launcher switches between app-prefixed routes while retaining one `TwinCore` instance. Legacy
Customer Service hashes redirect to `#/cs/...`; current prefixes are `#/cs/...`, `#/sales/...`, and
`#/field/...`. Dirty forms guard app switching and browser history. Dashboard and grid state are
isolated per app.

### Customer Service Hub

- Customer Service and Service Activity dashboards with simulator-policy deadline labels.
- Accounts, Contacts, Cases, Activities, forms, related data, and lifecycle commands.
- `CloseIncident` atomically resolves a case and creates an `incidentresolution`; direct case PATCH
  remains only as a schema-v2 compatibility behavior.
- Service Management provides virtual time, fault plans, API inspection, trace, export, replay, and
  reset. It is tooling inside Customer Service, not a fourth business app.

### Sales Hub

- My Work, Customers, Sales, and Catalog sitemap groups.
- Leads, Opportunities, Quotes, Orders, Invoices, Products, and Price Lists with live grids, forms,
  related lines/documents/activities, and resolved lookups.
- Sales Pipeline and Sales Performance dashboards derive every value from runtime state.
- Active views use each entity's declared state/status vectors; Active Quotes means Quote state
  **Active**, not Draft.
- Product New/Quick Create exposes both default UOM and unit group; runtime also derives and
  cross-checks `defaultuomscheduleid` from the selected UOM.
- Registered actions qualify/disqualify/reopen leads; win/lose/reopen opportunities; generate,
  activate, revise, win, and close quotes; convert quote to order; cancel/fulfill orders; convert
  order to invoice; and pay/cancel invoices.
- Quote validity uses documented `effectivefrom`/`effectiveto`; Order and Invoice do not expose
  invented effective ranges, and detail/intersection sets omit unsupported lifecycle pairs.
- Conversions preserve source lineage and immutable pricing snapshots. Active matching currencies,
  price lists, product prices, and exchange-rate snapshots are enforced. Headers with lines cannot
  switch currency or price list because this release has no migration adapter. Closed records and
  lines are read-only outside actions.

### Field Service

- My Work, Customers, Service Delivery, Assets, and functional reference settings.
- Field Service Operations and Technician Day dashboards.
- Work Orders, Bookings, Customer Assets, tasks, products, requirements, cases, accounts, and service
  history are connected through standard documented fields.
- Work orders use documented `msdyn_servicerequest`, `msdyn_firstarrivedon`, and
  `msdyn_completedon` names. Customer asset remains on Work Order; Case has no simulated direct
  customer-asset extension.
- Registered actions create a work order and primary requirement, schedule with UTC half-open
  overlap protection and requirement-window containment, dispatch, start service, complete/cancel
  bookings, and complete/cancel/reopen work orders. Only active resources and active primary
  requirements can be scheduled. Generic child writes validate the projected aggregate and cannot
  mutate terminal work orders. Advancing virtual time never changes status.
- A schedule board, inventory, territories, GPS/maps, and technician tracking are deliberately not
  simulated.

The shell, SVG geometry, CSS, and text are independently authored. A persistent disclosure identifies
it as an independent simulator using synthetic data.

## Fixture profile

The deterministic seed contains **634 records across 39 stored entity sets**:

| Area | Entity sets and exact counts |
| --- | --- |
| Existing shared service | accounts 12; contacts 30; incidents 24; tasks 36; emails 60; connections 40 |
| Tenant foundation | businessunits 1; systemusers 10; transactioncurrencies 4; uomschedules 1; uoms 1; products 12; pricelevels 4; productpricelevels 48 |
| Sales | leads 24; opportunities 15; opportunityproducts 36; quotes 12; quotedetails 30; salesorders 6; salesorderdetails 15; invoices 5; invoicedetails 12; opportunitycloses 8 |
| Case fidelity | incidentresolutions 7 |
| Field Service | msdyn_customerassets 18; msdyn_workorders 15; msdyn_workorderincidents 15; msdyn_workorderservicetasks 45; msdyn_workorderproducts 20; msdyn_workorderservices 15; msdyn_resourcerequirements 15; bookableresources 4; bookableresourcebookings 13; bookingstatuses 5; msdyn_workordertypes 3; msdyn_incidenttypes 4; msdyn_servicetasktypes 6; msdyn_priorities 3 |

All lookups resolve. `WhoAmI` resolves to a stored user and business unit. Seeded semantic anchors
connect lead → opportunity → quote → order → invoice → equipment assets and case/service request →
work order → asset/requirement → booking → tasks/products. Values use reserved numbers, `.example` domains,
fixed UTC, UUIDv5 IDs, and no real people or customer data.

## Deterministic scenarios

The API & simulation page and `runBuiltInScenario()` include:

1. Create/read/update behavior with an exact state diff.
2. Transient 503 responses followed by virtual retry.
3. Virtual-time advancement without implicit task completion.

Custom fault plans can model stale-client concurrency, rate limiting, service unavailability,
transport loss, timeout, malformed response, deterministic delay, and a response lost after commit.

## Architecture

```text
data/schema.json ─┐
                  ├─► build.py ─► data/seed.json
data/source.json ─┘               registry.json
                                  site/tenant-schema.mjs
                                  site/data/{schema,seed}.json
                                  site/api/data/v9.2/*.json

site/index.html ─► site/app.mjs ─► app-helpers.mjs ─┐
                               └► twin-core.mjs ────┴─► tenant-schema.mjs
```

`data/schema.json` is the canonical declaration for entity sets, logical names, keys, primary
names, fields, EDM types, nullability, scale, options, status vectors, lookups, display fields,
delete policy, mutability, app scopes, UI descriptors, action bindings/outputs, and compatibility policy. Python
validation/generation, generated JavaScript runtime definitions, metadata, registry, and most UI
descriptors derive from it. Singular logical names are explicit and are never produced by trimming
an entity-set name.

`TwinCore` remains a generic unit of work. A schema-driven reverse index handles lookup validation,
delete guards, display-name propagation, and cross-app related data. Narrow registered adapters add
reciprocal connection behavior, fixed-point line rollups, document conversion, case resolution,
Sales lifecycle, and Field Service scheduling/lifecycle.

The generated module also exports authoritative `TENANT_CONFIG`. Runtime construction rejects any
forged seed tenant, identity, fixture chain, schema, action, app, namespace, version, policy,
metadata context, or digest. Runtime metadata is rebuilt from generated contracts and live counts.
Task and Email forms derive app-aware polymorphic Regarding targets from the schema across service,
Sales, asset, and work-order records.

Seed, schema, and replay formats are version 3. A version-3 runtime accepts replay envelope versions
1–3 only when they contain a version-3 seed. A version-2 seed is rejected with an explicit message;
it must be replayed with the archived version-2 runtime because it lacks the 33 added stored sets
and canonical schema needed to reconstruct the tenant.

## Repository layout

```text
.github/workflows/       CI and Pages deployment
data/schema.json         canonical declarative tenant schema
data/source.json         compact synthetic customer source
data/seed.json           generated version-3 runtime seed
site/                    deployable application root
site/api/data/v9.2/      read-only OData-shaped JSON fixtures
tests/                   Node built-in tests and Python unittest suites
build.py                 standard-library deterministic generator
manifest.json            project capability manifest
registry.json            generated output hashes, sizes, and counts
API.md                   static/runtime API and action reference
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
node --check site/tenant-schema.mjs
git diff --check
```

Tests cover byte-identical generation, exact fixture vectors and distributions, metadata and lookup
integrity, CRUD and malformed requests, query rejection, ETag concurrency and ABA safety,
idempotency, retries and faults, post-commit loss, virtual time, replay/reset, deletion guards, UI
helpers and lifecycle labels, history and tabs, source security contracts, project-subpath loading,
registry-driven local HTTP smoke, fixed-point totals, Sales conversion lineage, every lifecycle
family, negative and zero boundaries, metadata tampering, every action binding, 2035/default and
equivalent-offset requirement windows, seed-wide booking containment, terminal child CRUD guards,
work-order completion guards, generic cross-app activities, Product New-form save, app-prefixed
shell declarations, and full multi-app export/reset/replay.

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
