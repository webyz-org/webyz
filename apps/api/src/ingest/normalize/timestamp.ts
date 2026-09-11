/**
 * When an event happened, as far as the ledger is concerned: when the server
 * received it.
 *
 * The tracker sends `ts` (seconds), and older servers wrote it verbatim. That
 * let a client decide the time of its own events: a wrong clock, a replayed
 * request or a hostile script could put events into a closed billing period,
 * beyond the retention cut, or years into the future, and one such request
 * did exactly that during the first production check. Usage is billed by the
 * hour the event carries, so the time must not be the client's to choose.
 *
 * `ts` is still accepted by the schema so old scripts keep working; it is
 * simply not used. There is no offline queue in the tracker, so nothing
 * legitimate is lost by ignoring it.
 */
export const eventTimestamp = (_clientTs: number | undefined, receivedAt: Date = new Date()): Date => receivedAt;
