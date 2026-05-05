import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, LogOut, UserCircle2 } from "lucide-react";
import { ai_chat_provider } from "@/lib/api";
import { campaign_chat } from "@/lib/campaign-chat";

interface AppHeaderProps {
  title?: string;
  onBack?: () => void;
  onLogout?: () => void;
  nav_actions?: ReactNode;
  profile_name?: string;
  profile_image_url?: string;
  /** When set, shows the provider logo inline with the title. */
  provider?: ai_chat_provider;
}

export default function AppHeader({
  title,
  onBack,
  onLogout,
  nav_actions,
  profile_name,
  profile_image_url,
  provider,
}: AppHeaderProps) {
  const providerLogo = provider ? campaign_chat.provider_logo(provider) : undefined;
  const providerLabel = provider ? campaign_chat.provider_label(provider) : undefined;
  const [menu_open, setMenuOpen] = useState(false);
  const profile_ref = useRef<HTMLDivElement | null>(null);
  const profile_initial = useMemo(() => {
    if (!profile_name?.trim()) {
      return "I";
    }
    return profile_name.trim().charAt(0).toUpperCase();
  }, [profile_name]);

  useEffect(() => {
    if (!menu_open) {
      return;
    }
    const on_pointer_down = (event: MouseEvent) => {
      if (!profile_ref.current) {
        return;
      }
      if (!profile_ref.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", on_pointer_down);
    return () => {
      window.removeEventListener("mousedown", on_pointer_down);
    };
  }, [menu_open]);

  return (
    <header className="fixed inset-x-0 top-0 z-20 h-14 border-b border-border bg-background/95 backdrop-blur-sm">
      <div className="flex h-full items-center justify-between gap-2 px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          {onBack ? (
            <Button variant="ghost" size="icon" onClick={onBack} aria-label="Go back" className="h-8 w-8">
              <ChevronLeft className="h-4 w-4" />
            </Button>
          ) : null}
          {providerLogo && (
            <img
              src={providerLogo}
              alt={providerLabel}
              className="h-5 w-5 shrink-0 object-contain"
            />
          )}
          {providerLabel ? <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">{providerLabel}</span> : null}
          {title ? <h1 className="truncate text-sm font-bold uppercase tracking-widest">{title}</h1> : null}
        </div>

        <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
          {nav_actions ? (
            <div className="flex min-w-0 items-center gap-2 overflow-x-auto whitespace-nowrap pr-1">
              {nav_actions}
            </div>
          ) : null}
          <div className="relative" ref={profile_ref}>
            <button
              type="button"
              aria-label="Open profile menu"
              className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-card text-[10px] font-semibold text-foreground"
              onClick={() => setMenuOpen((prev) => !prev)}
            >
              {profile_image_url ? (
                <img src={profile_image_url} alt={profile_name || "Profile"} className="h-full w-full object-cover" />
              ) : (
                profile_initial
              )}
            </button>
            {menu_open ? (
              <div className="absolute right-0 top-10 z-30 w-44 rounded-md border border-border bg-popover p-1 shadow-md">
                <div className="flex items-center gap-2 rounded px-2 py-2 text-xs text-muted-foreground">
                  {profile_image_url ? (
                    <img src={profile_image_url} alt={profile_name || "Profile"} className="h-4 w-4 rounded-full object-cover" />
                  ) : (
                    <UserCircle2 className="h-3.5 w-3.5" />
                  )}
                  <span className="truncate">{profile_name?.trim() || "Intent user"}</span>
                </div>
                {onLogout ? (
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-destructive hover:bg-accent"
                    onClick={() => {
                      setMenuOpen(false);
                      onLogout();
                    }}
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    <span>Logout</span>
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
