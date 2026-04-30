import { tauriService } from '@/services/tauri';
import type {
  IAiWebFetchInput,
  IAiWebFetchPayload,
  IAiWebSearchInput,
  IAiWebSearchPayload,
} from '@/types/ai';

export const aiWebService = {
  search(payload: IAiWebSearchInput): Promise<IAiWebSearchPayload> {
    return tauriService.aiWebSearch(payload);
  },
  fetch(payload: IAiWebFetchInput): Promise<IAiWebFetchPayload> {
    return tauriService.aiWebFetch(payload);
  },
};
