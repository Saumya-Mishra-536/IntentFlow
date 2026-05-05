export type ExecutionPhase =
  | "open_tab"
  | "inject"
  | "send_prompt"
  | "await_stream"
  | "hydrate_conversation"
  | "ingest"
  | "complete"
  | "failed";

export type WorkflowAsyncStatus = "idle" | "loading" | "success" | "error";

export interface WorkflowAsyncState {
  status: WorkflowAsyncStatus;
  message?: string;
  updatedAt?: string;
}

export interface ExecutionTimelineState {
  executionId?: string;
  promptIndex?: number;
  totalCount?: number;
  promptText?: string;
  phase: ExecutionPhase;
  stepMessage: string;
  provider?: string;
  updatedAt?: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export const phase_to_copy = (phase: ExecutionPhase, error?: string): string => {
  if (phase === "open_tab") return "Opening provider tab...";
  if (phase === "inject") return "Preparing capture listeners...";
  if (phase === "send_prompt") return "Typing and sending prompt...";
  if (phase === "await_stream") return "Capturing response...";
  if (phase === "hydrate_conversation") return "Fetching full conversation...";
  if (phase === "ingest") return "Saving prompt outputs...";
  if (phase === "complete") return "Completed";
  if (phase === "failed") return `Failed${error ? `: ${error}` : ""}`;
  return "Running...";
};

