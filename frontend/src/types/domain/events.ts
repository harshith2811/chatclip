import type {
  JobRecord,
} from './pipeline';

// ==============================================================================
// 12. Server-Sent Events (SSE) Contracts
// ==============================================================================

export type SSEEventName = 'message' | 'error' | 'end';

export interface SSEJobStreamEvent {
  event?: SSEEventName;
  data: JobRecord | SSEErrorPayload;
}

export interface SSEErrorPayload {
  error: string;
}
