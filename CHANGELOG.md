# Changelog

All notable project changes are documented here.

## Unreleased

### Added

- One shared standalone tenant with app-prefixed Customer Service Hub, Sales Hub, and Field Service
  routes, app launcher, isolated view state, dirty-switch guards, and cross-app related data.
- Canonical version-3 `data/schema.json` driving Python generation/validation, generated JavaScript
  runtime contracts, metadata, registry, relationships, actions, and UI descriptors.
- Shared foundation plus Sales and Field Service public-documentation compatibility subsets:
  39 stored sets and 634 deterministic synthetic records.
- Atomic case-resolution, Sales lifecycle/conversion, and Field Service
  create/schedule/dispatch/service/terminal actions with fixed-point totals and replay.
- Sales Pipeline, Sales Performance, Field Service Operations, and Technician Day dashboards.
- Comprehensive fixed-point, lineage, booking-boundary, lifecycle, reverse-index, metadata,
  app-shell, and full multi-app replay tests.
- Projected-state validation for all compound actions and Field Service child writes; authoritative
  seed metadata; app-aware polymorphic activities; documented public field names; active-view
  vectors; currency/list/exchange coherence; nonnegative money; and contained requirement windows.
- Standalone Customer Service Hub with two dashboards, deterministic views, combined activities,
  record forms, relationships, lifecycle commands, accessible dialogs, responsive navigation, and
  Service Management tooling.
- Synthetic Aster Lane Office Systems fixture with six coherent entity sets.
- Standard-library deterministic build, canonical registry, static OData-shaped collections,
  metadata, and identity fixture.
- Injectable browser/Node runtime with strict queries, CRUD, concurrency, ABA-safe ETags,
  idempotency, deterministic faults and retries, virtual UTC time, trace, reset, export, and replay.
- Node built-in tests, Python unittest suites, static HTTP smoke, CI, and GitHub Pages deployment.
- Security, limitations, contribution, architecture, and machine-readable project documentation.
