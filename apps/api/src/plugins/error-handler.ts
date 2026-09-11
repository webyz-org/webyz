import { FastifyError, FastifyInstance } from "fastify";

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler(async (error, request, reply) => {
    const isProd = process.env.NODE_ENV === "production";

    // App errors (expected)
    if ((error as any)?.isOperational) {
      return reply.status((error as any)?.statusCode).send({
        success: false,
        error: {
          code: (error as any).code,
          message: (error as any)?.message,
          details: isProd ? undefined : (error as any).details,
        },
      });
    }

    // Fastify validation errors
    if ((error as FastifyError).validation) {
      return reply.status(400).send({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request",
          details: isProd ? undefined : (error as FastifyError).validation,
        },
      });
    }

    // Fastify's own client errors: body too large (413), invalid JSON (400),
    // unsupported media type (415), and the like. They carry a 4xx statusCode
    // and a stable FST_ code; report them as such instead of a generic 500,
    // which hid a 20 KB tracker payload as a server fault.
    const status = (error as FastifyError).statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) {
      return reply.status(status).send({
        success: false,
        error: {
          code: (error as FastifyError).code ?? "BAD_REQUEST",
          message: (error as FastifyError).message,
        },
      });
    }

    // Unknown errors
    request.log.error(error, "Unhandled error");

    return reply.status(500).send({
      success: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Something went wrong",
      },
    });
  });
}
