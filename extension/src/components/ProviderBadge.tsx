import { ai_chat_provider } from "@/lib/api";
import { campaign_chat } from "@/lib/campaign-chat";

interface ProviderBadgeProps {
  provider: ai_chat_provider;
  className?: string;
}

export default function ProviderBadge({ provider, className }: ProviderBadgeProps) {
  const logo = campaign_chat.provider_logo(provider);
  const label = campaign_chat.provider_label(provider);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground ${className ?? ""}`}
    >
      {logo ? <img src={logo} alt={label} className="h-3 w-3 rounded-sm object-contain" /> : null}
      {label}
    </span>
  );
}
