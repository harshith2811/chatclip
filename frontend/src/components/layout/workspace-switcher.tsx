'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useWorkspaceStore } from '@/lib/store/workspace-store';
import { Badge } from '@/components/ui/badge';
import { Building2, Users, Check, ChevronDown, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { UserRole } from '@/types';

export interface WorkspaceSwitcherProps {
  className?: string;
  compact?: boolean;
}

const ROLE_STYLES: Record<UserRole, string> = {
  admin: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
  editor: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30',
  publisher: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  viewer: 'bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30',
};

export function WorkspaceSwitcher({ className, compact = false }: WorkspaceSwitcherProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const {
    workspaceId,
    workspaces,
    setWorkspace,
    setWorkspaces,
    userId,
    userName,
    userRole,
    teamMembers,
    setUser,
  } = useWorkspaceStore();

  // Fetch authentic multi-tenant workspaces from SQLite DB
  const { data: tenantsResponse } = useQuery({
    queryKey: ['tenants-list'],
    queryFn: () => api.tenants.list(),
    staleTime: 1000 * 60,
  });

  const authenticWorkspaces = React.useMemo(() => {
    if (tenantsResponse?.tenants && tenantsResponse.tenants.length > 0) {
      return tenantsResponse.tenants.map((t: any) => ({
        id: t.tenant_id,
        name: t.name || t.tenant_id,
        role: 'admin' as UserRole,
        apiKey: t.api_key,
      }));
    }
    return workspaces;
  }, [tenantsResponse, workspaces]);

  React.useEffect(() => {
    if (tenantsResponse?.tenants && tenantsResponse.tenants.length > 0) {
      const mapped = tenantsResponse.tenants.map((t: any) => ({
        id: t.tenant_id,
        name: t.name || t.tenant_id,
        role: 'admin' as UserRole,
        apiKey: t.api_key,
      }));
      setWorkspaces(mapped);
    }
  }, [tenantsResponse, setWorkspaces]);

  const activeWorkspace = authenticWorkspaces.find((w: any) => w.id === workspaceId) || authenticWorkspaces[0];

  // Close dropdown on outside click
  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Close on Escape key
  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  return (
    <div ref={containerRef} className={cn('relative inline-block text-left', className)}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-label={`Active workspace: ${activeWorkspace?.name || 'Default'}, active user: ${userName} (${userRole})`}
        className={cn(
          'flex items-center gap-2 rounded-lg border border-border/80 bg-card/60 backdrop-blur-xs px-2.5 py-1.5 text-xs text-foreground transition-all hover:bg-card hover:border-border cursor-pointer select-none',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          compact ? 'px-2 py-1' : 'px-3 py-1.5'
        )}
      >
        <Building2 className="w-3.5 h-3.5 text-blue-500 shrink-0" />
        <div className={cn('flex items-center gap-1.5 text-left', compact && 'hidden sm:flex')}>
          <span className="font-semibold max-w-[110px] truncate text-xs">
            {activeWorkspace?.name || 'Workspace'}
          </span>
          <span className="text-muted-foreground">•</span>
          <span className="max-w-[85px] truncate text-muted-foreground text-xs">
            {userName}
          </span>
        </div>
        <Badge
          variant="outline"
          className={cn('text-[10px] font-mono px-1.5 py-0 capitalize', ROLE_STYLES[userRole])}
        >
          {userRole}
        </Badge>
        <ChevronDown
          className={cn('w-3 h-3 text-muted-foreground transition-transform duration-200', isOpen && 'rotate-180')}
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          role="menu"
          aria-orientation="vertical"
          className="absolute right-0 mt-2 w-72 rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-xl z-50 animate-in fade-in-0 zoom-in-95"
        >
          {/* Workspaces Section */}
          <div className="px-2 py-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Building2 className="w-3 h-3" />
            <span>Select Workspace</span>
          </div>
          <div className="space-y-0.5 mt-1">
            {authenticWorkspaces.map((ws: any) => {
              const isSelected = ws.id === workspaceId;
              return (
                <button
                  key={ws.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setWorkspace(ws.id);
                    if (ws.apiKey) {
                      useWorkspaceStore.getState().setApiKey(ws.apiKey);
                    }
                    useWorkspaceStore.getState().setTenantKey(ws.id);
                    setIsOpen(false);
                  }}
                  className={cn(
                    'w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs transition-colors cursor-pointer text-left',
                    isSelected
                      ? 'bg-primary text-primary-foreground font-semibold'
                      : 'hover:bg-muted text-foreground'
                  )}
                >
                  <span className="truncate">{ws.name}</span>
                  {isSelected && <Check className="w-3.5 h-3.5 shrink-0" />}
                </button>
              );
            })}
          </div>

          <div className="my-2 border-t border-border/60" />

          {/* User Persona Switcher */}
          <div className="px-2 py-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Users className="w-3 h-3" />
            <span>Switch User Persona</span>
          </div>
          <div className="space-y-0.5 mt-1 max-h-48 overflow-y-auto">
            {teamMembers.map((member) => {
              const isSelected = member.id === userId;
              return (
                <button
                  key={member.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setUser(member.id);
                  }}
                  className={cn(
                    'w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs transition-colors cursor-pointer text-left',
                    isSelected
                      ? 'bg-muted font-semibold text-foreground'
                      : 'hover:bg-muted/60 text-muted-foreground hover:text-foreground'
                  )}
                >
                  <div className="flex items-center gap-2 truncate">
                    <span className="truncate">{member.name}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge
                      variant="outline"
                      className={cn('text-[10px] font-mono px-1 py-0 capitalize', ROLE_STYLES[member.role])}
                    >
                      {member.role}
                    </Badge>
                    {isSelected && <Check className="w-3.5 h-3.5 text-blue-500" />}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
