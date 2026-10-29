import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Ga4ReportRequest } from "./ga4-client.js";
import { runGa4Import, type Ga4Source } from "./ga4-import.js";
import { GA4_REPORTS, type ImportedRow } from "./ga4-reports.js";

const totals = GA4_REPORTS.find((r) => r.key === "totals")!;
const pages = GA4_REPORTS.find((r) => r.key === "pages")!;

const everything = () => ({
  dimensions: new Set(["date", "pagePath"]),
  metrics: new Set(["totalUsers", "sessions", "screenPageViews", "engagedSessions", "averageSessionDuration"]),
});

describe("runGa4Import", () => {
  it("pages through a report until Google's row count is reached", async () => {
    const requests: Ga4ReportRequest[] = [];
    const source: Ga4Source = {
      metadata: async () => everything(),
      runReport: async (request) => {
        requests.push(request);
        const all = [
          { dimensions: ["20240101", "/a"], metrics: ["1", "1", "1", "0", "0"] },
          { dimensions: ["20240101", "/b"], metrics: ["1", "1", "1", "0", "0"] },
          { dimensions: ["20240102", "/a"], metrics: ["1", "1", "1", "0", "0"] },
        ];
        return { rows: all.slice(request.offset, request.offset + request.limit), rowCount: all.length };
      },
    };
    const written: ImportedRow[] = [];
    const outcome = await runGa4Import({
      source,
      startDate: "2024-01-01",
      endDate: "2024-01-02",
      write: async (rows) => void written.push(...rows),
      reports: [pages],
      pageSize: 2,
    });
    assert.deepEqual(requests.map((r) => r.offset), [0, 2]);
    assert.equal(requests[0].dimensions[0], "date");
    assert.equal(outcome.rows, 3);
    assert.equal(written.length, 3);
    // hostName is optional and this property does not offer it: rows import without it.
    assert.deepEqual(outcome.skipped, ["Pages: hostName not offered"]);
  });

  it("skips a report whose fields the property does not offer, and says which", async () => {
    let calls = 0;
    const outcome = await runGa4Import({
      source: {
        metadata: async () => ({ dimensions: new Set(["date"]), metrics: new Set(["totalUsers"]) }),
        runReport: async () => {
          calls++;
          return { rows: [], rowCount: 0 };
        },
      },
      startDate: "2024-01-01",
      endDate: "2024-01-02",
      write: async () => {},
      reports: [totals],
    });
    assert.equal(calls, 0);
    assert.deepEqual(outcome.skipped, [totals.label]);
  });

  it("stops between pages once the import is gone", async () => {
    let calls = 0;
    await runGa4Import({
      source: {
        metadata: async () => everything(),
        runReport: async () => {
          calls++;
          return { rows: [], rowCount: 0 };
        },
      },
      startDate: "2024-01-01",
      endDate: "2024-01-02",
      write: async () => {},
      shouldContinue: async () => false,
      reports: [totals, pages],
    });
    assert.equal(calls, 0);
  });

  it("reports progress after each report", async () => {
    const steps: number[] = [];
    await runGa4Import({
      source: { metadata: async () => everything(), runReport: async () => ({ rows: [], rowCount: 0 }) },
      startDate: "2024-01-01",
      endDate: "2024-01-02",
      write: async () => {},
      onProgress: async (p) => void steps.push(p.stepsDone),
      reports: [totals, pages],
    });
    assert.deepEqual(steps, [1, 2]);
  });
});
