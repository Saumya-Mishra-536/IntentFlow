# Vercel AI SDK Setup & Architecture

This document provides an end-to-end overview of how the Vercel AI SDK is implemented in this project, covering both the frontend (`hrm8-admin-staff`) and backend (`backend-template`).

## 1. Dependencies

### Frontend (`hrm8-admin-staff`)
*   **`@ai-sdk/react`**: Provides the `useChat` hook for streaming chat interfaces.
*   **`openai`**: Standard OpenAI client (likely for typing or direct calls if needed).

### Backend (`backend-template`)
*   **`ai`**: Core Vercel AI SDK for Node.js (streams, tool calling).
*   **`@ai-sdk/openai`**: OpenAI provider for the AI SDK.
*   **`zod`**: Schema validation for tool parameters.

---

## 2. Backend Architecture (`backend-template`)

The backend handles the AI logic, tool execution, and streaming responses.

### A. API Routes
Located in `src/modules/assistant/assistant.routes.ts`, the API exposes role-specific endpoints to ensure proper access control:

| Endpoint | Auth Middleware | Controller Method | Description |
| :--- | :--- | :--- | :--- |
| `/api/assistant/chat/hrm8/stream` | `authenticateHrm8` | `hrm8ChatStream` | For HRM8 Admins/Staff |
| `/api/assistant/chat/consultant/stream` | `authenticateConsultant` | `consultantChatStream` | For Consultants |
| `/api/assistant/chat/stream` | `authenticate` | `companyChatStream` | For Company Users |

### B. Controller Layer
`AssistantController` (`src/modules/assistant/assistant.controller.ts`) handles the HTTP request:
1.  **Authentication**: Verifies the user based on the route.
2.  **Context Building**: Extracts user details (ID, Role, Company/Region context) to create an `AssistantActor` object.
3.  **Delegation**: Calls `AssistantStreamService.streamHrm8` with the actor and request body.

### C. Service Layer (Streaming Logic)
`AssistantStreamService` (`src/modules/assistant/assistant.stream.service.ts`) is the core engine:
1.  **Initialization**: Creates an OpenAI client using `createOpenAI` and `OPENAI_API_KEY`.
2.  **Message Normalization**: Converts incoming frontend messages to the unified `CoreMessage` format.
3.  **Access Control**:
    *   Determines allowed tools for the user via `AssistantAccessControl`.
    *   Builds a personalized System Prompt (injects user name, specific access scope, and guidelines).
4.  **Streaming**:
    *   Calls `streamText` from the `ai` package.
    *   Configures `tools` (mapped from `TOOL_REGISTRY`).
    *   Streams the response directly to the Express `res` object using `toDataStreamResponse()`.

### D. Tool System
*   **Registry**: `src/modules/assistant/assistant.tool-registry.ts` defines all available tools.
*   **Definition**: Tools use `zod` schemas for parameters and define `allowedRoles` and `dataSensitivity`.
*   **Execution**:
    *   Tools are wrapped to handle permission checks (`AssistantAccessControl.canUseTool`).
    *   Sensitive data is redacted based on user role (`AssistantAccessControl.redactSensitiveData`).
    *   **Audit Logging**: Critical tool usage is logged for security.
*   **Key Tool Categories**:
    *   **Composite**: `get_candidate_complete_overview`, `get_job_complete_dashboard` (fetches multiple data points in one go).
    *   **Consultant**: `get_my_daily_briefing`, `get_consultant_commission`.
    *   **Analytics**: `get_hiring_funnel_analytics`, `get_revenue_analytics`.

---

## 3. Frontend Architecture (`hrm8-admin-staff`)

The frontend implements the chat UI and handles the stream connection.

### A. Components
*   **`AiAssistantSidebar`** (`src/shared/components/common/AiAssistantSidebar.tsx`):
    *   The main reusable chat interface.
    *   Handles UI for messages, input, and speech recognition.
    *   Displays tool invocations (Preparing -> Calling -> Completed) using `ToolInvocationDisplay`.
*   **`Hrm8AiAssistantSidebar`** (`src/shared/components/hrm8/Hrm8AiAssistantSidebar.tsx`):
    *   A specific implementation for the HRM8 admin context.

### B. Integration (`useChat`)
The `useChat` hook from `@ai-sdk/react` drives the interaction:

```typescript
const { messages, input, handleInputChange, handleSubmit, status } = useChat({
  api: `${API_BASE_URL}/api/assistant/chat/hrm8/stream`, // Connects to the specific backend route
  fetch: (url, init) => fetch(url, { ...init, credentials: "include" }), // Ensures cookies/auth are sent
});
```

### C. Features
*   **Streaming Support**: Renders text as it arrives (chunked response).
*   **Tool UI**: Visualizes when the AI is "thinking" or executing a tool.
*   **Speech-to-Text**: Built-in browser based speech recognition fills the input.
*   **Markdown Rendering**: AI responses are rendered as Markdown for rich text support.

---

## 4. End-to-End Data Flow

1.  **User**: Types a message "Show me candidate John Doe" in `Hrm8AiAssistantSidebar`.
2.  **Frontend**: `useChat` POSTs the message history to `/api/assistant/chat/hrm8/stream`.
3.  **Backend (Controller)**: Authenticates user, creates `AssistantActor` context.
4.  **Backend (Service)**:
    *   Builds system prompt: "You are assisting Admin User... Access Level: Global Admin".
    *   Calls `streamText` with OpenAI model.
5.  **LLM**: Decides to call tool `search_candidates_by_name`.
6.  **Backend (Service)**:
    *   Executes tool `search_candidates_by_name`.
    *   Checks permissions.
    *   Returns tool result to LLM.
7.  **LLM**: Generates final response using tool data.
8.  **Backend**: Streams text chunks back to frontend.
9.  **Frontend**: `useChat` updates state, `MarkdownRenderer` displays the response.
