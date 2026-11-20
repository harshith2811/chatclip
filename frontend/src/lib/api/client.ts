import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { useWorkspaceStore } from '@/lib/store/workspace-store';
import type {
  MetadataRequest,
  MetadataResponse,
  PreviewRequest,
  PreviewResponse,
  RenderRequest,
  RenderTaskResponse,
  JobRecord,
  RenderedClipSummary,
  EditorFrameRequest,
  EditorFrameResponse,
  EditorWaveformRequest,
  EditorWaveformResponse,
  EditorExportRequest,
  EditorExportResponse,
  PublishChannel,
  PublishSubmitRequest,
  PublishReceiptResponse,
  SystemGovernorStatus,
  OmniPostPreflightResponse,
  OmniPostPost,
  SupoClipStatus,
  SupoClipWorkflow,
  SupoClipTemplate,
  SupoClipScoreRequest,
  SupoClipScoreResponse,
  SupoClipPlanRequest,
  SupoClipPlanResponse,
  SupoClipRenderRequest,
  SupoClipRenderResponse,
  SupoClipPresetsResponse,
} from '@/types';

export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

/**
 * Creates and configures the Axios instance.
 * Automatically injects X-Workspace-Id, X-User-Id, X-User-Role, and Authorization
 * headers from the active Zustand workspace store.
 */
function createHttpClient(): AxiosInstance {
  const instance = axios.create({
    baseURL:
      typeof window === 'undefined'
        ? process.env.INTERNAL_API_URL || process.env.FASTAPI_BACKEND_URL || 'http://localhost:8000'
        : '',
    timeout: 120000, // 2-minute timeout for processing tasks
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });

  // Request Interceptor: Injects active multi-user workspace & auth headers
  instance.interceptors.request.use((config) => {
    // Read state from Zustand store directly
    const { workspaceId, userId, userRole, apiKey, tenantKey } =
      useWorkspaceStore.getState();

    config.headers['X-Workspace-Id'] = workspaceId || 'workspace_default';
    config.headers['X-User-Id'] = userId || 'user_admin';
    config.headers['X-User-Role'] = userRole || 'admin';

    // OmniPost tenancy headers
    config.headers['x-workspace-id'] = workspaceId || 'workspace_default';
    config.headers['x-tenant-id'] = workspaceId || 'workspace_default';

    if (apiKey) {
      config.headers['Authorization'] = `Bearer ${apiKey}`;
    }
    if (tenantKey) {
      config.headers['X-Tenant-Key'] = tenantKey;
    }

    return config;
  });

  // Response Interceptor: Standardized error parsing
  instance.interceptors.response.use(
    (response: AxiosResponse) => response,
    (error) => {
      const status = error.response?.status || 500;
      const message =
        error.response?.data?.detail ||
        error.response?.data?.message ||
        error.message ||
        'Unknown API Error';
      return Promise.reject(new ApiError(status, message, error.response?.data));
    }
  );

  return instance;
}

export const httpClient = createHttpClient();

/**
 * Strongly Typed API Client Methods
 */
export const api = {
  // --- Ingestion & Studio ---
  ingest: {
    getMetadata: async (data: MetadataRequest): Promise<MetadataResponse> => {
      const res = await httpClient.post<MetadataResponse>('/api/v1/metadata', data);
      return res.data;
    },
    getPreview: async (data: PreviewRequest): Promise<PreviewResponse> => {
      const res = await httpClient.post<PreviewResponse>('/api/v1/preview', data);
      return res.data;
    },
  },

  // --- Rendering & Jobs ---
  render: {
    submit: async (data: RenderRequest): Promise<RenderTaskResponse> => {
      const res = await httpClient.post<RenderTaskResponse>('/api/v1/render', data);
      return res.data;
    },
    getStatus: async (taskId: string): Promise<RenderTaskResponse> => {
      const res = await httpClient.get<RenderTaskResponse>(`/api/v1/render/status/${taskId}`);
      return res.data;
    },
  },

  jobs: {
    get: async (jobId: string): Promise<JobRecord> => {
      const res = await httpClient.get<JobRecord>(`/api/v1/jobs/${jobId}`);
      return res.data;
    },
    cancel: async (jobId: string): Promise<{ status: string }> => {
      const res = await httpClient.post<{ status: string }>(`/api/v1/jobs/${jobId}/cancel`);
      return res.data;
    },
    getEventSourceUrl: (jobId: string): string => {
      return `/api/v1/jobs/${jobId}/stream`;
    },
  },

  // --- Clips & Media Streaming ---
  clips: {
    list: async (): Promise<RenderedClipSummary[]> => {
      const res = await httpClient.get<RenderedClipSummary[]>('/api/v1/clips');
      return res.data;
    },
    get: async (clipId: string): Promise<RenderedClipSummary> => {
      const res = await httpClient.get<RenderedClipSummary>(`/api/v1/clips/${clipId}`);
      return res.data;
    },
    getMediaPlaybackUrl: (clipId: string): string => {
      return `/api/v1/clips/${clipId}/media`;
    },
    getPosterUrl: (clipId: string): string => {
      return `/api/v1/clips/${clipId}/poster`;
    },
    regenerateCaption: async (
      clipId: string,
      data?: { tone?: string; platforms?: string[] }
    ): Promise<{ caption: string; hashtags: string[] }> => {
      const res = await httpClient.post<{ caption: string; hashtags: string[] }>(
        `/api/v1/clips/${clipId}/regenerate_caption`,
        data
      );
      return res.data;
    },
  },

  // --- Video Editor Primitives ---
  editor: {
    previewFrame: async (data: EditorFrameRequest): Promise<EditorFrameResponse> => {
      const res = await httpClient.post<EditorFrameResponse>('/api/v1/editor/preview-frame', data);
      return res.data;
    },
    waveform: async (data: EditorWaveformRequest): Promise<EditorWaveformResponse> => {
      const res = await httpClient.post<EditorWaveformResponse>('/api/v1/editor/waveform', data);
      return res.data;
    },
    export: async (data: EditorExportRequest): Promise<EditorExportResponse> => {
      const res = await httpClient.post<EditorExportResponse>('/api/v1/editor/export', data);
      return res.data;
    },
  },

  // --- Publishing & OmniPost ---
  publishing: {
    getChannels: async (): Promise<PublishChannel[]> => {
      const res = await httpClient.get<PublishChannel[]>('/api/v1/publish/channels');
      return res.data;
    },
    submit: async (data: PublishSubmitRequest): Promise<PublishReceiptResponse> => {
      const res = await httpClient.post<PublishReceiptResponse>('/api/v1/publish/submit', data);
      return res.data;
    },
    getHistory: async (): Promise<PublishReceiptResponse[]> => {
      const res = await httpClient.get<PublishReceiptResponse[]>('/api/v1/publish/history');
      return res.data;
    },
    getStatus: async (receiptId: string): Promise<PublishReceiptResponse> => {
      const res = await httpClient.get<PublishReceiptResponse>(`/api/v1/publish/status/${receiptId}`);
      return res.data;
    },
    retry: async (receiptId: string): Promise<PublishReceiptResponse> => {
      const res = await httpClient.post<PublishReceiptResponse>(`/api/v1/publish/retry/${receiptId}`);
      return res.data;
    },
  },

  // --- Direct OmniPost Proxy Endpoints ---
  omnipost: {
    preflight: async (): Promise<OmniPostPreflightResponse> => {
      const res = await httpClient.get<OmniPostPreflightResponse>('/api/omnipost/engine/preflight');
      return res.data;
    },
    getPosts: async (): Promise<OmniPostPost[]> => {
      const res = await httpClient.get<OmniPostPost[]>('/api/omnipost/posts');
      return res.data;
    },
  },

  // --- System Governance HUD ---
  governor: {
    getStatus: async (): Promise<SystemGovernorStatus> => {
      const res = await httpClient.get<SystemGovernorStatus>('/api/v1/system/governor-status');
      return res.data;
    },
  },

  // --- Projects & Archives ---
  projects: {
    list: async (): Promise<any[]> => {
      const res = await httpClient.get<any[]>('/api/v1/projects');
      return res.data;
    },
    get: async (projectId: string): Promise<any> => {
      const res = await httpClient.get<any>(`/api/v1/projects/${projectId}`);
      return res.data;
    },
    delete: async (projectId: string): Promise<{ status: string; project_id: string }> => {
      const res = await httpClient.delete<{ status: string; project_id: string }>(`/api/v1/projects/${projectId}`);
      return res.data;
    },
  },

  // --- System Settings ---
  settings: {
    get: async (): Promise<any> => {
      const res = await httpClient.get<any>('/api/v1/settings');
      return res.data;
    },
    update: async (data: any): Promise<any> => {
      const res = await httpClient.post<any>('/api/v1/settings', data);
      return res.data;
    },
  },

  // --- Batch Processing Engine ---
  batch: {
    getStatus: async (): Promise<any> => {
      const res = await httpClient.get<any>('/api/v1/batch/status');
      return res.data;
    },
    getHistory: async (): Promise<any[]> => {
      const res = await httpClient.get<any[]>('/api/v1/batch/history');
      return res.data;
    },
    cancel: async (): Promise<any> => {
      const res = await httpClient.post<any>('/api/v1/batch/cancel');
      return res.data;
    },
  },

  // --- Multi-Tenant Workspaces ---
  tenants: {
    list: async (): Promise<{ success: boolean; tenants: any[] }> => {
      const res = await httpClient.get<{ success: boolean; tenants: any[] }>(
        '/api/v1/external/ai-video/tenants'
      );
      return res.data;
    },
  },

  // --- SupoClip Ecosystem Integration ---
  supoclip: {
    getStatus: async (): Promise<SupoClipStatus> => {
      const res = await httpClient.get<SupoClipStatus>('/api/v1/supoclip/status');
      return res.data;
    },
    getWorkflows: async (): Promise<{ success: boolean; workflows: SupoClipWorkflow[] }> => {
      const res = await httpClient.get<{ success: boolean; workflows: SupoClipWorkflow[] }>(
        '/api/v1/supoclip/workflows'
      );
      return res.data;
    },
    getTemplates: async (): Promise<{ success: boolean; templates: SupoClipTemplate[] }> => {
      const res = await httpClient.get<{ success: boolean; templates: SupoClipTemplate[] }>(
        '/api/v1/supoclip/templates'
      );
      return res.data;
    },
    getFonts: async (): Promise<{ success: boolean; fonts: string[] }> => {
      const res = await httpClient.get<{ success: boolean; fonts: string[] }>(
        '/api/v1/supoclip/fonts'
      );
      return res.data;
    },
    score: async (req: SupoClipScoreRequest): Promise<SupoClipScoreResponse> => {
      const res = await httpClient.post<SupoClipScoreResponse>(
        '/api/v1/supoclip/score',
        req
      );
      return res.data;
    },
    plan: async (req: SupoClipPlanRequest): Promise<SupoClipPlanResponse> => {
      const res = await httpClient.post<SupoClipPlanResponse>(
        '/api/v1/supoclip/plan',
        req
      );
      return res.data;
    },
    render: async (req: SupoClipRenderRequest): Promise<SupoClipRenderResponse> => {
      const res = await httpClient.post<SupoClipRenderResponse>(
        '/api/v1/supoclip/render',
        req
      );
      return res.data;
    },
    trim: async (req: { source_path?: string; clip_id?: string; start_time: number; end_time: number }): Promise<any> => {
      const res = await httpClient.post('/api/v1/supoclip/editor/trim', req);
      return res.data;
    },
    split: async (req: { source_path?: string; clip_id?: string; split_timestamp: number }): Promise<any> => {
      const res = await httpClient.post('/api/v1/supoclip/editor/split', req);
      return res.data;
    },
    merge: async (req: { clip_ids?: string[]; clip_paths?: string[]; target_filename?: string }): Promise<any> => {
      const res = await httpClient.post('/api/v1/supoclip/editor/merge', req);
      return res.data;
    },
    getPresets: async (): Promise<SupoClipPresetsResponse> => {
      const res = await httpClient.get<SupoClipPresetsResponse>(
        '/api/v1/supoclip/editor/presets'
      );
      return res.data;
    },
    getExportZipUrl: (projectId?: string, clipIds?: string[]): string => {
      const params = new URLSearchParams();
      if (projectId) params.set('project_id', projectId);
      if (clipIds && clipIds.length > 0) params.set('clip_ids', clipIds.join(','));
      return `/api/v1/supoclip/export/zip?${params.toString()}`;
    },
  },
};

export const apiClient = api;

