# Security policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Email **hello@webyz.io** with "Webyz security" in the subject and a description, the steps to reproduce, and the impact you believe it has. Encrypting is not required. You will get an acknowledgement within three working days and updates as we work on it.

We ask that you give us a reasonable time to fix the problem before disclosing it, and that you do not access or modify other people's data while testing. Testing against your own self-hosted install is the safest way to investigate.

## What is in scope

- The API (`apps/api`), the tracker script, the dashboard (`apps/app`) and the marketing site (`apps/web`) in this repository.
- The hosted service run by the maintainers on this code.

Out of scope: denial of service, issues that require a compromised account or device, reports from automated scanners without a demonstrated impact, and third-party services (Paddle, Google, Resend) themselves.

## Supported versions

Webyz is in beta and moves fast. Security fixes land on `main` and in the hosted service first and are released as a patch of the latest minor version only; nothing is backported to older versions. Self-hosters should stay on the latest release and read `CHANGELOG.md` before upgrading.

## Design notes that matter for security review

- Authentication is a cookie session validated in Postgres, or a bearer API key stored as a SHA-256 hash and restricted to read-only requests. Passwords are bcrypt with cost 12.
- Visitor identity is a daily-rotating server-side hash; no cookies or storage are set on tracked sites and IP addresses are never stored.
- The client address is taken from `request.ip` under an explicit `TRUST_PROXY` setting; the server refuses to start in production without it.
- ClickHouse queries are parameterised through the client's placeholders; user input is never interpolated into SQL.
- Security headers come from `@fastify/helmet` with a deny-all CSP for the API.
