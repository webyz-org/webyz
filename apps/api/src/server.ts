import Fastify from "fastify";
import closeWithGrace from "close-with-grace";

import serviceApp from "./app.js";
import { IS_PROD, LOG_LEVEL, PORT, TRUST_PROXY } from "./config/env.js";

// One-line logger in development for readability; structured JSON in production
// so log shippers can parse it. pino-pretty is deliberately not used: it was
// referenced here before but was never a dependency, which broke boot.
// Credentials never reach the log, in any environment.
const redact = ["req.headers.authorization", "req.headers.cookie", "res.headers['set-cookie']"];
const loggerOptions = IS_PROD
  ? { level: LOG_LEVEL, redact }
  : {
      level: LOG_LEVEL,
      redact,
      transport: { target: "@fastify/one-line-logger" },
    };

const app = Fastify({
  logger: loggerOptions,
  // The default request log line carries the full URL (visitor page URLs on
  // /track, the authorization code on the OAuth callback) and the client IP.
  // app.ts logs a route-pattern line instead.
  disableRequestLogging: true,
  // Never `true`: that believes the leftmost X-Forwarded-For, which a client
  // writes. TRUST_PROXY names the hops or addresses that may set it.
  trustProxy: TRUST_PROXY,
  ajv: {
    customOptions: {
      coerceTypes: "array",
      removeAdditional: "all",
    },
  },
});

const startServer = async () => {
  await app.register(serviceApp);

  closeWithGrace(
    { delay: Number(process.env.FASTIFY_CLOSE_GRACE_DELAY) || 500 },
    async ({ err }) => {
      if (err != null) app.log.error(err);
      await app.close();
    },
  );

  await app.ready();

  try {
    await app.listen({ port: PORT, host: "0.0.0.0" });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

startServer();
