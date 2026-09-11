import axios from "axios";
import fs from "fs-extra";
import path from "path";

import {
  DATACENTER_IP_ALLOWLISTS,
  DATACENTER_IP_LISTS,
  REFERRER_SPAM_LISTS,
} from "../../config/env.js";
import { loadDatacenterList, parseRangeList } from "./datacenter-ips.js";
import { listPath, type ListName } from "./list-files.js";
import { loadReferrerSpamList, parseDomainList } from "./referrer-spam.js";

/** Anything shaped like an IPv4 or IPv6 CIDR inside a quoted JSON string. */
const JSON_CIDR = /"((?:\d{1,3}\.){3}\d{1,3}\/\d{1,2}|[0-9a-f:]*:[0-9a-f:]*\/\d{1,3})"/gi;

/**
 * Providers publish their ranges as JSON (Google's cloud.json, AWS's
 * ip-ranges.json) rather than one CIDR per line. A body that starts like
 * JSON is reduced to the CIDRs it quotes, so any such file can be a source
 * without a parser per provider; a plain-text list passes through.
 */
export const toLines = (body: string): string => {
  const trimmed = body.trimStart();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return body;
  return Array.from(trimmed.matchAll(JSON_CIDR), (m) => m[1]).join("\n");
};

/** Downloads and concatenates the lists at `urls`, reduced to one entry per line. */
const fetchLists = async (urls: string[]): Promise<string> => {
  const parts: string[] = [];
  for (const url of urls) {
    const res = await axios.get<string>(url, {
      responseType: "text",
      timeout: 2 * 60_000,
      maxContentLength: 50 * 1024 * 1024,
      headers: { Accept: "text/plain, text/csv, application/json" },
    });
    parts.push(`# ${url}\n${toLines(String(res.data))}`);
  }
  return parts.join("\n") + "\n";
};

type ListSpec = {
  name: ListName;
  label: string;
  urls: string[];
  /** Entries parsed from the text; fewer than `min` means the download was not a list. */
  count: (text: string) => number;
  min: number;
};

/**
 * Fewer entries than expected means a URL served something other than a list
 * (an error page, an empty body): the download is rejected and the file on
 * disk keeps serving, so a bad upstream day cannot switch a filter off.
 */
const SPECS: ListSpec[] = [
  {
    name: "datacenter",
    label: "Data-centre IP list",
    urls: DATACENTER_IP_LISTS,
    count: (text) => parseRangeList(text).size,
    min: 1_000,
  },
  {
    name: "datacenterAllow",
    label: "Data-centre IP allow list",
    urls: DATACENTER_IP_ALLOWLISTS,
    count: (text) => parseRangeList(text).size,
    // Apple's relay list carries hundreds of thousands of blocks; a few hundred is already wrong.
    min: 100,
  },
  {
    name: "referrerSpam",
    label: "Referrer spam list",
    urls: REFERRER_SPAM_LISTS,
    count: (text) => parseDomainList(text).size,
    min: 500,
  },
];

/** Writes next to the destination and renames, so a reader never sees a partial file. */
const install = async (spec: ListSpec): Promise<void> => {
  const text = await fetchLists(spec.urls);
  const count = spec.count(text);
  if (count < spec.min) {
    throw new Error(`${spec.label}: only ${count} entries parsed, expected at least ${spec.min}`);
  }
  const file = listPath(spec.name);
  await fs.ensureDir(path.dirname(file));
  const tmpPath = `${file}.tmp`;
  await fs.writeFile(tmpPath, text, "utf8");
  await fs.move(tmpPath, file, { overwrite: true });
  console.log(`✅ ${spec.label} updated (${count} entries)`);
};

/**
 * Refreshes every configured list and reloads the matchers. Each list is
 * independent, so one failing source does not stop the others. Returns
 * whether every configured list succeeded; the daily job only logs, the
 * image build treats false as a failed build.
 */
export const updateBotLists = async (): Promise<boolean> => {
  let ok = true;
  for (const spec of SPECS) {
    if (spec.urls.length === 0) continue;
    try {
      await install(spec);
    } catch (err) {
      ok = false;
      console.error(`${spec.label} update failed`, err);
    }
  }
  await loadDatacenterList(true);
  await loadReferrerSpamList(true);
  return ok;
};
