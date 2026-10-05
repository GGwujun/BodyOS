# Home Design QA

## 2026-09-09 小屏资料弹窗遮挡修复

- 375×600 实测身体资料弹窗“取消”被原生底栏遮挡：页面层级 0，底栏 500，弹窗自身 1000 无法逃离页面层叠上下文。
- H5 原生标签页仅在个人页直系 `.mask` 打开时提升至 501，关闭后恢复原始层级。不影响未打开弹窗的其他页面。
- 截图：`.design-qa/profile-modal-small-sept9.png`。浏览器复查取消可见且能关闭弹窗；本轮未提交身体数据。小程序及其他弹窗仍未由此覆盖验证。
- 整体 final result: blocked（完整产品验收未完成）。

## 2026-09-09 根标签页高度修复

- 浏览器定位到 `.screen` 的 `min-height:100vh` 超过原生底栏上方容器 50px，空页面产生无意义滚动。
- H5 根标签页改为 `min-height:100%`、border-box，并去除重复的自定义导航占位；二级页的固定底栏避让保持原样。
- 修复后实测内容和父容器 clientHeight/scrollHeight 相等。手机复查截图：`.design-qa/trends-height-sept9.png`。其他长内容页和小程序端仍需继续验收。
- 整体 final result: blocked，不能由此推断全项目视觉一致。

## 2026-09-09 趋势页布局增量检查

- 参考：`design/00-视觉方向总览.png`（1536×1024，第 06 屏）。实现：`.design-qa/trends-layout-sept9.png`（375×812 CSS 手机视口）。两图在同次比较输入中打开；参考为缩小画板、实现为空数据状态，未宣称像素级一致或有数据曲线已验收。
- 修复前：额外大标题、图表卡片边框和趋势下的统计卡改变了参考的信息层级；自定义按钮明显窄于其他范围按钮。
- 修复后：去除额外标题和图表卡片外框，四个范围等宽；统计卡保留在“数据”标签。真实空数据保留破折号和空状态，不补设计示例曲线。
- 字体：沿用项目字体，参考缩小图无法充分证明字重及光学大小一致，待聚焦比对。布局：上述层级问题已改善，右侧非必要滚动条仍需检查。颜色：主内容背景改白，绿色沿用现有 token，未作精确采样验收。图像：此屏无新增位图资产；有数据图表尚未视觉验收。文案：保留真实空状态，不复制 74.8 等示例数值。
- 浏览器已检查“数据”标签展示统计及每日评分；前端类型检查通过。完整布局、底栏图标匹配和有数据状态仍未通过验收。
- final result: blocked（视觉验收未完成；不表示开发任务无可继续工作）。

## 2026-09-08 二级页导航修复

- 增加共享二级页底栏，根 Tab 页面保持原生底栏，目标设置页不显示底栏。图标使用已安装的 Taroify 图标库。
- 375×812 浏览器截图：`.design-qa/data-sources-navigation-sept8.png`，底栏已可见，含首页、记录、添加、趋势、我的五个入口。
- 已实测：数据来源→趋势内容渲染；趋势→首页；首页身体状态→趋势；饮食页添加记录→记录中心。
- 测试曾发现根页面重复导航，已修复并通过 DOM 确认趋势页仅有原生导航。热更新期间出现 webpack runtime 错误，完整重载后上述路径正常。
- 前端类型检查通过。完整视觉、全部页滚动遮挡、全部导航与小程序原生运行仍未验收，整体 final result: blocked。

## 2026-09-08 数据来源页面增量检查（优先于旧结论）

final result: blocked

- 视觉依据：`design/00-视觉方向总览.png`，1536×1024，总览右下数据来源面板。`design/screens/08-Data-Sources.png` 中文缺字且布局不同，不代替用户指定总览。
- 当前截图：`.design-qa/data-sources-sept8.png`，375×812 CSS 视口，截图375×812；总览面板未做等密度裁切，不宣称像素级对齐。
- 比较输入：总览和当前截图在同一轮工具输出中打开。仅做整体与可读标题/列表检查，等比例细节图与控制台检查待补。
- 当前状态：真实接口返回所有适配器 unavailable；微信存在旧连接。设计稿是部分来源已连接状态，禁止为了匹配示例而伪造连接/时间。
- 字体：标题改为左对齐，来源名称/状态使用独立样式类；小字及字体度量仍需对照。
- 布局：[P1] 设计稿有底部导航，当前375×812截图中没有；[P2] 旧连接附加操作增加第一行高度，来源列表及整体密度仍不同。
- 色彩：白卡、浅灰底、绿色微信和红色健康图标已应用，尚未逐项采样验收。
- 素材：[P2] 小米/华米仍用通用连接图标；设计稿其他平台品牌图标和真实接入尚缺。
- 文案与数据：不展示假同步时间；显示暂未接入及原因，旧连接可经确认断开。来源集合尚未与总览完全一致。
- 交互证据：点击查看说明显示后端不可用原因；清除旧连接弹出确认；取消后入口仍存在。未执行真实授权/同步，也未删除健康记录。
- 回归：服务器测试与前后端类型检查通过。上述结果不证明全业务或全视觉完成。
- 下一轮：修复底部导航可见性，补充等比例对照，继续真实来源集成与图标资产。

> 2026-09-07: Overall completion is not established. Earlier PASS statements covered limited screenshots and are superseded by the ongoing interaction and fidelity audit.

## Ground truth

- Source: `E:\gwj\BodyOS\design\00-视觉方向总览.png`
- Home reference crop: `E:\gwj\BodyOS\.design-qa\home-reference-normalized.png`
- Implementation: `E:\gwj\BodyOS\.design-qa\home-implementation-final.png`
- Side-by-side evidence: `E:\gwj\BodyOS\.design-qa\home-comparison-final.png`

## Capture state

- Route: `http://localhost:10086/#/pages/home/index`
- Viewport: 375 × 812 CSS px
- Reference board: 1536 × 1024 px; Home artboard cropped from the overview and normalized for comparison.
- State: live seeded daily-summary data on 2026-09-06. Numeric differences from the static mockup are expected.

## Comparison history

1. P1 — The first implementation compressed the status score into a horizontal block. Fixed by restoring the large centered ring and placing the trend beneath it.
2. P2 — The first implementation included an extra quick-actions panel absent from the selected design. Removed.
3. P1 — Reusing the Record route for the center tab caused Taro H5 to collapse the navigation to four items. Fixed with a dedicated quick-record tab route that forwards to Record.
4. P2 — Native tab items had empty image placeholders. Fixed by loading the project icon font and styling all five states, including the green center action.

## Final findings

- PASS — No open P0/P1/P2 fidelity issues in the selected Home screen.
- P3 — The compact status trend uses a bar sparkline rather than the reference line sparkline.
- P3 — Browser scroll chrome and the desktop preview's lack of a mobile OS status bar differ from the static device mockup.
- P3 — Live data naturally changes score, calories, activity, and goal progress relative to the reference.

## Verification

- Five bottom navigation items are visible: 首页、记录、+、趋势、我的.
- The center `+` action was clicked and resolved to `#/pages/record/index`.
- Frontend returned HTTP 200.
- Backend `/health` returned HTTP 200 with `{ "status": "ok" }`.
- `npm run build:h5` completed successfully with webpack 5.88.2; only the existing 374 KiB entrypoint-size warning remains.

## Final result

PASS

---

## Secondary navigation pages — 2026-09-06

### Evidence

- Record reference: `E:\gwj\BodyOS\.design-qa\record-reference.png`
- Trends reference: `E:\gwj\BodyOS\.design-qa\trends-reference.png`
- Profile reference: `E:\gwj\BodyOS\.design-qa\profile-reference.png`
- Implementations: `record-implementation-final.png`, `trends-implementation-final.png`, and `profile-implementation-final.png` in `.design-qa`.
- Combined source/implementation comparison: `E:\gwj\BodyOS\.design-qa\secondary-pages-comparison.png`
- Viewport: 375 × 812 CSS px; live seeded API data.

### Findings and fixes

1. P1 — The Record page used emoji-based shortcut tiles and did not match the reference hierarchy. Replaced with three full-width icon-library entry cards and a separated automatic-data section.
2. P1 — The Trends canvas received missing H5 dimensions and threw a non-finite gradient error. The shared chart now falls back to its declared dimensions; browser reproduction no longer errors.
3. P2 — The Trends page lacked the reference's three-section navigation and compact time filters. Added functional Trend/Data/Analysis sections and 7/30/90-day filters.
4. P2 — The Profile page lacked the green identity header and summary metrics. Added the reference-aligned hero, three statistics, grouped settings, and retained functional editing.

### Interaction verification

- Record → 饮食记录 resolves to `#/pages/food/index`.
- Trends → 数据 shows the daily Body Score view.
- Profile → 身体数据 opens the existing profile-edit sheet.
- All pages retain the five-item bottom navigation with the correct selected state.
- No runtime-error overlay appeared after the final captures.

### Remaining P3 notes

- Record's automatic-source names and states reflect the backend's live providers rather than the static mock data.
- Profile uses the icon-library user avatar because no production user portrait is available.
- The responsive canvas line is slightly more geometric than the hand-tuned reference curve.

### Final result

PASSED

final result: passed

---

## Final UI coverage — 2026-09-06

- Added and verified the missing Goal Setup screen from frame 01.
- Rebuilt Data Sources to match frame 09 and connected its connect, resync, and disconnect actions.
- Verified all 10 visible screens plus the Quick Record redirect at 375 × 812.
- Final comparison for the two last screens: `.design-qa/remaining-pages-comparison.png`.
- No open P0/P1/P2 visual defects remain. Live provider availability and user-generated data remain P3 differences from the static board.

final result: passed

---

## Feature pages — 2026-09-06

### Scope and evidence

- Source frames: Food 04, Exercise 05, Weekly Report 07, and AI Coach 08 in `design/00-视觉方向总览.png`.
- Captures: `.design-qa/food-implementation-final.png`, `exercise-implementation-final.png`, `weekly-report-implementation-final.png`, and `ai-coach-implementation-final.png`.
- Viewport: 375 × 812 CSS px with live backend state.

### Resolved findings

1. P1 — Food and Exercise used generic stacked forms with emoji actions. Replaced with source-aligned custom headers, mode tabs, icon-library actions, focused input cards, and structured result/history sections.
2. P2 — AI Coach lacked the reference identity header and conversational hierarchy. Added the coach intro, compact assistant/user bubbles, quick prompts, and persistent input treatment while preserving message history and send logic.
3. P2 — Weekly Report used generic cards. Added the blue score hero, key metrics, wins/issues, and AI action sections for successful responses.
4. P1 — The live weekly AI endpoint currently returns HTTP 500. No report content was fabricated; the failed response now renders a polished, actionable retry state without a runtime error.

### Interaction verification

- Food → 手动添加 exposes editable food-name and calorie inputs.
- Exercise → 手动记录 exposes type, duration, and calorie controls.
- Weekly Report failure state exposes a working 重新生成 action.
- Four final browser captures contain no React runtime-error overlay.
- Frontend and backend health endpoints returned HTTP 200.
- `npm run build:h5` completed with exit code 0; only the known 374 KiB entrypoint warning remains.

### Remaining P3 notes

- Weekly Report cannot display a real score until its AI provider succeeds.
- The production food-recognition result state depends on user input or a selected photo and therefore is not shown in the initial capture.
- Exercise history is longer than the static reference because the live database contains 20 activities.

### Final result

final result: passed
