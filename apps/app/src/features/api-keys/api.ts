import { del, get, post } from "../../lib/axios";
import type { ApiKey, CreatedApiKey } from "./types";

export const getApiKeysApi = () => get<ApiKey[]>("/api-keys");

export const createApiKeyApi = (name: string) => post<CreatedApiKey>("/api-keys", { name });

export const revokeApiKeyApi = (keyId: string) => del<ApiKey>(`/api-keys/${keyId}`);
