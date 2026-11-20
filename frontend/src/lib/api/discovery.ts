import { httpClient } from './client';
import type {
  EnrichedVideoInfo,
  PreviewRequest,
  PreviewResponse,
  TrendingVideoDescriptor,
  RenderRequest,
  RenderTaskResponse,
} from '@/types';

export const discoveryApi = {
  getMetadata: async (videoIdOrUrl: string): Promise<EnrichedVideoInfo> => {
    const res = await httpClient.post<EnrichedVideoInfo>('/api/v1/metadata', {
      video_id_or_url: videoIdOrUrl,
    });
    return res.data;
  },

  getPreview: async (req: PreviewRequest): Promise<PreviewResponse> => {
    const res = await httpClient.post<PreviewResponse>('/api/v1/preview', req);
    return res.data;
  },

  getTop10mTrending: async (
    limit = 15,
    filterMode?: string
  ): Promise<TrendingVideoDescriptor[]> => {
    const res = await httpClient.get<TrendingVideoDescriptor[]>('/api/v1/trending/top10m', {
      params: { limit, filter_mode: filterMode },
    });
    return res.data;
  },

  getTrendingTopics: async (geo = 'US', limit = 15): Promise<any[]> => {
    const res = await httpClient.get<any[]>('/api/v1/trending/topics', {
      params: { geo, limit },
    });
    return res.data;
  },

  getTrendingSuggestions: async (q: string, limit = 10): Promise<any> => {
    const res = await httpClient.get<any>('/api/v1/trending/suggest', {
      params: { q, limit },
    });
    return res.data;
  },

  submitRender: async (req: RenderRequest): Promise<RenderTaskResponse> => {
    const res = await httpClient.post<RenderTaskResponse>('/api/v1/render', req);
    return res.data;
  },

  getJobStatus: async (jobId: string): Promise<any> => {
    const res = await httpClient.get<any>(`/api/v1/jobs/${jobId}`);
    return res.data;
  },

  getClips: async (projectId?: string): Promise<any[]> => {
    const res = await httpClient.get<any[]>('/api/v1/clips', {
      params: projectId ? { project_id: projectId } : {},
    });
    return res.data;
  },

  getSourceInfo: async (videoId: string): Promise<any> => {
    const res = await httpClient.get<any>(`/api/v1/source/${videoId}`);
    return res.data;
  },

  exportClip: async (req: {
    source_path: string;
    project_id: string;
    clips: Array<{
      title: string;
      start_seconds: number;
      end_seconds: number;
      aspect_ratio?: string;
      center_x?: number;
      layout_mode?: string;
      text_overlay?: string;
      text_position?: string;
    }>;
  }): Promise<any> => {
    const res = await httpClient.post<any>('/api/v1/editor/export', req);
    return res.data;
  },

  regenerateCaption: async (
    clipId: string
  ): Promise<{ caption: string; hashtags: string[] }> => {
    const res = await httpClient.post<{ caption: string; hashtags: string[] }>(
      `/api/v1/clips/${clipId}/regenerate_caption`
    );
    return res.data;
  },

  getTranscript: async (videoId: string): Promise<any> => {
    const res = await httpClient.get<any>(`/api/v1/source/${videoId}/transcript`);
    return res.data;
  },

  submitFeedback: async (feedback: {
    clip_id: string;
    rating: number;
    notes?: string;
    hook_type?: string;
    video_id?: string;
    hook_title?: string;
    duration_seconds?: number;
    score?: number;
  }): Promise<any> => {
    const res = await httpClient.post<any>('/api/v1/analytics/feedback', feedback);
    return res.data;
  },

  getAnalyticsSummary: async (): Promise<any> => {
    const res = await httpClient.get<any>('/api/v1/analytics/summary');
    return res.data;
  },
};
