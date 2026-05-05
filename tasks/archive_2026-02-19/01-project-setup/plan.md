# Project Setup Plan

## Objective
Set up a monorepo structure for the AI SEO project with three applications: a web app, a Chrome extension, and a backend API.

## Naming Convention
- Use `snake_case` consistently for schema fields, API payload keys, storage keys, and identifiers wherever practical.

## Structure
```
ai-seo/
├── tasks/
│   └── 01-project-setup/
│       ├── plan.md (this file)
│       └── progress.md
├── backend/
│   └── (Node.js + TypeScript + Express + Prisma)
├── web/
│   └── (React + TypeScript + Vite)
└── extension/
    └── (React + TypeScript + Vite + CRXJS)
```

## Applications

### Web Application
- **Framework**: React 19
- **Language**: TypeScript
- **Build Tool**: Vite 6
- **Package Manager**: pnpm

### Extension Application
- **Framework**: React 19
- **Language**: TypeScript
- **Build Tool**: Vite 6 + CRXJS Plugin
- **Extension Type**: Chrome Extension (Manifest V3)
- **Package Manager**: pnpm

### Backend Application
- **Runtime**: Node.js 20+
- **Language**: TypeScript
- **Framework**: Express
- **ORM**: Prisma + PostgreSQL
- **Auth**: JWT + OAuth handoff for extension
- **Package Manager**: pnpm

## Installation Steps
1. Navigate to each app directory (`backend`, `web`, and `extension`)
2. Run `pnpm install` to install dependencies
3. Run `pnpm dev` to start development server

## Development Commands
- **Web App**: `cd web && pnpm dev`
- **Extension App**: `cd extension && pnpm dev`
- **Backend API**: `cd backend && pnpm dev`

## Backend Setup
1. Configure `.env` in `backend/`:
   - `PORT`, `NODE_ENV`, `DATABASE_URL`, `JWT_SECRET`
   - `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL_DAYS`
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
   - `OAUTH_DEFAULT_EXTENSION_REDIRECT_URI`
2. Generate Prisma client: `cd backend && pnpm prisma:generate`
3. Apply schema to DB: `cd backend && pnpm prisma:push` (or `pnpm prisma:migrate`)
4. Run API: `cd backend && pnpm dev`

The extension will build to a `dist/` directory that can be loaded as an unpacked extension in Chrome.
