# Body OS 后端(Express + Prisma + PostgreSQL)

## 运行环境注意

后端 AI 请求依赖 Node 内置 `fetch`，不要使用 Node 16 启动。当前本地已使用 Node 24.19.0 运行并通过后端测试。启动前运行 `node -p "typeof fetch"`，必须输出 `function`。

2026-09-09 核查发现默认 `D:/nodejs/node.exe` 是 Node 16，导致真实 AI 请求在发出前就失败。当前开发后端临时使用机器已有的 Codex Node 24；该路径属于本机工具运行时，不作为部署依赖。正式环境需要独立配置兼容的 Node 运行时。

目前外部数据源接入和 AI 成功端到端调用仍需验证（见根目录 TEST-REPORT.md 与 design-qa.md）。

## 当前状态(2026-10-05)

- 业务端点已全部接入 Prisma 数据层与计算引擎(BMR/TDEE/BodyScore/营养/目标进度)，不再是 mock。
- 智谱 GLM 接入代码在 `src/ai/`；真实 key 的端到端调用尚未验证。
- `src/sync/adapters/` 为空：数据源注册表(`src/sync/registry.ts`)无任何真实适配器，所有 provider 显示"暂未接入"。接入方案见 `tech/03-自动同步设计.md`。
- 单用户模式：`src/lib/currentUser.ts` 硬编码 `userId`，无认证。接入微信登录时需替换为 JWT/session 解析。
- 修改源码后请 `npm run build` 重建 `dist/`（本目录 dist 曾残留已删除源码的编译产物，2026-10-05 已清理重建）。

## 目录结构

```
server/
├── prisma/            # schema、迁移、seed(仅初始化本地账号，不生成健康数据)
├── scripts/           # 数据审计 / 本地测试数据重置 / 目标不变量校验
└── src/
    ├── index.ts       # Express 入口
    ├── env.ts         # 环境变量(ZHIPU_API_KEY 等)
    ├── db.ts          # Prisma Client
    ├── ai/            # 智谱 GLM 调用、提示词、教练对话、食物识别
    ├── engine/        # 计算引擎：能量、评分、营养、目标、数据可用性
    ├── lib/           # 日期、分页、档案校验、趋势窗口等工具
    ├── routes/        # me/profile/goals/food/activity/body/summary/trends/analytics/dataSources/ai
    └── sync/          # 数据源适配器注册表与同步服务(适配器待实现)
```

## 开始

```bash
cd server
cp .env.example .env      # 填入 DATABASE_URL 与智谱 API Key
npm install
npx prisma migrate dev --name init   # 建表
npm run db:seed                     # 仅初始化本地账号，不生成健康数据、不覆盖已有资料
npm run dev               # http://localhost:3000,健康检查 /health
```

需要本机有 PostgreSQL。若用 Docker:`docker run --name bodyos-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=bodyos -p 5432:5432 -d postgres:16`。

## 测试与校验

```bash
npm test          # engine + trends + body 路由测试(tsx --test)
npm run typecheck
```

## AI 端点

| 端点 | 说明 |
|------|------|
| `POST /api/v1/ai/food/parse` | 文本/图片 → 食物条目 + 营养估算 |
| `POST /api/v1/ai/activity/parse` | 自然语言 → 运动条目 + 消耗估算 |
| `POST /api/v1/ai/daily-analysis` | 今日数据 → 结论/依据/行动 |
| `POST /api/v1/ai/weekly-analysis` | 本周数据 → 评分/Wins/Issues/行动 |
| `POST /api/v1/ai/chat` | 教练对话(带用户上下文) |

## 待办

1. 真实智谱 key 端到端验证(Node ≥ 18 环境)。
2. 数据源真实适配器(微信运动优先)，见 `tech/03-自动同步设计.md`。
3. 用户认证(微信登录)，替换硬编码 userId。
