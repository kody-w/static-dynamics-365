# Security Policy

## Reporting a vulnerability

Please use the repository's private security advisory feature. Include the affected path, a minimal
reproduction, impact, and any suggested mitigation. Do not include credentials, production tenant
exports, customer records, or other sensitive data.

Public issues are appropriate for non-sensitive defects only.

## Security model

This project is a static site with an in-memory injected runtime:

- No backend, database, authentication, durable browser storage, telemetry, analytics, or
  third-party runtime requests.
- A strict meta Content Security Policy limits scripts, styles, connections, images, objects, base
  URLs, forms, fonts, and workers.
- Anti-framing is not enforced by this GitHub Pages deployment. Browsers ignore `frame-ancestors`
  in a meta policy; it must be sent as an HTTP `Content-Security-Policy` response header by a host
  that supports custom headers.
- JavaScript and CSS are external same-origin files. Markup has no inline event handlers or styles.
- Record values are rendered with DOM text APIs. The application does not use unsafe HTML sinks or
  dynamic code evaluation.
- External record links accept only HTTP and HTTPS and open with `noopener noreferrer`.
- The simulator is imported explicitly and does not replace global network APIs.
- Customer Service, Sales, and Field Service share one in-memory tenant; there are no live Microsoft
  calls, payment data, customer exports, precise GPS/maps, or technician tracking.
- The normal shell persistently identifies the project as an independent simulator with synthetic
  data.

The static fixtures are public by design. They contain only fictional `.example` addresses, reserved
555 phone numbers, deterministic identifiers, and synthetic business content. Never add real
personal data, credentials, access tokens, tenant exports, private endpoints, or customer material.

## Supported code

Security fixes target the current default branch. Deterministic generation and source-contract tests
must pass before deployment.
