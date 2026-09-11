import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";

import { createRedisClient } from "./redis-client.js";

/**
 * Both tests use real sockets, no mocks: the point is how ioredis behaves
 * under the options we ship when Redis is not there or not answering. A
 * command must reject quickly so the `catch` fallbacks throughout the code
 * actually run; the previous configuration let it wait forever.
 */

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });

const rejectsWithin = async (promise: Promise<unknown>, ms: number) => {
  const started = Date.now();
  await assert.rejects(promise);
  const took = Date.now() - started;
  assert.ok(took < ms, `rejected after ${took}ms, expected under ${ms}ms`);
};

test("a command against an unreachable Redis rejects at once instead of queueing", async () => {
  const port = await freePort();
  const client = createRedisClient({ host: "127.0.0.1", port }, { commandTimeout: 500 });
  client.on("error", () => {}); // connection refusals are expected here
  try {
    await rejectsWithin(client.get("k"), 400);
  } finally {
    client.disconnect();
  }
});

test("a command against a Redis that accepts the socket but never answers rejects within the command timeout", async () => {
  // A server that accepts and stays silent: the connection is up, the
  // handshake (INFO from the ready check) never completes.
  const sockets = new Set<net.Socket>();
  const silent = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
  const { port } = silent.address() as net.AddressInfo;
  const client = createRedisClient({ host: "127.0.0.1", port }, { commandTimeout: 300 });
  client.on("error", () => {});
  try {
    // Give the socket time to connect so the command is not refused for being
    // issued before the connection attempt.
    await new Promise((r) => setTimeout(r, 100));
    await rejectsWithin(client.get("k"), 1_000);
  } finally {
    client.disconnect();
    for (const socket of sockets) socket.destroy(); // close() waits for open sockets otherwise
    await new Promise<void>((resolve) => silent.close(() => resolve()));
  }
});
