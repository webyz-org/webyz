import { Environment, LogLevel, Paddle } from "@paddle/paddle-node-sdk";

import { PADDLE_API_KEY, PADDLE_ENVIRONMENT } from "../config/env.js";

let client: Paddle | null = null;

export const isPaddleConfigured = () => Boolean(PADDLE_API_KEY);

export const getPaddle = (): Paddle => {
  if (!PADDLE_API_KEY) {
    throw new Error("Paddle is not configured. Set PADDLE_API_KEY to enable billing.");
  }
  if (!client) {
    client = new Paddle(PADDLE_API_KEY, {
      environment: PADDLE_ENVIRONMENT === "sandbox" ? Environment.sandbox : Environment.production,
      logLevel: LogLevel.error,
    });
  }
  return client;
};
