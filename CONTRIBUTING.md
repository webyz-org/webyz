# Contributing to Webyz

Thanks for looking. Webyz is small and in beta, so the most useful contributions right now are bug reports with reproductions, fixes, documentation corrections, and self-hosting improvements.

## Before you start

- Read [docs/development.md](docs/development.md) to run the project locally, and skim `CLAUDE.md` for the architecture and the conventions the code follows.
- For anything larger than a fix, open an issue first and describe the change. It avoids two people building the same thing and lets us say early if something does not fit.
- Check the open issues; if one exists, comment there rather than opening a duplicate.

## Reporting a bug

Include what you did, what you expected, what happened, and the version (a commit hash or the date you pulled). For dashboard bugs, the browser and any console errors. For ingest or numbers that look wrong, the site's timezone and the period you were looking at, because most "wrong" numbers turn out to be timezone or deduplication questions and those details settle them quickly.

Security issues go to the address in [SECURITY.md](SECURITY.md), not to the issue tracker.

## Making a change

1. Fork and branch from `main`.
2. Keep the change focused. One fix or one feature per pull request.
3. Follow the layering in the API (routes, controllers, services, database) and the existing conventions: parameterised ClickHouse SQL, `createAppError` for expected failures, snake_case Postgres columns, a new migration rather than an edited one.
4. Billing, usage metering and entitlement code must come with tests. Elsewhere tests are welcome but not yet required; say in the PR whether you added any.
5. Run `pnpm lint`, `pnpm typecheck` and, in `apps/api`, `RUN_DB_TESTS=1 pnpm test` against the local compose databases.
6. If your change alters something `CLAUDE.md` or the docs describe, update them in the same PR. Stale documentation is a bug.
7. Open the pull request with a short description of what changed and why. CI runs the same checks against fresh databases and builds the Docker images.

## Style

TypeScript throughout. Prefer clear names and small functions over comments; when a comment is needed, say why, not what. No new dependencies without a reason stated in the PR. Match the formatting of the file you are in.

## Licence

By contributing you agree that your contributions are licensed under the [AGPL-3.0](LICENSE), the same licence as the project.
