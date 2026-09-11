/**
 * Is this error "the database is unreachable" as opposed to "the query is
 * wrong"? The ingest guard fails open on the former, because losing a
 * customer's analytics is worse than a few unbilled events, and must not fail
 * open on the latter: a bug that makes the quota lookup throw would otherwise
 * silently disable quotas for everyone.
 *
 * Connectivity, in practice: Prisma's initialisation error (no connection at
 * startup), its P1xxx request errors (P1001 unreachable, P1002 timed out,
 * P1008 operation timeout, P1017 connection closed), the Node socket codes
 * the pg driver surfaces, and pg's own "terminated" and "timeout" messages.
 */
const NET_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);

const PG_MESSAGES = /connection terminated|timeout expired|connect ECONN|the database system is (starting|shutting)|too many clients/i;

export const isConnectivityError = (err: unknown): boolean => {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; code?: unknown; message?: unknown; cause?: unknown };

  if (e.name === "PrismaClientInitializationError") return true;
  if (typeof e.code === "string") {
    if (/^P1\d{3}$/.test(e.code)) return true;
    if (NET_CODES.has(e.code)) return true;
  }
  if (typeof e.message === "string" && PG_MESSAGES.test(e.message)) return true;

  // Driver adapters wrap the socket error one level down.
  return e.cause ? isConnectivityError(e.cause) : false;
};
