# Plan

## Task ID
11-provider-stream-deterministic-mapping

## Status
This task is being repurposed from parser-only hardening to a broader, more robust product direction:
- deterministic data contract
- robust storage model for SEO + refresh
- extension-first compact UX
- web-first expanded analysis UX

The old contents are intentionally replaced.

---

## Why This Task Exists
Current graph-first rendering and mixed capture/storage patterns make advanced workflows hard:
- branch-level and node-level refresh are fragile
- provider lineage is inconsistent in some paths
- RAM state can diverge from DB-authoritative state
- UI becomes cluttered as data grows

We need one deterministic operating model that supports:
1. stable storage
2. reliable replay/refresh
3. narrow extension UX
4. rich web analysis UX

---

## Product Direction (Final Decision)

### Primary UX Model
- **Extension (400–700 px):** single-column drill-down workflow
- **Web app (desktop):** expanded multi-pane workspace
- **Graph view:** secondary visualization only (not primary operating surface)

### Why
- Graph is useful for topology and demos, but weak for high-density operations.
- SEO operations require filtering, tabular evidence review, and precise refresh controls.

---

## UI Architecture

## A) Extension UX (compact, execution-oriented)
Use progressive disclosure navigation instead of multi-pane layout.

### Level 1: Prompt list
Each prompt card shows:
- provider badge
- freshness status
- child counts
- quick action: fire/refresh

### Level 2: Subquery list (inside selected prompt)
Each subquery row shows:
- site count
- change badge (`+new / -lost` where available)
- `Refresh subquery` action

### Level 3: Site list (for selected subquery)
Each site row shows:
- site/domain
- URL
- short title
- last seen
- confidence (if available)

### Evidence Drawer / Sheet
Open from site row:
- citations/snippets/evidence links
- semrush/ahrefs metrics summary
- provider + capture lineage
- refresh history for that node

### Sticky action area
- Refresh node
- Refresh branch
- Fire
- Back

### Escape hatch
- `Open in Web Dashboard` deep-link for full analysis.

## B) Web UX (expanded analysis workspace)
Use 3-panel desktop workspace.

### Left panel: Prompt branches
- prompt list
- provider and freshness indicators
- last refresh timestamps

### Middle panel: Subqueries
- scoped to selected prompt
- row-level refresh controls
- diff badges per subquery

### Right panel: Sites/evidence table
Columns:
- site name/domain
- URL
- title
- provider
- confidence
- last seen

Actions:
- open evidence
- refresh node

### Bottom/side evidence panel
- citations/snippets
- source metadata
- semrush/ahrefs metrics
- before/after diff

### Refresh console
Global job state:
- queued/running/failed/done
- cancel/retry controls
- per-step progress (submit -> capture -> persist -> diff)

---

## Data Model Strategy (Robust + Deterministic)

## 1) Separate Facts from Read Models

### Immutable facts (append-only)
- capture stream facts/events per turn
- analytics events

### Materialized read models (mutable)
- prompt/subquery/site node tree for fast rendering
- branch snapshots/diff summaries
- refresh run state

Do not mix large raw payloads directly into tree nodes.

## 2) Canonical Node Types
Only these node types should be renderable in tree:
- `prompt`
- `subquery`
- `site`
- `generated`

## 3) Required per-node metadata contract

### `prompt`
- `prompt_ref`
- `capture_turn_id`
- `origin_provider`
- `origin_session_id`
- `origin_request_id`
- `source_version_id`

### `subquery`
- `subquery_ref`
- `query_key`
- `first_seen_seq`

### `site`
- `result_ref`
- `url`
- `domain`
- `citation_title` (short)
- `source` (`citation`/`insight`)

### `generated`
- `source='suggestion'`
- `generation_run_id`
- `reason`
- `target_subquery`

## 4) Refresh metadata (executable nodes)
For refreshable nodes (`prompt`, `subquery`, optional `generated`):
- `refreshable`
- `last_refreshed_at`
- `last_refresh_run_id`
- `refresh_count`
- `refresh_status` (`idle|queued|running|failed|done`)
- `refresh_provider`
- `refresh_source_version_id`

---

## Deterministic Identity Rules
Never use display text as identity.
Use stable refs:
- `subquery_ref = hash(turn_id + normalized_query)`
- `result_ref = hash(subquery_ref + canonical_url)`

Dedupe and ordering:
- order by first-seen sequence
- idempotent upsert by ref keys

---

## Refresh/Replay Model

## Refresh scopes
- campaign-wide
- branch (`prompt` subtree)
- single node (prompt/subquery)

## Refresh modes
- `clone_only` (snapshot clone; current behavior)
- `replay_research` (true re-fire through providers)

## Replace behavior
- `soft_replace` (recommended): keep historical revision, mark latest active
- `hard_replace` (optional): replace current branch directly

## API direction
- `POST /api/campaigns/:id/nodes/:node_id/refresh`
  - payload: `{ provider?, replace_branch? }`
  - returns: `{ refresh_run_id, status }`

---

## Provider-aware Replay Requirement
When replaying/refiring:
- replay each prompt with its recorded provider lineage
- do not default everything to one provider
- preserve source->target lineage for auditing

If lineage missing:
- fallback strategy must be explicit and logged
- never silently pick random provider

---

## Acceptance Criteria

1. Extension UX is usable at 400–700 px without horizontal squeeze.
2. Web UX supports high-density analysis with filters and evidence drill-down.
3. Graph remains available but is not required for daily operations.
4. Data model contract is explicit and enforced for all node types.
5. Refresh metadata exists and updates correctly per executable node.
6. Branch/node refresh works with deterministic replay and lineage.
7. RAM preview and DB-authoritative state converge consistently.
8. Large snippets/raw blobs are not stored in tree node metadata.

---

## Implementation Order

1. Lock node metadata contract and refresh metadata schema.
2. Split immutable facts vs materialized read models cleanly.
3. Implement extension drill-down UI with evidence drawer.
4. Implement web 3-panel workspace + refresh console.
5. Add provider-aware replay/refresh APIs and job flow.
6. Add diff summaries and freshness indicators.
7. Keep graph as secondary read-only/overview layer.

---

## Guardrails

- Preserve current deterministic ingest behavior.
- Keep `snake_case` across payloads/storage.
- Avoid breaking existing campaign/version endpoints.
- Do not over-couple UI shape to raw provider payload shape.
- Prefer explicit contracts over inferred UI behavior.

---

## File Focus (Likely)

Backend:
- `/Users/abhishekverma/Desktop/Cluster/Projects/ai-seo/backend/prisma/schema.prisma`
- `/Users/abhishekverma/Desktop/Cluster/Projects/ai-seo/backend/src/modules/campaign/campaign.service.ts`
- `/Users/abhishekverma/Desktop/Cluster/Projects/ai-seo/backend/src/modules/campaign/campaign.repository.ts`

Extension:
- `/Users/abhishekverma/Desktop/Cluster/Projects/ai-seo/extension/src/pages/VisualizationPage.tsx`
- `/Users/abhishekverma/Desktop/Cluster/Projects/ai-seo/extension/src/components/ListView.tsx`
- `/Users/abhishekverma/Desktop/Cluster/Projects/ai-seo/extension/src/background.ts`

Web:
- `/Users/abhishekverma/Desktop/Cluster/Projects/ai-seo/web/src/pages/campaign-graph-page.tsx`
- `/Users/abhishekverma/Desktop/Cluster/Projects/ai-seo/web/src/pages/campaign-list-page.tsx`
- `/Users/abhishekverma/Desktop/Cluster/Projects/ai-seo/web/src/pages/campaign-layout.tsx`

