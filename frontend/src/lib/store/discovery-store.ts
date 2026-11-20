import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface RecentIngestItem {
  videoId: string;
  url: string;
  title: string;
  channel: string;
  thumbnail: string;
  timestamp: number;
}

interface DiscoveryState {
  currentVideoId: string | null;
  inputUrl: string;
  isTrendingModalOpen: boolean;
  recentHistory: RecentIngestItem[];
  selectedCandidateId: string | null;
  setCurrentVideoId: (id: string | null) => void;
  setInputUrl: (url: string) => void;
  setIsTrendingModalOpen: (open: boolean) => void;
  setSelectedCandidateId: (id: string | null) => void;
  addRecentHistory: (item: Omit<RecentIngestItem, 'timestamp'>) => void;
  removeRecentHistory: (videoId: string) => void;
  clearHistory: () => void;
}

export const useDiscoveryStore = create<DiscoveryState>()(
  persist(
    (set) => ({
      currentVideoId: null,
      inputUrl: '',
      isTrendingModalOpen: false,
      recentHistory: [],
      selectedCandidateId: null,

      setCurrentVideoId: (currentVideoId) => set({ currentVideoId }),
      setInputUrl: (inputUrl) => set({ inputUrl }),
      setIsTrendingModalOpen: (isTrendingModalOpen) => set({ isTrendingModalOpen }),
      setSelectedCandidateId: (selectedCandidateId) => set({ selectedCandidateId }),

      addRecentHistory: (item) =>
        set((state) => {
          const filtered = state.recentHistory.filter((h) => h.videoId !== item.videoId);
          const next = [{ ...item, timestamp: Date.now() }, ...filtered].slice(0, 6);
          return { recentHistory: next };
        }),

      removeRecentHistory: (videoId) =>
        set((state) => ({
          recentHistory: state.recentHistory.filter((h) => h.videoId !== videoId),
        })),

      clearHistory: () => set({ recentHistory: [] }),
    }),
    {
      name: 'yt_clipping_discovery_store',
      partialize: (state) => ({ recentHistory: state.recentHistory }),
    }
  )
);
