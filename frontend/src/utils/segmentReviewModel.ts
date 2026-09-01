import type { OriginalSegment, TranscriptWord } from '../api/feeds';
import type { AdSegment, EpisodeCorrection, EpisodeDetail } from '../api/types';

export type SegmentLabel =
  | 'content'
  | 'ad'
  | 'cut'
  | 'pending'
  | 'rejected'
  | 'kept';

export interface TimeRange {
  start: number;
  end: number;
}

export interface AppliedCutRange extends TimeRange {
  replacementDuration?: number;
}

export interface SegmentReviewRow {
  index: number;
  sequenceNum: number;
  start: number;
  end: number;
  text: string;
  words?: TranscriptWord[];
  label: SegmentLabel;
  mixed: boolean;
}

export interface SelectionBounds {
  start: number;
  end: number;
  text: string;
}

export const ADJACENT_GAP_SECONDS = 1;
export const MIN_TEXT_TEMPLATE_CHARS = 50;
const MARKER_MATCH_TOLERANCE = 0.5;

export function overlaps(aStart: number, aEnd: number, block: TimeRange): boolean {
  return aStart < block.end && aEnd > block.start;
}

export function overlapFraction(
  segStart: number,
  segEnd: number,
  block: TimeRange,
): number {
  const start = Math.max(segStart, block.start);
  const end = Math.min(segEnd, block.end);
  if (end <= start) return 0;
  return (end - start) / (segEnd - segStart);
}

export function contiguousIndexGroups(
  indexes: Set<number>,
  segments: OriginalSegment[] = [],
): number[][] {
  if (indexes.size === 0) return [];
  const sorted = [...indexes].sort((a, b) => a - b);
  const groups: number[][] = [];
  let current: number[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const next = sorted[i];
    const prevRow = segments[prev];
    const nextRow = segments[next];
    const adjacentIndex = next === prev + 1;
    const adjacentTime =
      prevRow && nextRow
        ? nextRow.start - prevRow.end <= ADJACENT_GAP_SECONDS
        : true;
    if (adjacentIndex && adjacentTime) {
      current.push(next);
    } else {
      groups.push(current);
      current = [next];
    }
  }
  groups.push(current);
  return groups;
}

export function rangeIndexes(from: number, to: number): Set<number> {
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  return new Set(Array.from({ length: end - start + 1 }, (_, i) => start + i));
}

export function snapToWords(
  start: number,
  end: number,
  segments: OriginalSegment[],
  tolerance = 0.75,
): TimeRange {
  const words = segments.flatMap((segment) => segment.words || []);
  if (!words.length) {
    return { start, end };
  }
  const startCandidates = words.filter((word) => Math.abs(word.start - start) <= tolerance);
  const endCandidates = words.filter((word) => Math.abs(word.end - end) <= tolerance);
  const snappedStart = startCandidates.length
    ? startCandidates.reduce((best, word) =>
        Math.abs(word.start - start) < Math.abs(best.start - start) ? word : best,
      ).start
    : start;
  const snappedEnd = endCandidates.length
    ? endCandidates.reduce((best, word) =>
        Math.abs(word.end - end) < Math.abs(best.end - end) ? word : best,
      ).end
    : end;
  if (snappedEnd <= snappedStart) {
    return { start, end };
  }
  return { start: snappedStart, end: snappedEnd };
}

function falsePositiveRanges(corrections: EpisodeCorrection[] | undefined): TimeRange[] {
  return (corrections ?? [])
    .filter((c) => c.correction_type === 'false_positive' && c.original_bounds)
    .map((c) => c.original_bounds!);
}

export function allEpisodeMarkers(episode: Pick<
  EpisodeDetail,
  'adMarkers' | 'pendingReviewMarkers' | 'rejectedAdMarkers' | 'keptMarkers'
>): AdSegment[] {
  return [
    ...(episode.adMarkers ?? []),
    ...(episode.pendingReviewMarkers ?? []),
    ...(episode.rejectedAdMarkers ?? []),
    ...(episode.keptMarkers ?? []),
  ];
}

function classifySegment(
  segStart: number,
  segEnd: number,
  opts: {
    appliedCuts: AppliedCutRange[];
    falsePositives: TimeRange[];
    kept: AdSegment[];
    pending: AdSegment[];
    rejected: AdSegment[];
    cutMarkers: AdSegment[];
  },
): { label: SegmentLabel; mixed: boolean } {
  const fpOverlap = opts.falsePositives.some(
    (fp) => overlapFraction(segStart, segEnd, fp) >= 0.5,
  );
  if (fpOverlap) {
    const alsoCut = opts.appliedCuts.some((c) => overlapFraction(segStart, segEnd, c) >= 0.5)
      || opts.cutMarkers.some((m) => overlapFraction(segStart, segEnd, m) >= 0.5);
    return { label: 'content', mixed: alsoCut };
  }

  const regions: Array<{ label: SegmentLabel; range: TimeRange }> = [
    ...opts.appliedCuts.map((c) => ({ label: 'cut' as const, range: c })),
    ...opts.kept.map((m) => ({ label: 'kept' as const, range: m })),
    ...opts.pending.map((m) => ({ label: 'pending' as const, range: m })),
    ...opts.rejected.map((m) => ({ label: 'rejected' as const, range: m })),
    ...opts.cutMarkers.map((m) => ({ label: 'ad' as const, range: m })),
  ];

  let primary: SegmentLabel = 'content';
  let mixed = false;
  const priority: Record<SegmentLabel, number> = {
    cut: 6,
    ad: 5,
    pending: 4,
    rejected: 3,
    kept: 2,
    content: 1,
  };

  for (const { label, range } of regions) {
    const frac = overlapFraction(segStart, segEnd, range);
    if (frac <= 0) continue;
    if (frac < 0.5 && primary !== 'content') {
      mixed = true;
      continue;
    }
    if (frac >= 0.5) {
      if (priority[label] > priority[primary]) {
        if (primary !== 'content') mixed = true;
        primary = label;
      } else if (label !== primary) {
        mixed = true;
      }
    }
  }

  if (primary === 'ad' && opts.appliedCuts.some((c) => overlaps(segStart, segEnd, c))) {
    primary = 'cut';
  }

  return { label: primary, mixed };
}

export function buildSegmentReviewRows(
  segments: OriginalSegment[],
  episode: Pick<
    EpisodeDetail,
    'adMarkers' | 'pendingReviewMarkers' | 'rejectedAdMarkers' | 'keptMarkers' | 'corrections'
  >,
  appliedCuts: AppliedCutRange[] = [],
): SegmentReviewRow[] {
  const falsePositives = falsePositiveRanges(episode.corrections);
  const opts = {
    appliedCuts,
    falsePositives,
    kept: episode.keptMarkers ?? [],
    pending: episode.pendingReviewMarkers ?? [],
    rejected: episode.rejectedAdMarkers ?? [],
    cutMarkers: episode.adMarkers ?? [],
  };

  return segments.map((segment, index) => {
    const { label, mixed } = classifySegment(segment.start, segment.end, opts);
    return {
      index,
      sequenceNum: index + 1,
      start: segment.start,
      end: segment.end,
      text: segment.text,
      words: segment.words,
      label,
      mixed,
    };
  });
}

export function concatSegmentText(rows: SegmentReviewRow[]): string {
  return rows.map((row) => row.text.trim()).filter(Boolean).join(' ').trim();
}

export function ensureMinTextTemplate(
  text: string,
  segments: OriginalSegment[],
  start: number,
  end: number,
): string {
  let out = text.trim();
  if (out.length >= MIN_TEXT_TEMPLATE_CHARS) return out;

  const inRange = segments.filter(
    (seg) => seg.end > start && seg.start < end,
  );
  out = inRange.map((s) => s.text.trim()).join(' ').trim();
  if (out.length >= MIN_TEXT_TEMPLATE_CHARS) return out;

  const startIdx = segments.findIndex((seg) => seg.end > start);
  if (startIdx >= 0) {
    for (let i = startIdx; i < segments.length && out.length < MIN_TEXT_TEMPLATE_CHARS; i += 1) {
      const piece = segments[i].text.trim();
      if (piece) out = out ? `${out} ${piece}` : piece;
    }
  }
  return out.slice(0, 512);
}

export function boundsFromSelectedIndexes(
  indexes: Set<number>,
  rows: SegmentReviewRow[],
  segments: OriginalSegment[],
): SelectionBounds[] {
  const groups = contiguousIndexGroups(indexes, segments);
  return groups.map((group) => {
    const groupRows = group.map((idx) => rows[idx]);
    const snapped = snapToWords(
      groupRows[0].start,
      groupRows[groupRows.length - 1].end,
      groupRows.map((r) => ({ start: r.start, end: r.end, text: r.text, words: r.words })),
    );
    return {
      ...snapped,
      text: concatSegmentText(groupRows),
    };
  });
}

export function boundsFromManualTimes(
  start: number,
  end: number,
  segments: OriginalSegment[],
): SelectionBounds | null {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return null;
  }
  const snapped = snapToWords(start, end, segments);
  const rows = segments
    .map((seg, index) => ({
      index,
      sequenceNum: index + 1,
      start: seg.start,
      end: seg.end,
      text: seg.text,
      words: seg.words,
      label: 'content' as const,
      mixed: false,
    }))
    .filter((row) => overlaps(row.start, row.end, snapped));
  return {
    ...snapped,
    text: concatSegmentText(rows),
  };
}

export function findOverlappingMarker(
  start: number,
  end: number,
  markers: AdSegment[],
  tolerance = MARKER_MATCH_TOLERANCE,
): AdSegment | null {
  for (const marker of markers) {
    if (
      Math.abs(marker.start - start) <= tolerance
      && Math.abs(marker.end - end) <= tolerance
    ) {
      return marker;
    }
    if (overlaps(start, end, marker)) {
      return marker;
    }
  }
  return null;
}

export function selectionOverlapsKept(
  bounds: TimeRange,
  keptMarkers: AdSegment[] | undefined,
): boolean {
  return (keptMarkers ?? []).some((m) => overlaps(bounds.start, bounds.end, m));
}

export function labelDisplay(label: SegmentLabel, mixed: boolean): string {
  if (mixed) {
    if (label === 'cut' || label === 'ad') return 'Cut (mixed)';
    if (label === 'content') return 'Content (mixed)';
  }
  switch (label) {
    case 'content': return 'Content';
    case 'ad': return 'Ad';
    case 'cut': return 'Cut';
    case 'pending': return 'Pending';
    case 'rejected': return 'Rejected';
    case 'kept': return 'Kept';
    default: return label;
  }
}

export function labelPillClass(label: SegmentLabel): string {
  switch (label) {
    case 'cut':
    case 'ad':
      return 'bg-destructive/15 text-destructive';
    case 'pending':
      return 'bg-amber-500/15 text-amber-700 dark:text-amber-300';
    case 'rejected':
      return 'bg-muted text-muted-foreground';
    case 'kept':
      return 'bg-secondary text-secondary-foreground';
    default:
      return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300';
  }
}

export function rowBackgroundClass(
  row: SegmentReviewRow,
  opts: { selected: boolean; playing: boolean },
): string {
  if (opts.playing) return 'bg-sky-500/10';
  if (opts.selected) return 'bg-indigo-500/10';
  if (row.label === 'cut' || row.label === 'ad') return 'bg-destructive/5';
  if (row.label === 'pending') return 'bg-amber-500/5';
  return '';
}
