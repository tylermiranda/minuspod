import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getEpisode } from '../api/feeds';
import { getProcessingStatus } from '../api/status';
import { getStageLabel } from '../utils/processingStage';
import {
  ensureNotificationPermission,
  startCompletionAlert,
  stopActiveCompletionAlert,
} from '../utils/completionAlert';

export type RecutWatchPhase =
  | 'idle'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed';

export interface EpisodeRecutWatchState {
  phase: RecutWatchPhase;
  stageLabel: string | null;
  progress: number;
  watching: boolean;
  startWatching: () => void;
  stopWatching: () => void;
  dismissCompletion: () => void;
}

const POLL_MS = 2000;

function episodeMatches(slug: string, episodeId: string, s: string, e: string): boolean {
  return s === slug && e === episodeId;
}

export function useEpisodeRecutWatch(
  slug: string,
  episodeId: string,
  episodeTitle: string,
): EpisodeRecutWatchState {
  const queryClient = useQueryClient();
  const [watching, setWatching] = useState(false);
  const [phase, setPhase] = useState<RecutWatchPhase>('idle');
  const [stageLabel, setStageLabel] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const sawActivityRef = useRef(false);
  const completionAlertRef = useRef<ReturnType<typeof startCompletionAlert> | null>(null);

  const { data: status } = useQuery({
    queryKey: ['processing-status'],
    queryFn: getProcessingStatus,
    enabled: watching,
    refetchInterval: watching ? POLL_MS : false,
  });

  const { data: episode } = useQuery({
    queryKey: ['episode', slug, episodeId],
    queryFn: () => getEpisode(slug, episodeId),
    enabled: watching && !!slug && !!episodeId,
    refetchInterval: watching ? POLL_MS : false,
  });

  const finishSuccess = useCallback(() => {
    setPhase('completed');
    setWatching(false);
    setStageLabel(null);
    setProgress(100);
    void queryClient.invalidateQueries({ queryKey: ['episode', slug, episodeId] });
    void queryClient.invalidateQueries({ queryKey: ['originalSegments', slug, episodeId] });
    void queryClient.invalidateQueries({ queryKey: ['episodes', slug] });
    completionAlertRef.current = startCompletionAlert({
      title: 'MinusPod — recut complete',
      body: `"${episodeTitle}" — processed audio is updated.`,
      blinkTitle: 'Recut complete',
      tag: `minuspod-recut-${slug}-${episodeId}`,
    });
  }, [queryClient, slug, episodeId, episodeTitle]);

  const finishFailure = useCallback(() => {
    setPhase('failed');
    setWatching(false);
    setStageLabel(null);
    setProgress(0);
    void queryClient.invalidateQueries({ queryKey: ['episode', slug, episodeId] });
  }, [queryClient, slug, episodeId]);

  useEffect(() => {
    if (!watching) return;

    const job = status?.currentJob ?? null;
    const isCurrentJob = job
      ? episodeMatches(slug, episodeId, job.slug, job.episodeId)
      : false;
    const isQueued = (status?.queuedEpisodes ?? []).some(
      (row) => episodeMatches(slug, episodeId, row.slug, row.episodeId),
    );
    const epStatus = episode?.status;

    if (isCurrentJob || isQueued || epStatus === 'processing' || epStatus === 'pending') {
      sawActivityRef.current = true;
    }

    if (isCurrentJob && job) {
      setPhase('processing');
      setStageLabel(getStageLabel(job.stage));
      setProgress(Math.max(0, Math.min(100, job.progress)));
      return;
    }

    if (isQueued) {
      setPhase('queued');
      setStageLabel('Queued');
      setProgress(0);
      return;
    }

    if (epStatus === 'processing' || epStatus === 'pending') {
      setPhase('processing');
      if (!isCurrentJob) {
        setStageLabel((prev) => prev ?? 'Processing');
      }
      return;
    }

    if (sawActivityRef.current && epStatus === 'completed') {
      finishSuccess();
      return;
    }

    if (
      sawActivityRef.current
      && (epStatus === 'failed' || epStatus === 'permanently_failed')
    ) {
      finishFailure();
    }
  }, [watching, status, episode, slug, episodeId, finishSuccess, finishFailure]);

  useEffect(() => () => {
    stopActiveCompletionAlert();
  }, []);

  const startWatching = useCallback(() => {
    sawActivityRef.current = false;
    completionAlertRef.current?.stop();
    completionAlertRef.current = null;
    setWatching(true);
    setPhase('queued');
    setStageLabel('Starting…');
    setProgress(0);
    void ensureNotificationPermission();
  }, []);

  const stopWatching = useCallback(() => {
    setWatching(false);
    setPhase('idle');
    setStageLabel(null);
    setProgress(0);
    sawActivityRef.current = false;
  }, []);

  const dismissCompletion = useCallback(() => {
    completionAlertRef.current?.stop();
    completionAlertRef.current = null;
    if (phase === 'completed' || phase === 'failed') {
      setPhase('idle');
    }
  }, [phase]);

  return {
    phase,
    stageLabel,
    progress,
    watching,
    startWatching,
    stopWatching,
    dismissCompletion,
  };
}
