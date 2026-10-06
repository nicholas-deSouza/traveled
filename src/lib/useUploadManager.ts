import { createContext, useContext, type RefCallback } from 'react';
import type { createUploadManager } from './uploads/manager';

export type UploadManager = ReturnType<typeof createUploadManager>;
export const UploadManagerContext = createContext<UploadManager | null>(null);
export const UploadQueuePlacementContext = createContext<RefCallback<HTMLDivElement> | null>(null);
export function useUploadQueuePlacement() { return useContext(UploadQueuePlacementContext); }
export function useUploadManager() {
  const manager = useContext(UploadManagerContext);
  if (!manager) throw new Error('The photo upload manager requires a signed-in account.');
  return manager;
}
