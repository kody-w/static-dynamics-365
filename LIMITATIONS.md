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
- Deterministic network, timeout, malformed response, 429, 503, delay, and post-commit-loss faults.

It does not implement FetchXML, `$expand`, `$apply`, batch requests, alternate keys, navigation
properties, polymorphic activity parties, file columns, calculated or rollup columns, plug-ins,
workflows, custom APIs, auditing, security roles, business units, field security, authentication,
authorization, or the complete OData grammar. Unsupported syntax returns an error instead of being
silently ignored.

## User-interface scope

The Customer Service Hub is independently authored and focuses on representative navigation,
dashboards, grids, record forms, relationships, lifecycle commands, accessibility, and responsive
behavior. Queues and Knowledge are intentionally empty. It does not reproduce every command,
control, process flow, localization, theme, or administrative surface of a commercial application.

All virtual dates are shown in UTC. The runtime does not use real elapsed time. Advancing virtual
time can make tasks overdue and case SLA targets late, but tasks require an explicit Complete or
Cancel action.

## Compatibility statement

Microsoft, Dynamics 365, and Dataverse are trademarks of the Microsoft group of companies. This
project is unaffiliated, uses no Microsoft logos or binary assets, and is not a production
replacement. API shapes and terminology are present only for compatibility and education.
