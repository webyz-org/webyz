const recipients = {
  type: "array",
  items: { type: "string", minLength: 3, maxLength: 254 },
  minItems: 1,
  maxItems: 10,
};

export const notificationSiteParamsSchema = {
  type: "object",
  properties: { siteId: { type: "string", minLength: 1 } },
  required: ["siteId"],
};

export const reportParamsSchema = {
  type: "object",
  properties: {
    siteId: { type: "string", minLength: 1 },
    frequency: { type: "string", enum: ["weekly", "monthly"] },
  },
  required: ["siteId", "frequency"],
};

export const reportBodySchema = {
  type: "object",
  properties: { recipients },
  required: ["recipients"],
  additionalProperties: false,
};

export const alertBodySchema = {
  type: "object",
  properties: {
    threshold: { type: "integer", minimum: 1, maximum: 1_000_000 },
    recipients,
  },
  required: ["threshold", "recipients"],
  additionalProperties: false,
};
