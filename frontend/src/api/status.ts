import { apiRequest } from './client';

export interface ProcessingStatusJob {
  slug: string;
  episodeId: string;
  title: string;
  podcastName: string;
  stage: string;
  progress: number;
  startedAt?: number;
  elapsed: number;
  runId?: string | null;
}

export interface ProcessingStatusQueuedEpisode {
  slug: string;
  episodeId: string;
  title: string;
  podcastName: string;
  queuedAt: number;
}

export interface ProcessingStatusHold {
  queuePaused: boolean;
  holdUntil: string | null;
  holdSince?: string | null;
  offlineHeld: number;
  offlineServices: Array<{
    service: string;
    held: number;
    reachable: boolean | null;
    checkedAt?: string | null;
  }>;
}

export interface ProcessingStatusResponse {
  currentJob: ProcessingStatusJob | null;
  jobs?: ProcessingStatusJob[];
  queueLength: number;
  queuedEpisodes?: ProcessingStatusQueuedEpisode[];
  feedRefreshes?: unknown[];
  hold?: ProcessingStatusHold;
  lastUpdated?: number;
}

export type ProcessingStatus = ProcessingStatusResponse;

export async function getProcessingStatus(): Promise<ProcessingStatusResponse> {
  return apiRequest<ProcessingStatusResponse>('/status', { skipRetry: true });
}
