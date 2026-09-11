import "dotenv/config";
import { updateBotLists } from "../src/core/bots/list-updater.service.js";

/**
 * Downloads the bot filter lists now instead of waiting for the daily job.
 * With BOT_LISTS_DIR set it writes there instead of geo/, which is how the
 * API image bakes its seed copy at build time. Exits non-zero if any list
 * failed, so a build without them fails visibly.
 */
const run = async () => {
  console.log("🛡️  Updating bot filter lists...");
  const ok = await updateBotLists();
  process.exit(ok ? 0 : 1);
};

run().catch((err) => {
  console.error("❌ Bot list update failed:", err);
  process.exit(1);
});
