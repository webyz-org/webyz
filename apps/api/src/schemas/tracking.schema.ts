import { Static, Type } from "@sinclair/typebox";

/**
 * The tracker payload, as JSON on POST or as query parameters on the pixel
 * GET. Attached to both routes in routes/v1/tracker.ts with a validator that
 * keeps unknown properties, because custom event properties travel as extra
 * top-level keys (`webyz.event("Signup", { plan: "growth" })` sends
 * `plan=growth`). Each of those is bounded here; normalizeMeta caps how many
 * are kept.
 *
 * `vid`, `ssid`, `new_visitor` and `new_session` were minted by the tracker
 * before identity moved to the server. They are accepted so cached old
 * scripts keep working, and ignored.
 */
export const trackingSchema = Type.Object(
  {
    t: Type.Union([Type.Literal("pageview"), Type.Literal("event")]),
    sid: Type.String({ minLength: 1, maxLength: 100 }),
    vid: Type.Optional(Type.String({ maxLength: 100 })),
    ssid: Type.Optional(Type.String({ maxLength: 100 })),
    pid: Type.Optional(Type.String({ maxLength: 100 })),
    url: Type.Optional(Type.String({ maxLength: 2048 })),
    path: Type.Optional(Type.String({ maxLength: 1024 })),
    ref: Type.Optional(Type.String({ maxLength: 2048 })),
    title: Type.Optional(Type.String({ maxLength: 500 })),
    lang: Type.Optional(Type.String({ maxLength: 35 })),
    screen: Type.Optional(Type.String({ maxLength: 20 })),
    ts: Type.Optional(Type.Number({ minimum: 0 })),
    new_visitor: Type.Optional(Type.Union([Type.Literal(0), Type.Literal(1)])),
    new_session: Type.Optional(Type.Union([Type.Literal(0), Type.Literal(1)])),
    name: Type.Optional(Type.String({ maxLength: 100 })),
  },
  {
    additionalProperties: Type.Union([Type.String({ maxLength: 500 }), Type.Number(), Type.Boolean()]),
  },
);

export type TrackingRequest = Static<typeof trackingSchema>;
