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
  // Provider failover (#806): which targets are on their failover account
  // right now, keyed by target name ('llm-a', 'llm-b', 'transcriber').
  failover?: {
    active: string[];
    targets: Record<string, { active: boolean; source: string | null; since: string | null }>;
  };
  lastUpdated?: number;
}

export type ProcessingStatus = ProcessingStatusResponse;

export async function getProcessingStatus(): Promise<ProcessingStatusResponse> {
  return apiRequest<ProcessingStatusResponse>('/status', { skipRetry: true });
}
