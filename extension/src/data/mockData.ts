export interface PromptNode {
  id: string;
  type: "prompt" | "subquery" | "site" | "generated";
  content: string;
  children?: PromptNode[];
  metadata?: {
    source?: string;
    prompt_ref?: string;
    subquery_ref?: string;
    result_ref?: string;
    query_key?: string;
    url?: string;
    citation_title?: string;
    domain?: string;
    lineage?: {
      capture_turn_id?: string;
      origin_provider?: string;
      origin_request_id?: string;
      source_version_id?: string;
    };
    refresh?: {
      refreshable?: boolean;
      refresh_count?: number;
      refresh_status?: "idle" | "queued" | "running" | "failed" | "done";
      last_refreshed_at?: string;
      last_refresh_run_id?: string;
      refresh_provider?: string;
      refresh_source_version_id?: string;
    };
    ui?: {
      display_label?: string;
      is_unmapped?: boolean;
      is_system?: boolean;
    };
    // Legacy optional fields retained for compatibility.
    keywords?: string[];
    snippet?: string;
    title?: string;
  };
}

export interface Session {
  id: string;
  title: string;
  timestamp: string;
  status: "listening" | "intercepting" | "analyzing" | "generating" | "complete";
  rootPrompt: PromptNode;
}

export function countBranches(node: PromptNode): number {
  if (!node.children?.length) {
    return 0;
  }

  return node.children.reduce((total, child) => total + 1 + countBranches(child), 0);
}

export const mockSessions: Session[] = [
  {
    id: "session-1",
    title: "Maruti Suzuki Research",
    timestamp: "2026-01-14T09:40:00",
    status: "complete",
    rootPrompt: {
      id: "root-1",
      type: "prompt",
      content: "Maruti Suzuki cars",
      children: [
        {
          id: "sub-1",
          type: "subquery",
          content: "best Maruti cars under 10 lakhs",
          children: [
            {
              id: "site-1",
              type: "site",
              content: "CarDekho.com",
              metadata: {
                url: "https://www.cardekho.com",
                keywords: ["budget hatchback", "maruti pricing", "best family cars"],
              },
              children: [
                {
                  id: "gen-1",
                  type: "generated",
                  content: "affordable Maruti family cars under 10 lakhs",
                  metadata: { source: "AI Generated from keywords" },
                },
              ],
            },
          ],
        },
        {
          id: "sub-2",
          type: "subquery",
          content: "Maruti service cost by model",
          children: [
            {
              id: "site-2",
              type: "site",
              content: "MarutiSuzuki.com",
              metadata: {
                url: "https://www.marutisuzuki.com",
                keywords: ["service intervals", "service package", "maintenance cost"],
              },
            },
          ],
        },
      ],
    },
  },
  {
    id: "session-2",
    title: "Budget Cars in India",
    timestamp: "2026-01-11T18:20:00",
    status: "complete",
    rootPrompt: {
      id: "root-2",
      type: "prompt",
      content: "best budget cars in India",
      children: [
        {
          id: "sub-3",
          type: "subquery",
          content: "best automatic cars below 12 lakhs",
          children: [
            {
              id: "site-3",
              type: "site",
              content: "CarWale.com",
              metadata: {
                url: "https://www.carwale.com",
                keywords: ["automatic cars", "cvt hatchback", "budget sedan"],
              },
            },
          ],
        },
      ],
    },
  },
  {
    id: "session-3",
    title: "Honda City vs Verna",
    timestamp: "2026-01-16T11:08:00",
    status: "analyzing",
    rootPrompt: {
      id: "root-3",
      type: "prompt",
      content: "Honda City vs Hyundai Verna",
      children: [
        {
          id: "sub-4",
          type: "subquery",
          content: "Honda City vs Verna mileage and ownership cost",
          metadata: { source: "ChatGPT subquery" },
        },
      ],
    },
  },
];
