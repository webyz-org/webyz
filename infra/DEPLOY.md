# Deploying Webyz

The guide is [docs/self-hosting.md](../docs/self-hosting.md). Short form:

```bash
cd infra
./setup.sh analytics.example.com   # writes .env with generated passwords
docker compose up -d               # databases, migrate, API, dashboard, Caddy with TLS
curl -s https://analytics.example.com/health/ready
```

| File | Purpose |
| --- | --- |
| `setup.sh` | Writes `.env` for a domain: generated passwords, sensible defaults, optional keys left empty. |
| `docker-compose.yml` | Postgres, ClickHouse, Redis, the one-shot migrate, the API and the dashboard. No host ports. |
| `docker-compose.override.yml` | Loaded automatically: Caddy on 80 and 443 with automatic TLS, routing one domain by path. |
| `docker-compose.expose.yml` | Alternative to the override for an existing reverse proxy: publishes the API and dashboard on `127.0.0.1`. |
| `caddy/Caddyfile` | Path routing for the bundled Caddy. |
| `reverse-proxy/nginx.conf.example` | Complete nginx configuration for the expose variant. |
| `.env` | Your configuration, gitignored. |
