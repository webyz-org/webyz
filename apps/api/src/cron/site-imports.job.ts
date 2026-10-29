import { processPendingImports } from "../core/imports/imports.service.js";
import { failStaleCsvImports } from "../core/imports/csv-import.service.js";
import { cleanupSiteExports } from "../core/imports/site-export.service.js";
import { clickhouse } from "../lib/clickhouse.js";
import prisma from "../lib/prisma.js";
import { redis } from "../lib/redis.js";

/**
 * Every minute: run queued GA4 imports and resume any a restart abandoned,
 * fail CSV uploads that stopped arriving, and delete expired exports.
 */
export async function siteImportsJob() {
  const ctx = { prisma, clickhouse, redis };
  const results = await processPendingImports(ctx);
  const abandoned = await failStaleCsvImports(ctx);
  const exports = await cleanupSiteExports(ctx);
  if (results.length || abandoned || exports.expired || exports.stale || exports.orphans) {
    console.log(`[site-imports] ${results.join(", ")} abandoned uploads: ${abandoned}, exports: ${JSON.stringify(exports)}`);
  }
}
