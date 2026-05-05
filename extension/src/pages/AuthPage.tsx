import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Compass } from "lucide-react";
import { extension_auth } from "@/lib/auth";

export default function AuthPage() {
  const navigate = useNavigate();
  const [pending_state, setPendingState] = useState("");
  const [is_connecting, setIsConnecting] = useState(false);
  const [manual_code, setManualCode] = useState("");
  const [error_message, setErrorMessage] = useState("");
  const marketing_labs = [
    { id: "chatgpt", name: "ChatGPT", logo: "/chatgpt.svg" },
    { id: "claude", name: "Claude", logo: "/claude.svg" },
    { id: "gemini", name: "Gemini", logo: "/gemini-light.svg" },
    { id: "perplexity", name: "Perplexity", logo: "/perplexity.svg" },
    { id: "grok", name: "Grok", logo: "/grok-(xai).svg" },
  ] as const;

  useEffect(() => {
    const handleStorageChange = () => {
      const authStatus = extension_auth.get_auth_status();
      if (authStatus) {
        navigate("/dashboard");
      }
    };

    handleStorageChange();

    window.addEventListener("storage", handleStorageChange);
    const interval = setInterval(handleStorageChange, 500);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      clearInterval(interval);
    };
  }, [navigate]);

  useEffect(() => {
    const on_message = (event: MessageEvent) => {
      if (event.origin !== extension_auth.web_app_origin) {
        return;
      }
      const payload = event.data as
        | { type?: string; code?: string; state?: string; error?: string }
        | undefined;
      if (!payload || payload.type !== "ai_seo_extension_auth_code") {
        return;
      }
      if (pending_state && payload.state !== pending_state) {
        setErrorMessage("State mismatch in extension auth handoff");
        setIsConnecting(false);
        return;
      }
      if (payload.error) {
        setErrorMessage(payload.error);
        setIsConnecting(false);
        return;
      }
      if (!payload.code) {
        setErrorMessage("Missing code from web auth handoff");
        setIsConnecting(false);
        return;
      }

      extension_auth
        .exchange_code(payload.code)
        .then((session) => {
          extension_auth.set_auth_session(session);
          navigate("/dashboard");
        })
        .catch((error) => {
          setErrorMessage(error instanceof Error ? error.message : "Failed to complete auth");
          setIsConnecting(false);
        });
    };

    window.addEventListener("message", on_message);
    return () => {
      window.removeEventListener("message", on_message);
    };
  }, [navigate, pending_state]);

  const handleAuth = () => {
    setErrorMessage("");
    setIsConnecting(true);
    const state = extension_auth.open_web_connect_page();
    setPendingState(state);
  };

  const handle_manual_exchange = () => {
    if (!manual_code.trim()) {
      setErrorMessage("Enter the one-time code from web app");
      return;
    }
    setIsConnecting(true);
    setErrorMessage("");
    extension_auth
      .exchange_code(manual_code.trim())
      .then((session) => {
        extension_auth.set_auth_session(session);
        navigate("/dashboard");
      })
      .catch((error) => {
        setErrorMessage(error instanceof Error ? error.message : "Failed to complete auth");
        setIsConnecting(false);
      });
  };

  return (
    <div className="flex min-h-dvh w-full items-center justify-center overflow-y-auto bg-background px-3 py-4 sm:px-4 sm:py-6">
      <div className="flex w-full max-w-md flex-col items-center gap-6 px-2 py-4 sm:gap-8 sm:px-4 sm:py-8">
        <div className="flex h-16 w-16 items-center justify-center rounded-xl border border-border bg-card">
          <Compass className="h-8 w-8 text-primary" />
        </div>

        <div className="space-y-2 text-center">
          <h1 className="text-3xl font-black tracking-tighter sm:text-4xl">Intent</h1>
          <p className="text-xs text-muted-foreground">
            Capture search intent and map follow-up branches from live prompts.
          </p>
        </div>

        <Button
          onClick={handleAuth}
          disabled={is_connecting}
          className="h-12 w-full rounded-none text-xs uppercase tracking-widest"
        >
          {is_connecting ? "Waiting for Web Auth..." : "Connect Intent"}
        </Button>

        {is_connecting ? (
          <div className="w-full space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : null}

        {error_message ? <p className="text-center text-xs text-destructive">{error_message}</p> : null}

        <div className="w-full space-y-2">
          <p className="text-center text-[10px] uppercase tracking-widest text-muted-foreground">
            Manual fallback
          </p>
          <input
            value={manual_code}
            onChange={(event) => setManualCode(event.target.value)}
            placeholder="Paste one-time code"
            className="h-10 w-full rounded-md border border-border bg-background px-3 text-xs"
          />
          <Button
            variant="secondary"
            className="h-10 w-full text-[10px] uppercase tracking-widest"
            disabled={is_connecting}
            onClick={handle_manual_exchange}
          >
            Exchange Code
          </Button>
        </div>

        <p className="text-center font-mono text-[10px] text-muted-foreground/50">
          OAuth handshake required to enable Intent workspace access.
        </p>
        <section className="w-full space-y-2 rounded-xl border border-border/70 bg-card/60 px-3 py-3">
          <div className="flex items-center justify-center gap-2 overflow-hidden">
            <div className="flex items-center gap-2">
              {marketing_labs.map((lab) => (
                <div
                  key={lab.id}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-background/80"
                >
                  <img src={lab.logo} alt={lab.name} className="h-4 w-4 object-contain opacity-80" />
                </div>
              ))}
            </div>
          </div>
          <p className="text-center text-[10px] text-muted-foreground">
            Start in any AI chat app, capture live search branches, and build campaign-wise intent history.
          </p>
        </section>
      </div>
    </div>
  );
}
