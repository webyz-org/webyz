# Webyz dashboard

The single-page dashboard: Vite, React 19, TanStack Query, Tailwind 4. Routes, feature folders and conventions are described in the root `CLAUDE.md` under "Frontend (apps/app)".

```bash
pnpm dev      # http://localhost:3041, needs the API on :3042
pnpm build    # requires VITE_API_BASE_URL and VITE_MARKETING_URL; see docs/configuration.md
pnpm lint
```

Docker image: `apps/app/Dockerfile`, a static build served by nginx. See `docs/self-hosting.md`.
