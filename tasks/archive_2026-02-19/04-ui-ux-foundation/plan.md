# Task 04 Plan: UX Dashboard Upgrade (Web + Extension Data)

## Objective
Build a high-quality, production-style dashboard that visualizes extension-captured SEO data with strong UX, clean information architecture, and smooth interactions.

## Mandatory Instruction for Agent
- You **must read and follow `./ui.md`** before implementing any UI.
- Treat `ui.md` as the design and interaction source of truth.
- If there is any conflict, prioritize `ui.md` patterns and then align implementation details with existing app architecture.

## Product Goal
Create a dashboard that helps users understand project-wise captured prompt trees and SEO signal quality quickly, with:
- clear project hierarchy,
- visual exploration of prompt evolution,
- metrics and trends,
- actionable next steps.

## Core Deliverables
1. **Project-first Dashboard Layout**
- Project switcher/list with status and summary metrics.
- Dashboard home with key KPIs per selected project.
- Fast navigation between overview, tree exploration, and analytics views.

2. **React Flow Tree Visualization**
- Use React Flow for interactive prompt/query/result graph.
- Node types: prompt, subquery, site, generated.
- Pan/zoom, fit view, minimap, and clean edge routing.
- Strong visual hierarchy and readable labels for large graphs.

3. **Charts and Analytics**
- Add chart-based insights (trend and distribution views), e.g.:
  - prompt volume over time,
  - branch depth distribution,
  - node-type mix,
  - top query clusters.
- Charts should be responsive and readable on desktop and mobile.

4. **Data Integration (Real Only)**
- Consume real backend project/tree APIs.
- Remove mock dependencies from dashboard views.
- Handle loading, empty, partial, and error states elegantly.

5. **UX Quality Bar**
- Strong visual consistency and spacing system.
- Smooth transitions for tree and chart updates.
- Clear state indicators (capturing, processing, complete).
- No clutter: prioritize clarity and scanability.

6. **Project Structure and Maintainability**
- Keep a clean feature-oriented structure.
- Separate concerns for:
  - pages,
  - ui components,
  - visualization components,
  - API adapters,
  - types/models.
- Keep naming conventions consistent (`snake_case` for API payload keys and schema-aligned fields).

## Suggested Implementation Breakdown
1. Audit `ui.md` + current dashboard routes/components.
2. Define final dashboard IA and route map.
3. Implement reusable layout primitives and project shell.
4. Implement React Flow tree module with typed node mappers.
5. Implement chart section with project analytics cards.
6. Wire real APIs and state handling.
7. Add loading/empty/error UX polish and responsive behavior.
8. Final pass on accessibility, readability, and performance.

## Acceptance Criteria
- Dashboard uses real project data end-to-end.
- React Flow tree is interactive, stable, and easy to read.
- Charts provide meaningful project-level insight.
- UI follows `ui.md` conventions.
- Codebase remains organized and extensible for future features.

## Definition of Done
- No mock dashboard data remains in active flow.
- Build succeeds for relevant apps.
- UX review passes for both desktop and mobile.
- Structure and naming remain clean and consistent.
