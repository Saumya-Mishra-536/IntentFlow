# Observability Event Matrix

All telemetry events emitted by the backend. Import the `EVENT_*` constants from
`src/utils/telemetry.ts` — never inline the string names.

## Events

| Event name | Emitted in | Level | Key payload fields |
|---|---|---|---|
| `prompt.run.started` | `ProjectService.suggestPrompts` | INFO | `project_id`, `user_id` |
| `prompt.run.completed` | `ProjectService.suggestPrompts` | INFO | `project_id`, `user_id`, `duration_ms`, `suggestion_count`, `site_insight_count` |
| `prompt.run.failed` | `ProjectService.suggestPrompts` | WARN | `project_id`, `user_id`, `duration_ms`, `error_code`, `error_message` |
| `semrush.fetch.started` | `ProjectService.fetchSemrushMetricsForSite` | INFO | `site_name`, `domain` |
| `semrush.fetch.completed` | `ProjectService.fetchSemrushMetricsForSite` | INFO | `site_name`, `domain`, `duration_ms`, `keyword_count` |
| `semrush.fetch.failed` | `ProjectService.fetchSemrushMetricsForSite` | WARN | `site_name`, `domain`, `duration_ms`, `status_code`, `error_code`, `error_message` |
| `openai.request.started` | `ProjectService.getAiPromptSuggestionPayload` | INFO | `model`, `max_suggestions` |
| `openai.request.completed` | `ProjectService.getAiPromptSuggestionPayload` | INFO | `model`, `duration_ms`, `has_result` |
| `openai.request.failed` | `ProjectService.getAiPromptSuggestionPayload` | WARN | `model`, `duration_ms`, `status_code`, `error_code` |
| `ingest.turn.received` | Reserved for future ingest path | INFO | `project_id`, `provider` |
| `ingest.turn.stored` | Reserved for future ingest path | INFO | `project_id`, `provider`, `node_count` |

## Log format

- **Development** (`NODE_ENV != production`): human-readable `[ISO_TS] [LEVEL] message meta`
- **Production** (`NODE_ENV=production`): newline-delimited JSON `{ level, ts, message, meta: { telemetry: true, event, ... } }`

All telemetry lines have `meta.telemetry = true` so log aggregators can filter on it.

## Filtering (example — Datadog / CloudWatch Insights)

```
# CloudWatch Logs Insights — all failed events
fields @timestamp, @message
| filter @message like 'WARN' and @message like '"telemetry":true'
| sort @timestamp desc
| limit 50
```
