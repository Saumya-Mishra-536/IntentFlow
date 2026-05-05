# API/UI Status Contract

## Status Endpoint
- `GET /api/projects/:project_id/suggestions/runs/:generation_run_id/status`
- auth required
- tenant/project scoped server-side

## Response Shape
```json
{
  "success": true,
  "data": {
    "generation_run_id": "run_uuid",
    "status": "queued",
    "error_message": "optional",
    "started_at": "optional_iso",
    "finished_at": "optional_iso",
    "updated_at": "iso"
  }
}
```

## UI Expectations
- `queued`: show spinner + "Queued"
- `running`: show in-progress
- `retrying`: show retry hint
- `failed`: surface message + retry action
- `completed`: load generated prompts and insights
