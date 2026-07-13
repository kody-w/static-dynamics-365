# Limitations

Static Dynamics 365 is a deterministic compatibility simulator, not a hosted CRM or a complete
Dataverse implementation.

## Deployment boundary

GitHub Pages serves only committed files. The JSON under `site/api/data/v9.2/` is read-only and does
not process URL query strings, authentication, mutations, retries, or concurrency. Full behavior
runs inside the imported `TwinCore` instance in a browser tab or Node.js process.

There is no server, database, durable browser storage, offline worker, background synchronization,
or multi-user transport. Closing or reloading the page creates a fresh session.

## API scope

The runtime implements a deliberately useful subset:

- Collection and record GET.
- `$select`; simple typed `$filter` comparisons plus `contains`, `startswith`, and `endswith`.
- `$orderby`, `$top`, `$skip`, and `$count`.
- POST, PATCH, DELETE, `If-Match`, logical request idempotency, and relationship deletion guards.
- Registered atomic case-resolution, Sales lifecycle/conversion, and Field Service
  scheduling/lifecycle actions.
- Fixed-point document/line totals, conversion lineage, reverse display propagation, and dynamic
  metadata counts.
- App-aware polymorphic Task/Email Regarding lookups for the schema-declared service, Sales, asset,
  and work-order targets.
- Deterministic network, timeout, malformed response, 429, 503, delay, and post-commit-loss faults.

It does not implement FetchXML, `$expand`, `$apply`, batch requests, alternate keys, navigation
execution, full activity-party semantics, file columns, arbitrary calculated columns, plug-ins,
security roles, field security, authentication, authorization, or the complete OData grammar.
Unsupported syntax returns an error instead of being silently ignored.

The unbound action URL is a simulator convenience; canonical metadata distinguishes each action's
binding/source set from its output set. Currency or price-list migration for a document that already
has lines is not implemented, so such changes are rejected rather than partially rewriting lines.

## User-interface scope

Customer Service Hub, Sales Hub, and Field Service are independently authored and focus on
functional navigation, dashboards, grids, record forms, relationships, lifecycle commands,
accessibility, and responsive behavior. Queues and Knowledge are intentionally empty. Service
Management is tooling, not a fourth app.

There is no copied schedule board. BPF, competitor management, inventory, warehouses, territories,
precise GPS/maps, live technician tracking, payment processing, SLA KPI records, and customer
exports are deferred. The UI does not reproduce every command, control, process, localization,
theme, privilege, or administrative surface of a commercial application.

All virtual dates are shown in UTC. The runtime does not use real elapsed time. Advancing virtual
time can make tasks overdue and simulator-policy case deadlines late, but time alone never changes
task, booking, or work-order state.

Scheduling requires an active resource, an active primary requirement, an unscheduled active work
order, and full booking containment inside the positive requirement window. Half-open overlap and
terminal-child aggregate rules are explicit simulator policy where exact installed-solution
automation remains trial-dependent.

## Trial-dependent parity

No trial was available for this profile. A later trial must verify installed-solution metadata,
exact option values and privileges, action request/response details, form placement, default views,
status rollups, currency migration behavior, resource-requirement automation, and version-specific
Field Service behavior. Until then, uncertain behavior is explicit simulator policy rather than a
parity claim.

Schema, seed, and replay formats are version 3. Version-2 seeds cannot reconstruct the expanded
tenant and are rejected with a clear message; replay them with the archived version-2 runtime.

## Compatibility statement

Microsoft, Dynamics 365, and Dataverse are trademarks of the Microsoft group of companies. This
project is unaffiliated, uses no Microsoft logos or binary assets, and is not a production
replacement. API shapes and terminology are present only for compatibility and education.
