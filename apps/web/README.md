# Webyz marketing site

Next.js App Router: the landing page, pricing (fetched live from the API), and the privacy and terms pages. Conventions are in the root `CLAUDE.md` under "Frontend (apps/web)".

```bash
pnpm dev      # http://localhost:3040
pnpm build    # standalone output; NEXT_PUBLIC_* values are inlined, see docs/configuration.md
pnpm lint
```

Legal pages read the operator's facts from `src/lib/legal.ts` (an individual during the beta; switch to a company there when one is registered) and set `reviewed` once a lawyer has read them. Docker image: `apps/web/Dockerfile`.
