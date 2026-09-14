import { Bell, LogOut, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useCatalystUser } from '@/components/CatalystAuthGate';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

interface UserMenuProps {
  /** Opens reminder settings, which used to be a toggle in the tasks header. */
  onOpenReminders: () => void;
  /** Notifications are supported but not granted: reminders cannot fire. */
  remindersNeedAttention: boolean;
}

/**
 * The account menu, at the foot of the icon rail.
 *
 * Moved out of App.tsx. Reminder settings join it, since the tasks header that
 * used to hold that toggle is now limited to the view's own controls.
 */
export function UserMenu({ onOpenReminders, remindersNeedAttention }: UserMenuProps) {
  const { session, signOut } = useCatalystUser();
  if (!session) return null;

  const initials = session.username?.[0]?.toUpperCase() || session.email?.[0]?.toUpperCase() || 'U';
  const displayName = session.username || session.email;
  const isVerified = session.emailVerified;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="relative flex size-10 items-center justify-center rounded-[14px] transition-colors duration-150 hover:bg-a-rail-fg/10"
          aria-label={remindersNeedAttention ? 'Account — reminders need attention' : 'Account'}
        >
          <Avatar size="sm">
            <AvatarFallback className="bg-a-accent text-[11px] font-semibold text-a-bg">{initials}</AvatarFallback>
          </Avatar>
          {remindersNeedAttention && (
            <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-q-delegate-bg ring-2 ring-a-rail" aria-hidden />
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent side="right" align="end" className="w-64">
        <div className="space-y-1 px-3 py-3">
          <div className="flex items-center gap-2">
            <p className="flex-1 truncate text-[13px] font-semibold">{displayName}</p>
            {isVerified ? (
              <span className="flex flex-shrink-0 items-center gap-1 rounded-full bg-a-sage-tint px-1.5 py-0.5 text-[11px] font-medium text-a-sage-ink">
                <ShieldCheck className="size-3" /> Verified
              </span>
            ) : (
              <span className="flex flex-shrink-0 items-center gap-1 rounded-full bg-q-delegate-bg px-1.5 py-0.5 text-[11px] font-medium text-q-delegate">
                <ShieldAlert className="size-3" /> Unverified
              </span>
            )}
          </div>
          <p className="truncate text-[12px] text-a-faint">{session.email}</p>
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={onOpenReminders} className="gap-2.5">
          <Bell className="size-4" />
          <span className="flex-1">Reminder settings</span>
          {remindersNeedAttention && <span className="text-[11px] text-q-delegate">Off</span>}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem variant="destructive" onClick={signOut} className="gap-2.5">
          <LogOut className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
