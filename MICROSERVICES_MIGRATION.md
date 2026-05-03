# Microservices Migration Plan

This repository currently runs as a Next.js monolith with API routes.  
This guide migrates it safely using the strangler pattern.

## Target Service Split

- `auth-service`: signup, login providers, forgot/reset password, token/session concerns.
- `user-service` (phase 2): onboarding and profile preferences.
- `thread-service`: thread CRUD (title/pin/archive/delete).
- `chat-service`: AI model calls + message persistence.
- `api-gateway`: single external API entrypoint (routing, auth propagation, rate limits).
- `frontend` (existing Next.js app): UI only, no direct DB logic in final state.

## What Is Already Added

- `docker-compose.microservices.yml`
- `services/api-gateway/nginx.conf`
- `services/auth-service/server.js` with implemented signup, forgot password, and reset password endpoints.
- `services/thread-service/server.js` with implemented thread CRUD endpoints.
- `services/chat-service/server.js` with implemented chat send and message listing endpoints.
- `services/llm-service/server.js` for AI provider calls behind the chat service.
- Next.js auth route handlers now proxy to the API gateway and fall back to `AUTH_SERVICE_URL` for local development.
- Next.js thread/chat/message route handlers now proxy to the API gateway and pass the authenticated user in `x-user-id`.

These are scaffolds so you can move route logic gradually.

## Phase-by-Phase Migration

### Phase 1: Service runtime and routing

1. Start services:
   - `docker compose -f docker-compose.microservices.yml up -d`
2. Verify health:
   - `http://localhost:8080/health`
   - `http://localhost:4001/health`
   - `http://localhost:4002/health`
   - `http://localhost:4003/health`
3. Keep Next.js app as-is while services are empty scaffolds.

### Phase 2: Move auth APIs first

Completed for:
- `app/api/signup/route.ts`
- `app/api/auth/forgot-password/route.ts`
- `app/api/auth/reset-password/route.ts`

The Next.js routes are thin proxies. Configure:
- `API_GATEWAY_URL` for gateway routing, defaulting to `http://localhost:8080`.
- `AUTH_SERVICE_URL` for local direct-service fallback, defaulting to `http://localhost:4001`.

### Phase 3: Move thread APIs

Completed for:
- `app/api/thread/route.ts`

The service requires `x-user-id` on every route and scopes all reads/writes by `{ chatId, userId }`.

### Phase 4: Move chat + message APIs

Completed for:
- `app/api/chat/route.ts`
- `app/api/message/route.ts`

`chat-service` owns message persistence and calls `llm-service` through `LLM_SERVICE_URL`.
AI provider keys are loaded by `llm-service`.

### Phase 5: Data ownership boundaries

Current models:
- `models/User.ts`
- `models/Thread.ts`
- `models/Message.ts`

Recommended ownership:
- `auth-service`: `User`
- `thread-service`: `Thread`
- `chat-service`: `Message`

You can keep a shared Mongo cluster initially, then split databases later.

### Phase 6: Production hardening

- Add JWT verification at gateway + service-level auth middleware.
- Add request IDs and centralized logging.
- Add retries/timeouts/circuit breakers for inter-service calls.
- Add contract tests for every gateway route.
- Add per-service CI pipeline.

## Suggested Endpoint Mapping

- `/api/auth/*` -> `auth-service`
- `/api/thread/*` -> `thread-service`
- `/api/chat/*` and `/api/message/*` -> `chat-service`
- `/api/user/*` -> `user-service` (add in phase 2)

## Non-Goals During Initial Migration

- Full Kubernetes rollout on day 1
- Immediate database-per-service split
- Rewriting frontend pages all at once

## Next Practical Step

Implement `auth-service` fully first, then wire Next.js `app/api/auth/*` and `app/api/signup` as proxies to the gateway.
Once that is stable, repeat for thread and chat services.
