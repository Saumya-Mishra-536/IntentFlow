# Implementation Checklist

## Backend
- [x] Add onboarding module with auth-protected endpoints.
- [x] Add `GET /api/onboarding/context`.
- [x] Add `POST /api/onboarding/bootstrap`.
- [x] Resolve/create tenant from authenticated user context.
- [x] Create initial project only when no existing tenant-scoped projects.
- [x] Extend extension auth exchange response with `onboarding_context`.

## Web
- [x] Add onboarding API methods in shared auth client.
- [x] Update onboarding page to use bootstrap flow.
- [x] Keep existing card/form UI patterns and action styles.
- [x] Redirect user to suggested project when onboarding already completed.

## Extension
- [x] Keep workspace source-of-truth server-side only.
- [x] Add web-onboarding fallback action when no projects exist.
- [x] Keep existing dashboard visual language and interaction style.

## E2E Validation Checklist
- [x] Backend/web/extension build passes after integration.
- [ ] Manual happy-path run: new user signs in, bootstraps onboarding, lands on usable project.
- [ ] Manual connect-path run: extension exchange reflects same workspace/project context.
- [ ] Manual failure-path run: onboarding retry UX for invalid domain/network error.
- [ ] Manual cross-surface consistency check: project created on web appears in extension dashboard.
