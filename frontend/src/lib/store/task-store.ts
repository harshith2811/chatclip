import { create } from 'zustand';

export interface BackgroundTask {
  id: string;
  type: 'render' | 'analysis' | 'export';
  title: string;
  targetName?: string;
  statusText: string;
  progress: number;
  status: 'running' | 'completed' | 'failed';
  isMinimized: boolean;
  error?: string;
  createdAt: number;
  completedAt?: number;
}

interface TaskState {
  tasks: Record<string, BackgroundTask>;
  activeModalTaskId: string | null;

  startTask: (task: Omit<BackgroundTask, 'createdAt'>) => void;
  updateTask: (id: string, updates: Partial<BackgroundTask>) => void;
  minimizeTask: (id: string) => void;
  restoreTask: (id: string) => void;
  dismissTask: (id: string) => void;
  clearCompleted: () => void;
}

export const useTaskStore = create<TaskState>()((set) => ({
  tasks: {},
  activeModalTaskId: null,

  startTask: (taskData) => {
    const task: BackgroundTask = {
      ...taskData,
      createdAt: Date.now(),
    };
    set((state) => ({
      tasks: {
        ...state.tasks,
        [task.id]: task,
      },
      activeModalTaskId: taskData.isMinimized ? state.activeModalTaskId : task.id,
    }));
  },

  updateTask: (id, updates) => {
    set((state) => {
      const existing = state.tasks[id];
      if (!existing) return state;
      const updated: BackgroundTask = { ...existing, ...updates };
      if (updates.status === 'completed' && !existing.completedAt) {
        updated.completedAt = Date.now();
      }
      return {
        tasks: {
          ...state.tasks,
          [id]: updated,
        },
      };
    });
  },

  minimizeTask: (id) => {
    set((state) => {
      const existing = state.tasks[id];
      if (!existing) return state;
      return {
        tasks: {
          ...state.tasks,
          [id]: { ...existing, isMinimized: true },
        },
        activeModalTaskId: state.activeModalTaskId === id ? null : state.activeModalTaskId,
      };
    });
  },

  restoreTask: (id) => {
    set((state) => {
      const existing = state.tasks[id];
      if (!existing) return state;
      return {
        tasks: {
          ...state.tasks,
          [id]: { ...existing, isMinimized: false },
        },
        activeModalTaskId: id,
      };
    });
  },

  dismissTask: (id) => {
    set((state) => {
      const newTasks = { ...state.tasks };
      delete newTasks[id];
      return {
        tasks: newTasks,
        activeModalTaskId: state.activeModalTaskId === id ? null : state.activeModalTaskId,
      };
    });
  },

  clearCompleted: () => {
    set((state) => {
      const newTasks: Record<string, BackgroundTask> = {};
      Object.entries(state.tasks).forEach(([id, t]) => {
        if (t.status === 'running') {
          newTasks[id] = t;
        }
      });
      return { tasks: newTasks };
    });
  },
}));
