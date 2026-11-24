import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { discoveryApi } from '@/lib/api/discovery';
import type { PreviewRequest, RenderRequest } from '@/types';

export function useVideoMetadata(videoIdOrUrl: string | null) {
  return useQuery({
    queryKey: ['video-metadata', videoIdOrUrl],
    queryFn: () => discoveryApi.getMetadata(videoIdOrUrl!),
    enabled: !!videoIdOrUrl && videoIdOrUrl.trim().length >= 11,
    staleTime: 1000 * 60 * 10, // 10 minutes
  });
}

export function useVideoPreview(req: PreviewRequest | null) {
  return useQuery({
    queryKey: ['video-preview', req?.video_id_or_url, req?.min_duration, req?.max_duration, req?.max_clips],
    queryFn: () => discoveryApi.getPreview(req!),
    enabled: !!req?.video_id_or_url && req.video_id_or_url.trim().length >= 11,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function useTop10mTrending(limit = 15, filterMode?: string) {
  return useQuery({
    queryKey: ['trending-top10m', limit, filterMode],
    queryFn: () => discoveryApi.getTop10mTrending(limit, filterMode),
    staleTime: 1000 * 60 * 30, // 30 minutes
    gcTime: 1000 * 60 * 60, // 1 hour durable client cache
    refetchOnWindowFocus: false,
  });
}

export function useTrendingTopics(geo = 'US', limit = 15) {
  return useQuery({
    queryKey: ['trending-topics', geo, limit],
    queryFn: () => discoveryApi.getTrendingTopics(geo, limit),
    staleTime: 1000 * 60 * 30,
    gcTime: 1000 * 60 * 60,
    refetchOnWindowFocus: false,
  });
}

export function useTrendingSuggestions(query: string | null) {
  return useQuery({
    queryKey: ['trending-suggestions', query],
    queryFn: () => discoveryApi.getTrendingSuggestions(query!),
    enabled: !!query && query.trim().length > 1,
    staleTime: 1000 * 60 * 10,
  });
}

export function useRenderCandidateMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: RenderRequest) => discoveryApi.submitRender(req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['active-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['rendered-clips'] });
    },
  });
}

export function useRenderedClips(videoId?: string | null) {
  return useQuery({
    queryKey: ['rendered-clips', videoId],
    queryFn: async () => {
      if (videoId) {
        // Try project-scoped clips first
        const projectClips = await discoveryApi.getClips(`proj_${videoId}`);
        if (projectClips && projectClips.length > 0) {
          return projectClips;
        }
        // Fallback to all clips and filter by video_id or filename
        const allClips = await discoveryApi.getClips();
        const filtered = allClips.filter(
          (c: any) =>
            c.video_id === videoId ||
            c.project_id?.includes(videoId) ||
            c.filename?.includes(videoId)
        );
        if (filtered.length > 0) {
          return filtered;
        }
        return [];
      }
      return discoveryApi.getClips();
    },
    staleTime: 1000 * 10, // 10 seconds
  });
}

export function useSourceVideoInfo(videoId?: string | null) {
  return useQuery({
    queryKey: ['source-video-info', videoId],
    queryFn: () => discoveryApi.getSourceInfo(videoId!),
    enabled: !!videoId && videoId.trim().length >= 5,
    staleTime: 1000 * 60 * 5,
  });
}

export function useRegenerateCaptionMutation() {
  return useMutation({
    mutationFn: (clipId: string) => discoveryApi.regenerateCaption(clipId),
  });
}

export function useSourceTranscript(videoId?: string | null) {
  return useQuery({
    queryKey: ['source-transcript', videoId],
    queryFn: () => discoveryApi.getTranscript(videoId!),
    enabled: !!videoId && videoId.trim().length >= 5,
    staleTime: 1000 * 60 * 10,
  });
}

export function useAnalyticsSummary() {
  return useQuery({
    queryKey: ['analytics-summary'],
    queryFn: () => discoveryApi.getAnalyticsSummary(),
    staleTime: 1000 * 30,
  });
}
