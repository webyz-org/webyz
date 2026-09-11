import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client.js";
import {
  BILLING_CONFIG,
  PLAN_CATALOG,
  planRowFromCatalog,
  validateCatalog,
} from "../src/core/billing/catalog/index.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

/**
 * Copies the plan catalog into the `plans` table. The catalog
 * (src/core/billing/catalog/plans.config.ts) is the only place plan numbers are
 * written; this file must not carry any of its own.
 *
 * Provider price ids are never touched here: they are environment specific and
 * are set by hand or by a provisioning script.
 */
async function main() {
  const problems = validateCatalog();
  if (problems.length) {
    for (const p of problems) console.error(`[seed] catalog: ${p}`);
    throw new Error("plan catalog is invalid");
  }

  if (!BILLING_CONFIG.pricingFinal) {
    console.warn(
      "[seed] PRICING IS PLACEHOLDER. Set BILLING_CONFIG.pricingFinal once unit economics are approved.",
    );
  }

  const seededCodes = new Set<string>();

  for (const [index, def] of PLAN_CATALOG.entries()) {
    const row = planRowFromCatalog(def, index);
    seededCodes.add(row.code);

    await prisma.plan.upsert({
      where: { code: row.code },
      update: row,
      create: row,
    });
    console.log(`[seed] plan ${row.code} (${row.name})`);
  }

  // Plans that left the catalog are retired, not deleted: subscriptions may
  // still reference them and their history must stay intact.
  const retired = await prisma.plan.updateMany({
    where: { code: { notIn: [...seededCodes] }, isActive: true },
    data: { isActive: false, isPublic: false },
  });
  if (retired.count) console.log(`[seed] retired ${retired.count} plan(s) no longer in the catalog`);

  const total = await prisma.plan.count({ where: { isActive: true } });
  console.log(`[seed] done, ${total} active plans`);
}

main()
  .catch((err) => {
    console.error("[seed] failed", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
