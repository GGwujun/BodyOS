# Body OS 小程序(Taro + React + TypeScript)

微信小程序前端,对应设计包 `docs/01` 的 9 个核心页面与 `tech/01` OpenAPI 草案。

## 目录结构

```
app/
├── config/              # Taro 构建配置
├── project.config.json  # 微信开发者工具配置
├── src/
│   ├── app.tsx / app.config.ts / app.scss   # 应用入口与 TabBar
│   ├── config/          # 运行时配置(apiBase)
│   ├── constants/       # 路由常量
│   ├── components/      # 通用组件(Screen 等)
│   ├── styles/          # 视觉 token(variables / mixins / global)
│   ├── services/        # 请求封装 + 各模块 API(对接 OpenAPI 草案)
│   └── pages/           # 9 个页面(home/record/food/exercise/trends/weekly-report/ai-coach/data-sources/profile)
└── ...
```

## 开始

```bash
cd app
npm install
npm run dev:weapp        # 编译到 dist/,用微信开发者工具打开 app 目录
```

> 开发者工具 → 项目 → 目录指向 `app/`,AppID 填你自己的或测试号。
> 请求默认指向 `http://localhost:3000`(本地后端),开发期在开发者工具关闭「域名校验」即可。

## 与后端的对接

`src/config/index.ts` 的 `apiBase` 指向 `../server`。AI 调用(`/ai/*`)经后端代理转发到智谱,API Key 不暴露在小程序包内。
