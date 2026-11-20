import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type NavigationTab =
  | 'studio'
  | 'editor'
  | 'projects'
  | 'publishing'
  | 'discovery'
  | 'pipeline'
  | 'settings';

interface UiState {
  activeTab: NavigationTab;
  sidebarCollapsed: boolean;
  mobileDrawerOpen: boolean;
  commandSearchOpen: boolean;
  activeModal: string | null;
  modalData: unknown;
  setActiveTab: (tab: NavigationTab) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  setMobileDrawerOpen: (open: boolean) => void;
  toggleMobileDrawer: () => void;
  setCommandSearchOpen: (open: boolean) => void;
  toggleCommandSearch: () => void;
  openModal: (modalId: string, data?: unknown) => void;
  closeModal: () => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      activeTab: 'discovery',
      sidebarCollapsed: false,
      mobileDrawerOpen: false,
      commandSearchOpen: false,
      activeModal: null,
      modalData: null,

      setActiveTab: (activeTab) => set({ activeTab, mobileDrawerOpen: false }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setMobileDrawerOpen: (mobileDrawerOpen) => set({ mobileDrawerOpen }),
      toggleMobileDrawer: () => set((state) => ({ mobileDrawerOpen: !state.mobileDrawerOpen })),
      setCommandSearchOpen: (commandSearchOpen) => set({ commandSearchOpen }),
      toggleCommandSearch: () => set((state) => ({ commandSearchOpen: !state.commandSearchOpen })),
      openModal: (activeModal, modalData = null) => set({ activeModal, modalData }),
      closeModal: () => set({ activeModal: null, modalData: null }),
    }),
    {
      name: 'yt-clipping-ui-storage',
      partialize: (state) => ({ sidebarCollapsed: state.sidebarCollapsed }),
    }
  )
);

export const useUIStore = useUiStore;
