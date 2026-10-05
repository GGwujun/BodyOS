# Body OS｜开发交付规范 v0.3

## 设计基准
- 设计宽度：375px
- 页面左右 padding：16px
- 8pt spacing system
- 触控区域建议 ≥44px
- 底部导航需考虑安全区

## 组件原则
所有页面优先使用 Design Token，不允许业务页面随意定义品牌色。

## 状态
每个异步组件必须至少覆盖：
- normal
- loading
- empty
- error

AI 组件额外覆盖：
- processing
- need_confirm
- success

数据源组件额外覆盖：
- disconnected
- connecting
- syncing
- synced
- error

## 数据展示
- kcal、g、kg、min 等单位与数字保持稳定间距
- 估算值必须显示“估算”
- 数据来源必须可追溯
- 不要把第三方设备数据伪装成 Body OS 原生测量

## AI
AI 输出前端必须基于结构化 schema 渲染，不直接渲染不可控 Markdown 作为核心 UI。

## 小程序
建议建立：
- `/components`
- `/pages`
- `/services`
- `/store`
- `/utils`
- `/styles/tokens`
- `/styles/components`
