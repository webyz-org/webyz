import { BOT_DATACENTER_FILTER, DATACENTER_IP_LISTS, REFERRER_SPAM_LISTS } from "../config/env.js";
import { updateBotLists } from "../core/bots/list-updater.service.js";

export async function updateBotListsJob(): Promise<void | "skipped"> {
  const wantsDatacenter = BOT_DATACENTER_FILTER && DATACENTER_IP_LISTS.length > 0;
  if (!wantsDatacenter && REFERRER_SPAM_LISTS.length === 0) {
    console.log("[cron] update-bot-lists skipped: no lists configured");
    return "skipped";
  }

  console.log("[cron] update bot lists job");
  await updateBotLists();
}
