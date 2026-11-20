import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { UserRole, Workspace, WorkspaceUser } from '@/types';

export const DEFAULT_USERS: WorkspaceUser[] = [
  { id: 'user_admin', name: 'Admin', role: 'admin' },
  { id: 'user_editor', name: 'Editor', role: 'editor' },
  { id: 'user_publisher', name: 'Publisher', role: 'publisher' },
  { id: 'user_viewer', name: 'Viewer', role: 'viewer' },
];

export const DEFAULT_WORKSPACES: Workspace[] = [
  {
    id: 'studio_main',
    name: 'Studio Workspace',
    role: 'admin',
  },
];

interface WorkspaceState {
  workspaceId: string;
  userId: string;
  userName: string;
  userRole: UserRole;
  apiKey: string | null;
  tenantKey: string | null;
  workspaces: Workspace[];
  teamMembers: WorkspaceUser[];
  setWorkspace: (id: string) => void;
  setWorkspaces: (workspaces: Workspace[]) => void;
  setUser: (userId: string) => void;
  setRole: (role: UserRole) => void;
  setApiKey: (key: string | null) => void;
  setTenantKey: (key: string | null) => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      workspaceId: 'studio_main',
      userId: 'user_admin',
      userName: 'Admin',
      userRole: 'admin',
      apiKey: null,
      tenantKey: 'studio_main',
      workspaces: DEFAULT_WORKSPACES,
      teamMembers: DEFAULT_USERS,

      setWorkspace: (id) => set({ workspaceId: id }),
      setWorkspaces: (workspaces) => set({ workspaces }),

      setUser: (userId) =>
        set((state) => {
          const user = state.teamMembers.find((u) => u.id === userId);
          return {
            userId,
            userName: user?.name || 'Operator',
            userRole: user?.role || 'editor',
          };
        }),

      setRole: (userRole) => set({ userRole }),
      setApiKey: (apiKey) => set({ apiKey }),
      setTenantKey: (tenantKey) => set({ tenantKey }),
    }),
    {
      name: 'yt-clipping-workspace-storage',
    }
  )
);
