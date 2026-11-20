import { create } from 'zustand';

/**
 * Isolated high-frequency playback micro-store.
 * Decouples 60fps video timeupdate events from the main React tree.
 * Scrubber and time readout components subscribe transiently without
 * re-rendering parent page layouts.
 */
interface PlaybackState {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  bufferedEnd: number;
  setTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setIsPlaying: (isPlaying: boolean) => void;
  setBufferedEnd: (bufferedEnd: number) => void;
  reset: () => void;
}

export const usePlaybackStore = create<PlaybackState>((set) => ({
  currentTime: 0,
  duration: 0,
  isPlaying: false,
  bufferedEnd: 0,

  setTime: (currentTime) => set({ currentTime }),
  setDuration: (duration) => set({ duration }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setBufferedEnd: (bufferedEnd) => set({ bufferedEnd }),
  reset: () =>
    set({
      currentTime: 0,
      duration: 0,
      isPlaying: false,
      bufferedEnd: 0,
    }),
}));
