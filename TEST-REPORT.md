# Body OS Test Report

> 2026-09-08: Previous overall PASS is withdrawn. Full business-flow and visual regression remain incomplete. Runtime Mock AI and simulated device adapters have been removed; real AI integration remains unverified (superseded by the 2026-10-05 entry below). The initializer now creates only a local account; existing database records still require provenance review.

## 2026-10-05: Real Zhipu AI end-to-end verification — passed

- Environment: Node v24.13.1 (`typeof fetch === 'function'`), PostgreSQL via Docker container `bodyos-pg`, server on localhost:3000, real `glm-4.6` via the Anthropic-compatible endpoint.
- The previous `ZHIPU_API_KEY` in `server/.env` was rejected by Zhipu on both the Anthropic-compatible and native v4 endpoints (`1000 身份验证失败`); it was replaced with a working key.
- All 5 AI endpoints returned HTTP 200 with real model output:
  - `POST /ai/food/parse` — 3 recognized items (牛肉面/鸡蛋/黄瓜) with nutrition computed from the local food DB, overall confidence 0.95.
  - `POST /ai/activity/parse` — 跑步 35 min / 368 kcal, confidence 0.8.
  - `POST /ai/daily-analysis` — honest empty-data report for today (no fabricated values).
  - `POST /ai/weekly-analysis` — score 0 with explicit data-gap issues; notes the missing active goal.
  - `POST /ai/chat` — full coaching reply including the required confidence marker (0.4, data-limited).
- Fixes made during verification (`src/ai/zhipu.ts`):
  1. Error responses no longer discard the provider error body; `身份验证失败` etc. now reaches the client message.
  2. `thinking: { type: 'disabled' }` is sent on every call — glm-4.6 emits thinking blocks by default and exhausted `max_tokens` before any text, producing `智谱返回为空`.
  3. The empty-text error now includes `stop_reason` for diagnosis.
- Stale `AI_MOCK` entry removed from `server/.env` (no longer read anywhere).
- The 2 temporary coach-chat rows created by the chat test were deleted; `aIConversation` is back to 0 rows.
- Server `npm run typecheck` clean; 31/31 tests pass.
- Still unverified: real device/sync adapters (registry remains empty) and the WeChat mini-program runtime.

Date: 2026-09-06

## Automated checks

- Server TypeScript build: passed.
- Server engine tests: 12/12 passed. Coverage includes BMR, TDEE, energy totals, confidence, weight trend, goal progress, calorie range, activity/recovery/energy/body scores, nutrition targets, and AI weekly fallback routing.
- H5 production build: passed with webpack 5.88.2. The only warning is the existing 374 KiB entrypoint size advisory.

## API checks

- 11 read endpoints returned HTTP 200: health, me, profile, goals, food logs, activities, daily summary, trends, data sources, chat history, and analytics metrics.
- Food log create/update/delete passed; the test record was deleted.
- Activity create/update/delete passed; the test record was deleted.
- AI food parse, activity parse, daily analysis, weekly analysis, and coach chat returned HTTP 200 in local Mock mode.
- The temporary coach-chat test rows were deleted after verification.

## Browser regression

- Loaded all 10 visible pages at 375 × 812: Home, Record, Food, Exercise, Trends, Weekly Report, AI Coach, Data Sources, Profile, and Goal Setup.
- Verified Quick Record redirects to Record.
- No route produced a React runtime-error overlay.
- Verified bottom navigation links for Home/Record/Trends/Profile and the center `+` action.
- Verified Record → Food, Food manual entry, Exercise manual entry, Trends Data view, Profile edit sheet, Profile → Goal Setup, goal/duration selection, and data-source actions.
- Verified Weekly Report renders score, wins, and actions after correcting Mock AI task routing.

## Known non-blocking items

- Production H5 entrypoint is approximately 374 KiB and exceeds webpack's default recommendation.
- Mock fallback is no longer supported. Missing or failing model credentials must produce errors; they must not produce substitute health records or AI replies.

Final result: passed
