# Onboarding API Contract

## GET `/api/onboarding/context`
- auth: required (`Bearer` token)
- request body: none

### response (`200`)
```json
{
  "success": true,
  "data": {
    "workspace": {
      "tenant_id": "tenant_uuid",
      "tenant_name": "acme workspace"
    },
    "needs_onboarding": true,
    "suggested_project": {
      "project_id": "project_uuid",
      "name": "example.com",
      "description": "Onboarded for https://example.com",
      "created_at": "2026-02-19T12:00:00.000Z",
      "updated_at": "2026-02-19T12:00:00.000Z"
    }
  }
}
```

## POST `/api/onboarding/bootstrap`
- auth: required (`Bearer` token)

### request (`snake_case`)
```json
{
  "domain_url": "example.com",
  "project_name": "Example",
  "project_description": "Main site onboarding"
}
```

### behavior
- resolves/creates workspace tenant for user.
- if user has no projects, creates initial project inside resolved tenant.
- returns same shape as `/context`.

### response (`200`)
- same payload shape as `GET /api/onboarding/context`.

## Extension Auth Exchange (existing endpoint, extended response)
### POST `/api/auth/code/exchange`
- response now also includes:
```json
{
  "onboarding_context": {
    "workspace": {
      "tenant_id": "tenant_uuid",
      "tenant_name": "acme workspace"
    },
    "needs_onboarding": false,
    "suggested_project": {
      "project_id": "project_uuid",
      "name": "example.com"
    }
  }
}
```
