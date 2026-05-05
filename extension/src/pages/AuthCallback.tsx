import { useEffect, useRef, useState } from "react";
import { Progress } from "@/components/ui/progress";
import { extension_auth } from "@/lib/auth";

export default function AuthCallback() {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("Validating callback...");
  const has_run_ref = useRef(false);

  useEffect(() => {
    if (has_run_ref.current) {
      return;
    }
    has_run_ref.current = true;

    let close_timer = 0;

    const run = async () => {
      try {
        setProgress(15);
        setStatus("Exchanging auth code...");
        const session = await extension_auth.exchange_callback_code();
        setProgress(75);
        extension_auth.set_auth_session(session);
        setProgress(100);
        setStatus("Connected. Returning to extension...");
        close_timer = window.setTimeout(() => {
          window.close();
        }, 700);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Failed to connect extension");
      }
    };

    void run();

    return () => {
      window.clearTimeout(close_timer);
    };
  }, []);

  return (
    <div className="flex min-h-dvh w-full items-center justify-center overflow-y-auto bg-background px-4 py-6 sm:px-5">
      <div className="w-full max-w-sm space-y-4 text-center">
        <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Authorizing extension</p>
        <p className="text-sm font-medium">{status}</p>
        <Progress value={progress} />
      </div>
    </div>
  );
}
