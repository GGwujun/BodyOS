# Body OS 后端(Express + Prisma + PostgreSQL)

## 运行环境注意

后端 AI 请求依赖 Node 内置 `fetch`，不要使用 Node 16 启动。当前本地已使用 Node 24.19.0 运行并通过后端测试。启动前运行 `node -p "typeof fetch"`，必须输出 `function`。

2026-09-09 核查发现默认 `D:/nodejs/node.exe` 是 Node 16，导致真实 AI 请求在发出前就失败。当前开发后端临时使用机器已有的 Codex Node 24；该路径属于本机工具运行时，不作为部署依赖。正式环境需要独立配置兼容的 Node 运行时。

下文旧描述不代表完整功能已验收；目前外部数据源接入和 AI 成功端到端调用仍需验证。

完整业务实现:Prisma 数据层、计算引擎(BMR/TDEE/BodyScore)、智谱 GLM 接入、自动同步(去重/幂等/cursor)。

## 目录结构

```
server/
├── src/
│   ├── index.ts        # Express 入口
│   ├── env.ts          # 环境变量
│   ├── ai/
│   │   ├── zhipu.ts    # 智谱 GLM 调用(Bearer 鉴权 + JSON 解析)
│   │   └── prompts.ts  # 食物/运动解析、每日分析、周报、教练对话
│   └── routes/
│       ├── ai.ts       # /api/v1/ai/* 智谱代理(已实现)
│       └── index.ts    # 业务端点(暂 mock,待接 DB)
└── .env.example        # 复制为 .env 并填入 ZHIPU_API_KEY
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

## 已实现的 AI 端点

| 端点 | 说明 |
|------|------|
| `POST /api/v1/ai/food/parse` | 文本/图片 → 食物条目 + 营养估算 |
| `POST /api/v1/ai/activity/parse` | 自然语言 → 运动条目 + 消耗估算 |
| `POST /api/v1/ai/daily-analysis` | 今日数据 → 结论/依据/行动 |
| `POST /api/v1/ai/weekly-analysis` | 本周数据 → 评分/Wins/Issues/行动 |
| `POST /api/v1/ai/chat` | 教练对话(带用户上下文) |

## 下一步

业务端点(`/me`、`/food-logs`、`/activities`、`/daily-summary` 等)目前返回 mock。按 README 建议开发顺序,下一步应接入数据库与计算引擎(`tech/02`)。
