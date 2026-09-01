import { apiRequest } from './client';

export interface ProcessingStatusJob {
  slug: string;
  episodeId: string;
  title: string;
  podcastName: string;
  stage: string;
  progress: number;
  startedAt: number;
  elapsed: number;
}

export interface ProcessingStatusQueuedEpisode {
  slug: string;
  episodeId: string;
  title: string;
  podcastName: string;
  queuedAt: number;
}

export interface ProcessingStatusResponse {
  currentJob: ProcessingStatusJob | null;
  queueLength: number;
  queuedEpisodes: ProcessingStatusQueuedEpisode[];
  feedRefreshes: unknown[];
  lastUpdated: number;
}

export async function getProcessingStatus(): Promise<ProcessingStatusResponse> {
  return apiRequest<ProcessingStatusResponse>('/status');
}
