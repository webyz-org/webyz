import type { Ga4ReportPage, Ga4ReportRequest } from "./ga4-client.js";
import { GA4_REPORTS, mapReportRows, type ImportedRow, type ReportSpec } from "./ga4-reports.js";

/**
 * Runs every GA4 report over a date range and hands the mapped rows to a
 * writer, page by page so memory stays flat on a large property. The Google
 * calls come in through `source`, so tests drive the whole import with a fake
 * and the job wires in the real client.
 */
export type Ga4Source = {
  metadata: () => Promise<{ dimensions: Set<string>; metrics: Set<string> }>;
  runReport: (request: Ga4ReportRequest) => Promise<Ga4ReportPage>;
};

/** Rows per runReport page; Google allows up to 250,000. */
export const GA4_PAGE_SIZE = 100_000;

export type ImportProgress = { stepsDone: number; stepsTotal: number; rows: number };

export type ImportOutcome = { rows: number; skipped: string[] };

/** Required fields of a report the property does not offer (then the report is skipped). */
export const unavailableFields = (
  spec: ReportSpec,
  metadata: { dimensions: Set<string>; metrics: Set<string> },
): string[] => [
  ...["date", ...spec.dimensions, ...(spec.filters ?? []).map((f) => f.fieldName)].filter(
    (d) => !metadata.dimensions.has(d),
  ),
  ...spec.metrics.filter((m) => !metadata.metrics.has(m)),
];

export const runGa4Import = async (input: {
  source: Ga4Source;
  startDate: string;
  endDate: string;
  write: (rows: ImportedRow[]) => Promise<void>;
  onProgress?: (progress: ImportProgress) => Promise<void>;
  /** Checked between pages; returning false stops the import (it was deleted). */
  shouldContinue?: () => Promise<boolean>;
  reports?: ReportSpec[];
  pageSize?: number;
}): Promise<ImportOutcome> => {
  const reports = input.reports ?? GA4_REPORTS;
  const pageSize = input.pageSize ?? GA4_PAGE_SIZE;
  const metadata = await input.source.metadata();
  const skipped: string[] = [];
  let rows = 0;
  let stepsDone = 0;

  for (const spec of reports) {
    if (unavailableFields(spec, metadata).length) {
      skipped.push(spec.label);
    } else {
      const optional = spec.optionalDimensions ?? [];
      const offered = optional.filter((d) => metadata.dimensions.has(d));
      if (offered.length < optional.length) {
        skipped.push(`${spec.label}: ${optional.filter((d) => !offered.includes(d)).join(", ")} not offered`);
      }
      const requested = [...spec.dimensions, ...offered];
      let offset = 0;
      for (;;) {
        if (input.shouldContinue && !(await input.shouldContinue())) return { rows, skipped };
        const page = await input.source.runReport({
          startDate: input.startDate,
          endDate: input.endDate,
          dimensions: ["date", ...requested],
          metrics: [...spec.metrics],
          filters: spec.filters,
          limit: pageSize,
          offset,
        });
        const mapped = [...mapReportRows(spec, requested, page.rows).values()];
        await input.write(mapped);
        rows += mapped.length;
        offset += page.rows.length;
        if (!page.rows.length || offset >= page.rowCount) break;
      }
    }
    stepsDone += 1;
    await input.onProgress?.({ stepsDone, stepsTotal: reports.length, rows });
  }

  return { rows, skipped };
};
