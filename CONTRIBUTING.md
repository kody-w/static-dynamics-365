# Contributing

Contributions that improve deterministic behavior, fixture coherence, accessibility, documentation,
or standards-compatible API shape are welcome.

## Development setup

Use Python 3.11+ and Node.js 20+. The project intentionally has no dependency manifest or install
step.

```sh
python3 build.py --check
python3 -m http.server --directory site 8000
```

## Change workflow

1. Edit deterministic source in `data/source.json` or implementation files under `site/`.
2. Run `python3 build.py` after source or generator changes.
3. Review generated fixture, metadata, identity, and registry changes.
4. Add focused Node or Python tests for behavior changes.
5. Run the complete validation commands from README.

Build logic must use Python's standard library, the injected epoch, stable sorting, canonical JSON,
and content-derived identifiers. Do not introduce wall-clock input or randomness.

## Data rules

All sample data must remain fictional. Use `.example` domains and reserved 555 phone numbers. Every
lookup must resolve, state/status combinations must be valid, datetimes must include explicit
offsets, and relationship rows must remain reciprocal. Never submit real personal data, tenant
exports, credentials, or private URLs.

## Browser rules

Keep the strict CSP and same-origin, zero-dependency runtime. Use DOM text APIs for untrusted values,
safe URL allowlisting, accessible dialogs, visible focus, keyboard semantics, and reduced-motion
support. Do not add unsafe HTML sinks, inline handlers or styles, dynamic evaluation, telemetry,
third-party requests, an offline worker, a server, or a database.

## Pull requests

Keep changes focused and explain the behavior and validation performed. Generated files must match
`python3 build.py --check`, and all tests must pass.
