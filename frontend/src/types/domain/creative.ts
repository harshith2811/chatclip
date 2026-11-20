// ==============================================================================
// 8. FLUX.1 Creative Engine Contracts
// ==============================================================================

export interface FluxGenerateRequest {
  prompt: string;
  style_preset?: string | null;
  width?: number | null;
  height?: number | null;
  steps?: number | null;
  animate_broll?: boolean | null;
}

export interface FluxGenerateResponse {
  success: boolean;
  prompt: string;
  style_preset: string;
  file_path: string;
  file_url: string;
  width: number;
  height: number;
  steps: number;
  duration_ms: number;
  broll_video_path?: string;
  broll_video_url?: string;
  concept?: string;
  error?: string;
}

export interface FluxBRollRequest {
  image_path: string;
  duration?: number | null;
  motion?: 'zoom_in' | 'zoom_out' | 'pan' | string | null;
}

export interface FluxBRollResponse {
  success: boolean;
  broll_video_path: string;
  broll_video_url: string;
  duration: number;
  motion: string;
}

export interface FluxAutoBRollRequest {
  transcript_text: string;
  max_concepts?: number | null;
  style_preset?: string | null;
}

export interface FluxAutoBRollResponse {
  success: boolean;
  count: number;
  assets: FluxGenerateResponse[];
}

export interface FluxSettingsRequest {
  account_id: string;
  api_token: string;
}

export interface FluxStatusResponse {
  configured: boolean;
  account_id_masked?: string;
  default_model: string;
  output_dir: string;
}

