# Static and runtime API

Compatibility profile: **public-docs-subset** (source date **2026-07-12**). This is an independent,
synthetic simulator, not an official service or complete Dataverse implementation. Fields and
behaviors that could not be established without a trial are omitted or identified as simulator
policy.

## Two different surfaces

### Static snapshots

GitHub Pages serves ordinary read-only files:

```text
api/data/v9.2/$metadata.json
api/data/v9.2/WhoAmI.json
api/data/v9.2/{entity-set}.json
```

Every canonical stored entity has a collection file. A static file does not evaluate query options
and cannot run writes or actions. `registry.json` is the authoritative list of generated paths,
byte sizes, SHA-256 hashes, and collection counts.

### Injected runtime

`createTwin({ seed })` returns an in-memory `TwinCore`. Call `twin.fetch()` or inject
`twin.injectableFetch()` into code under test:

```js
const response = await twin.fetch(
  "/api/data/v9.2/opportunities?$filter=statecode%20eq%200&$orderby=estimatedvalue%20desc",
);
```

The runtime supports collection and record GET, `$select`, typed `$filter`, `$orderby`, `$top`,
`$skip`, `$count`, POST, PATCH, DELETE, ETags, deterministic logical request IDs, faults, retry,
virtual UTC, trace, reset, export, and replay. Unsupported grammar fails with a deterministic error.

## Stored entity sets

| Scope | Entity sets |
| --- | --- |
| Shared | `accounts`, `contacts`, `tasks`, `emails`, `connections`, `businessunits`, `systemusers`, `transactioncurrencies`, `uomschedules`, `uoms`, `products` |
| Customer Service | `incidents`, `incidentresolutions` |
| Sales | `pricelevels`, `productpricelevels`, `leads`, `opportunities`, `opportunityproducts`, `quotes`, `quotedetails`, `salesorders`, `salesorderdetails`, `invoices`, `invoicedetails`, `opportunitycloses` |
| Field Service | `msdyn_customerassets`, `msdyn_workorders`, `msdyn_workorderincidents`, `msdyn_workorderservicetasks`, `msdyn_workorderproducts`, `msdyn_workorderservices`, `msdyn_resourcerequirements`, `bookableresources`, `bookableresourcebookings`, `bookingstatuses`, `msdyn_workordertypes`, `msdyn_incidenttypes`, `msdyn_servicetasktypes`, `msdyn_priorities` |

`$metadata.json` declares each set's explicit logical name, key, primary name, properties, EDM
types, nullability, decimal scale, options, status pairs, lookup targets, display fields, delete
policy, mutability, app scopes, explicit active-status pairs, action bindings/outputs, navigation
declarations, and count.

Public-field subset notes: Quote uses `effectivefrom`/`effectiveto`; Order and Invoice expose no
simulated effective range. Sales detail/intersection sets without public lifecycle columns expose no
invented `statecode`/`statuscode`. Work Order uses `msdyn_servicerequest`,
`msdyn_firstarrivedon`, and `msdyn_completedon`; `msdyn_customerasset` is on Work Order, not Case.
Task and Email Regarding targets are schema-declared and app-filtered across the three apps.

## Runtime actions

Canonical action descriptors declare separate binding/source and output entity sets. The UI uses
`POST /api/data/v9.2/{binding-set}(<guid>)/Microsoft.Dynamics.CRM.{ActionName}`. The unbound
`POST /api/data/v9.2/{ActionName}` spelling remains a simulator convenience and requires the target
ID below. Send `If-Match` with the current target ETag when testing concurrency.

| Action | Binding → output | Required or common unbound payload |
| --- | --- | --- |
| `CloseIncident` | `incidents` → `incidents` | `IncidentId`; optional `Status`, `Subject`, `Description`, nonnegative `ActualDurationMinutes` |
| `QualifyLead` | `leads` → `leads` | `LeadId`; optional `CreateAccount`, `CreateContact`, `CreateOpportunity`, `AccountName`, `OpportunityName`, `PriceLevelId` |
| `DisqualifyLead` | `leads` → `leads` | `LeadId`; optional disqualification `Status` |
| `ReopenLead` | `leads` → `leads` | `LeadId` |
| `WinOpportunity`, `LoseOpportunity`, `ReopenOpportunity` | `opportunities` → `opportunities` | `OpportunityId`; close actions accept their documented optional values |
| `GenerateQuote` | `opportunities` → `quotes` | `OpportunityId`; optional `Name`, `Description`, nonnegative `FreightAmount`, `DiscountAmount` |
| `ActivateQuote`, `ReviseQuote`, `WinQuote`, `CloseQuote` | `quotes` → `quotes` | `QuoteId`; `CloseQuote` optionally accepts `Status` |
| `ConvertQuoteToSalesOrder` | `quotes` → `salesorders` | `QuoteId`; optional `Name`, `RequestDeliveryBy` |
| `CancelSalesOrder`, `FulfillSalesOrder` | `salesorders` → `salesorders` | `SalesOrderId` |
| `ConvertSalesOrderToInvoice` | `salesorders` → `invoices` | `SalesOrderId`; optional `Name`, `DueDate` |
| `MarkInvoicePaid`, `CancelInvoice` | `invoices` → `invoices` | `InvoiceId` |
| `CreateWorkOrder` | `incidents` → `msdyn_workorders` | `CaseId`; optional account, asset, reference IDs, windows, instructions |
| `ScheduleWorkOrder` | `msdyn_workorders` → `msdyn_workorders` | `WorkOrderId`, `ResourceId`, `StartTime`, `EndTime` |
| `DispatchWorkOrder`, `StartWorkOrder`, `CompleteWorkOrder`, `CancelWorkOrder`, `ReopenWorkOrder` | `msdyn_workorders` → `msdyn_workorders` | `WorkOrderId` |
| `CompleteBooking`, `CancelBooking` | `bookableresourcebookings` → `bookableresourcebookings` | `BookingId` |

Action responses are JSON with `action`, `primary`, and `created`. Compound actions validate every
change first and commit one unit of work. The same logical request ID and canonical request returns
the cached response without applying a second commit. A reused ID with a different request returns
409.

### Example: quote to order

```js
const activated = await twin.fetch(`/api/data/v9.2/quotes(${quoteId})/Microsoft.Dynamics.CRM.ActivateQuote`, {
  method: "POST",
  body: {},
});

const converted = await twin.fetch(`/api/data/v9.2/quotes(${quoteId})/Microsoft.Dynamics.CRM.ConvertQuoteToSalesOrder`, {
  method: "POST",
  headers: { "x-logical-request-id": "quote-order-001" },
  body: {},
});
```

### Example: schedule a work order

```js
const scheduled = await twin.fetch(`/api/data/v9.2/msdyn_workorders(${workOrderId})/Microsoft.Dynamics.CRM.ScheduleWorkOrder`, {
  method: "POST",
  body: {
    ResourceId: resourceId,
    StartTime: "2031-01-10T08:00:00-05:00",
    EndTime: "2031-01-10T10:00:00-05:00",
  },
});
```

The resource and primary requirement must be active, the work order must be active and unscheduled,
and the booking must be contained in the requirement window. Offsets normalize to UTC before
containment and overlap checks. Intervals are half-open: a booking ending at 15:00Z does not overlap
one beginning at 15:00Z. Virtual time advancement alone never changes status.

## Fixed-point money policy

Money and quantity fields use canonical decimal strings at their declared scale, for example
`"1299.00"`. Runtime arithmetic converts strings to integer units, multiplies without binary
floating point, and rounds half-up to the target scale.

Line writes calculate read-only `baseamount` and `extendedamount` and update parent totals in the
same unit of work. Currency must agree across price list, document, and line. Quote-to-order and
order-to-invoice conversions clone line values and lineage lookups; later catalog price changes do
not rewrite those snapshots. Money, price, tax, discount, freight, and quantity fields that cannot
be negative declare a zero minimum; derived totals cannot be negative. A header with lines cannot
change currency or price list because no atomic migration adapter is implemented. Active document
generation also requires an active matching currency and price list, coherent product prices, and
matching exchange-rate snapshots.

## Lifecycle policy

- Sales headers and lines are read-only after their editable state. Lifecycle changes require
  registered actions.
- `CloseIncident` creates an `incidentresolution`. Direct incident state PATCH remains for
  version-2 behavior compatibility.
- Work orders move through create, schedule, dispatch, service, and terminal phases. Completion
  requires no active booking and all service tasks at 100 percent.
- Resource requirements must have positive windows. Generic child CRUD validates the projected work
  order aggregate, including exactly one primary requirement and terminal-parent read-only rules.
- Completion or cancellation of a booking rolls the active work order to the modeled nonterminal
  status; only a work-order action closes it.
- Inventory, payment processing, SLA KPI records, BPF, competitor management, schedule board, GPS,
  maps, territories, warehouses, and live service calls are out of scope.

## Formats and compatibility

Schema, seed, and replay formats are version 3. Runtime exports use replay envelope version 3.
Envelope versions 1–3 are readable only when they contain a version-3 seed. A version-2 seed lacks
the canonical schema and expanded records, so the runtime rejects it explicitly and directs callers
to the archived version-2 runtime.

All timestamps require an explicit offset and normalize to canonical UTC. IDs are deterministic
UUIDv5 values. Static ETags are content-derived; runtime ETags also include monotonic revision and
reset generation, preventing ABA reuse.

The runtime validates the complete generated seed envelope. Tenant identity, epoch, schema,
actions, apps, namespace, versions, policies, metadata context, fixture chains, and schema digest
must match generated `TENANT_SCHEMA`/`TENANT_CONFIG`; `$metadata` is rebuilt authoritatively rather
than trusted from caller input.

## Write API (Issues bridge)

The read API is static; writes ride GitHub Issues. Open an issue titled
`[SD365] <anything>` whose body contains a fenced ```json command in the
`sd365-write/1.0` shape (same field names the read API serves):

```json
{
  "schema": "sd365-write/1.0",
  "operation": "create",
  "entity": "incidents",
  "record": {
    "title": "Refrigeration unit alarm on aisle 4",
    "customeridname": "Harbor Lights Grocery",
    "prioritycode": 1,
    "caseorigincode": 3,
    "casetypecode": 2,
    "statecode": 0
  }
}
```

The `write-api` workflow validates the command, mutates `data/source.json`,
reruns the deterministic build, gates on both test suites, commits, and the
Pages deploy publishes the updated collections — the write is globally
readable in about a minute. The workflow answers on the issue with a receipt
(ids, ticket number, read URL) and closes it; invalid commands are rejected
with the reason and nothing is committed.

Supported in v1: `create` for `accounts` (must embed a `primarycontact`),
`contacts`, and `incidents`; `update`/`delete` for `incidents`, addressed by
`ticketnumber` (CAS-xxxxxx). Simulator policy: the original service history
(cases paired with work orders and assets) cannot be deleted, and accounts/
contacts are create-only because their source indexes are identity. Writes
are serialized by a workflow concurrency group.
