import { TrackingPayload } from "../types.js";

/** Caps on custom properties per event; the schema bounds each value, this bounds the set. */
export const MAX_META_PROPS = 30;
export const MAX_META_KEY_LENGTH = 100;
export const MAX_META_VALUE_LENGTH = 500;

export const normalizeMeta = (
  payload: TrackingPayload,
): { keys: string[]; values: string[] } => {
  const keys: string[] = [];
  const values: string[] = [];

  const excludeFields = new Set([
    "t",
    "sid",
    "vid",
    "ssid",
    "pid",
    "url",
    "path",
    "ref",
    "title",
    "lang",
    "screen",
    "name",
    "new_visitor",
    "new_session",
    "ts",
  ]);

  for (const [key, value] of Object.entries(payload)) {
    if (keys.length >= MAX_META_PROPS) break;
    if (
      !excludeFields.has(key) &&
      value !== null &&
      value !== undefined &&
      value !== "" &&
      typeof value !== "object"
    ) {
      keys.push(key.slice(0, MAX_META_KEY_LENGTH));
      values.push(String(value).slice(0, MAX_META_VALUE_LENGTH));
    }
  }

  return { keys, values };
};
