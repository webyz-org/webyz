import type { FastifyInstance } from "fastify";

/**
 * Health endpoints for load balancers, orchestrators and uptime monitors.
 *
 *  - GET /health        liveness: the process is up and serving. Always 200.
 *  - GET /health/ready  readiness: Postgres, ClickHouse and Redis answer
 *                       within the timeout. 200 when all do, 503 otherwise,
 *                       with one line per dependency so an operator can see
 *                       which one is down. Error text is included outside
 *                       production only.
 *
 * Registered at the root and under /api (see app.ts) because probes default
 * to /health while everything else here lives under /api. Both are exempt
 * from the rate limiter: a probe every few seconds from several checkers
 * must never be throttled into a false alarm.
 */

const CHECK_TIMEOUT_MS = 2_000;

type Check = { name: string; ok: boolean; ms: number; error?: string };

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => (clearTimeout(timer), resolve(value)),
      (err) => (clearTimeout(timer), reject(err)),
    );
  });

const runCheck = async (name: string, fn: () => Promise<unknown>): Promise<Check> => {
  const started = Date.now();
  try {
    await withTimeout(fn(), CHECK_TIMEOUT_MS);
    return { name, ok: true, ms: Date.now() - started };
  } catch (err) {
    return { name, ok: false, ms: Date.now() - started, error: (err as Error)?.message ?? String(err) };
  }
};

export default async function healthRoutes(fastify: FastifyInstance) {
  const noLimit = { config: { rateLimit: false as const } };

  fastify.get("/health", noLimit, async (_request, reply) => {
    return reply.header("Cache-Control", "no-store").send({ status: "ok" });
  });

  fastify.get("/health/ready", noLimit, async (_request, reply) => {
    const checks = await Promise.all([
      runCheck("postgres", () => fastify.prisma.$queryRaw`SELECT 1`),
      runCheck("clickhouse", async () => {
        const result = await fastify.clickhouse.ping();
        if (!result.success) throw new Error("ping failed");
      }),
      runCheck("redis", () => fastify.redis.ping()),
    ]);

    const ok = checks.every((c) => c.ok);
    const isProd = process.env.NODE_ENV === "production";

    return reply
      .code(ok ? 200 : 503)
      .header("Cache-Control", "no-store")
      .send({
        status: ok ? "ok" : "degraded",
        checks: checks.map((c) => (isProd ? { name: c.name, ok: c.ok, ms: c.ms } : c)),
      });
  });
}
