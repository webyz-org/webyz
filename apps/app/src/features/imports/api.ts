import { api, del, get, post } from "../../lib/axios";
import type { ImportConnection, SiteExport, SiteImport } from "./types";

export const listImportsApi = (siteId: string) => get<SiteImport[]>(`/websites/${siteId}/imports`);

export const getImportAuthUrlApi = (siteId: string) =>
  get<{ url: string }>(`/websites/${siteId}/imports/ga4/auth-url`);

export const getImportConnectionApi = (siteId: string) =>
  get<ImportConnection>(`/websites/${siteId}/imports/ga4/connection`);

export const discardImportConnectionApi = (siteId: string) =>
  del<{ disconnected: boolean }>(`/websites/${siteId}/imports/ga4/connection`);

export const startImportApi = (
  siteId: string,
  body: { propertyId: string; startDate?: string; endDate?: string },
) => post<SiteImport>(`/websites/${siteId}/imports`, body);

export const deleteImportApi = (siteId: string, importId: string) =>
  del<{ deleted: boolean }>(`/websites/${siteId}/imports/${importId}`);

export const startCsvImportApi = (siteId: string, body: { files: string[]; name?: string; chunks: number }) =>
  post<SiteImport>(`/websites/${siteId}/imports/csv`, body);

/** One CSV chunk as raw text: JSON would escape every quote and double the bytes. */
export const uploadCsvChunkApi = async (
  siteId: string,
  importId: string,
  file: string,
  index: number,
  csv: string,
) => {
  const res = await api.put<{ data: { rows: number; duplicate: boolean } }>(
    `/websites/${siteId}/imports/${importId}/chunks`,
    csv,
    { params: { file, index }, headers: { "Content-Type": "text/csv" } },
  );
  return res.data.data;
};

export const completeCsvImportApi = (siteId: string, importId: string) =>
  post<SiteImport>(`/websites/${siteId}/imports/${importId}/complete`);

export const getSiteExportApi = (siteId: string) => get<SiteExport | null>(`/websites/${siteId}/exports`);

export const requestSiteExportApi = (siteId: string) => post<SiteExport>(`/websites/${siteId}/exports`);

export const deleteSiteExportApi = (siteId: string, exportId: string) =>
  del<{ deleted: boolean }>(`/websites/${siteId}/exports/${exportId}`);
