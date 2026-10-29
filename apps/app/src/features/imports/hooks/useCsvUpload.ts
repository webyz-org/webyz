import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { completeCsvImportApi, startCsvImportApi, uploadCsvChunkApi } from "../api";
import { csvChunks, estimateChunks, type ExportFile } from "../csvFiles";

export type UploadState =
  | { phase: "idle" }
  | { phase: "uploading"; done: number; total: number; file: string }
  | { phase: "done" }
  /** `partial`: an import was created and stopped part way, so it is listed to delete. */
  | { phase: "error"; message: string; partial: boolean };

const ATTEMPTS = 3;

/** Retries a chunk on a network error or a 5xx; a 4xx is the file's fault and stops. */
const withRetry = async <T,>(fn: () => Promise<T>): Promise<T> => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const status = (error as { status?: number }).status ?? 0;
      if (attempt >= ATTEMPTS || (status >= 400 && status < 500)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
};

/**
 * Runs a CSV import upload: start the import, send every file's chunks
 * in order, finish. Lives above the panels it reports to, so a refetch of the
 * imports list (which shows the import as running) does not cut it short.
 */
export function useCsvUpload(siteId: string) {
  const qc = useQueryClient();
  const [state, setState] = useState<UploadState>({ phase: "idle" });

  const run = async (files: ExportFile[], archiveName?: string) => {
    const total = estimateChunks(files);
    setState({ phase: "uploading", done: 0, total, file: "" });
    let started = false;
    try {
      const created = await startCsvImportApi(siteId, {
        files: files.map((f) => f.name),
        name: archiveName,
        chunks: total,
      });
      started = true;
      qc.invalidateQueries({ queryKey: ["imports", siteId] });
      let done = 0;
      // Visitors first: the totals are the part people look at.
      const ordered = [...files].sort((a, b) => Number(b.report === "visitors") - Number(a.report === "visitors"));
      for (const file of ordered) {
        let index = 0;
        for await (const csv of csvChunks(file)) {
          const i = index++;
          await withRetry(() => uploadCsvChunkApi(siteId, created.id, file.name, i, csv));
          done++;
          setState({ phase: "uploading", done, total: Math.max(total, done), file: file.name });
        }
      }
      await withRetry(() => completeCsvImportApi(siteId, created.id));
      setState({ phase: "done" });
    } catch (error) {
      setState({
        phase: "error",
        message: (error as { message?: string }).message ?? "The upload failed.",
        partial: started,
      });
    } finally {
      qc.invalidateQueries({ queryKey: ["imports", siteId] });
      qc.invalidateQueries({ predicate: (q) => q.queryKey.includes(siteId) });
    }
  };

  return { state, run, reset: () => setState({ phase: "idle" }) };
}
