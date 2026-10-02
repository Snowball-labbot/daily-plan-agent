# dsh-daily-plan · 每日计划

DSH Desktop 原生插件，连接周目标、今日计划、学习、健身与复盘，减少日常决策。

0.9 新增个人云端后端、手机 Web 与 iPhone/Watch 配套源码。手机使用白底紧凑时间轴和专用 Agnes 工作页；后台任务与幂等写入支持页面关闭后恢复，电脑可连接相同账号。部署、迁移与恢复见 [部署指南](DEPLOYMENT.zh-CN.md)，当前验收范围见 [实施状态](IMPLEMENTATION-STATUS.zh-CN.md)。Watch 仍需 Mac/Xcode 真机验证。

0.6 使用单层导航和纯白底，日计划左侧显示时间，右侧用明亮分类的浅色条目显示事项。周表完整显示全部节次，课表同步操作收入菜单；训练保留动作库、插入提示和拖动动画，组次与重量在原行修改。训练进步和组数明细放在「记录 → 训练记录」。

日计划下方直接写近况并点「整理并安排」，会打开 Agnes 并提交一次联动请求，无需再次复制或提交。顶部「告诉 Agnes」也可进入当天、近几天、整周、训练和学习复盘。写作窗口减少外围信息，扩大输入区域；整理成功后保留连续输入入口，显示主要变更、当前后续安排及可展开的完整记录。日计划会显示已持久化的执行结果和记住的偏好。API 失败时原文保留，可重新打开继续。

联动由用户提交或明确调用工具触发；本插件不会在后台自行发起 AI 请求。个性化来自已保存的偏好、历史反馈与执行记录，不是训练新的模型。

0.6.1 将整理结果改为「已记录 / 接下来」：左侧是实际保存的更新，右侧是当前未来日程的任务与时间，记忆单独显示；原文、完整日志和建议收入展开项。结果不再平铺重复统计、零项提示和四组导航。

0.7.0 新增「告诉 Agnes → 展望」，可选择接下来两周、明天、下周或指定日期（未来 31 天内）。说出活动日期及起止时间，Agnes 会把明确约定写进日程；弹性目标加入任务池，按容量安排并避开这些约定。活动保留具体分钟；0.8起时间缺失可形成标为暂定的估算时段，不记成已完成，也不因漏打勾自动顺延。复盘也可同时说明未来安排，回顾区间和展望区间独立保存。

0.7.1 修复 DSH RPC 错误响应漏掉 `details`，导致真实原因被 `invalid server-response failure` 遮住的问题。新增待应用条目的直接微调：名称、备注、日期和起止时间可改，弹性任务可指定时段，无需再次调用 AI；手动修改保留依据。默认「以这次描述为准」移开冲突的旧个人安排，保留旧目标；固定课表和已完成事实不覆盖。0.8起结束时间无原文依据时显示可编辑的暂定时段，不把模型预估当实际执行数据。重开窗口可恢复未应用的建议。

0.8.0 支持理解未来活动的模糊时段、先后顺序与“可能参加”：Agnes 先估算完整时段，标明依据，预览可微调；服务避开固定/完成/已开始记录，并保留本次描述优先的策略。修复空结束时间和字符串训练建议导致的模型格式错误。应用后仍可继续输入，当前后续日程和跨周展望在重新打开后保持联动。实际完成、次数和重量仍只按明确证据记录。三端部署路线见 [电脑、手机与 Apple Watch 改造路径](MULTI-DEVICE-ROADMAP.zh-CN.md)，云端和手表尚未部署。

0.8.1 按普通日程展示推算时间，界面不加“暂定”标签。统一入口改为固定工作台：输入框、安排列表和底部三个按钮在生成、应用和修改前后保持位置；应用后不切换结果页。已保存的未来活动可在原列表修改名称、时间、日期和备注并保存，不再次调用模型、不重放执行或训练事实；已开始/完成记录及重叠时段受保护。完整日志与建议收在展开项中。

2026 中国假期已按国办发明电〔2025〕7号核对，默认跳过放假日的普通课程。调休上班不猜学校补课；在「设置 → 节假日与校历」填写补课星期或停课日期。手动安排、固定约定、已完成和过去的课程事实保留；其他年份需另外核对。

文字复盘作为统一入口：选择当天、近两天或近一周，点「让 Agnes 整理并调整」，补记执行、学习和训练，维护任务池、更新有依据的个人记忆并调整未来日程。保留工作与学习、健康、人际关系的分类联动；未打勾保持未确认，训练进步只取实际组记录。

默认每日最多 3 个弹性任务、180 分钟容量、25% 机动比例；训练周目标由用户开启，默认 0。旧日记录与现有数据兼容。

完整机制、使用示例、边界与验证方式见 [工作流说明](WORKFLOW.zh-CN.md)。

## 技术形态

- **全屏覆盖层**，注册进 DSH 官方的 `shell.overlay` 槽位。**不启 iframe、不跑本地服务、不开端口。**
- 前端是**原生 React 组件**（TSX → esbuild 打成单个 `lib/client.js`），自动跟随 DSH 明暗主题。
- Host ↔ Renderer 只走 `ctx.connection.rpc`（通道 `/dsh-daily-plan`）。
- 数据落在 `ctx.storageDomain`（`~/.dsh/storages/dsh_daily_plan/`），**一记录一文件**，可直接阅读和备份。
- 复盘用 **Agnes**（`agnes-2.5-flash`），借 DSH 自己的 agent 运行时，插件不持有任何密钥。

## 拖拽与键盘

两处拖拽（周计划的待安排池 → 网格、健身的动作库 → 当天训练）都是**手写的 Pointer Events 引擎**，
零依赖，见 `src/client/drag/DragLayer.tsx`。两条设计规则：

1. `pointermove` **绝不触发 setState** —— 只直接改 ghost 的 transform，仅在「命中的落点变化时」才发布状态。
   否则 98 格的周网格会一秒重渲 60 次。
2. 落点声明写在 DOM 上（`data-drop` / `data-drop-meta` / `data-drop-accept`），
   所以整张网格是零注册的，页面只装一个 handler。

**每个拖拽都有等价的非拖拽路径**（无障碍硬要求，也是手滑时的降级）：
周计划是「点卡片进入放置模式 → 方向键移动 → Enter 落位 → Esc 取消」，健身是「点卡片直接追加到末尾」。
拖拽结束后 300ms 内会吞掉那次 click（`draggedRecently()`），避免「放下了又顺带触发点击动作」。

## 两个已知限制

- **提醒是客户端轮询**：这个 DSH 版本没有公开的宿主→渲染层推送通道，所以提醒需要保持 DSH 打开。
  面板关着也会弹（`.dp-root--bare` 只渲染一个不拦点击的 toast）。
- **`streak` 的达标阈值默认 80%**，不是 100% —— 100% 会让成就感变成挫败感；阈值在设置里可调。
  没排计划的日子算「中立」，既不加也不断连续。

## 目录

```
src/                     Host 半（Node ESM，跑在 DSH 主进程）
  index.ts               插件入口：Config / apply / 生命周期
  domain.ts              zod 记录 schema + storage domain 定义
  service.ts             领域操作（计划、课表、健身、复盘、统计、导入导出）
  rpc.ts                 RPC 端点分派
  review.ts              Agnes 后台会话编排
  prompt.ts / parser.ts  提示词 与 marker-JSON 解析 + 纠错 + 降级
  plan.ts                空档计算 / 吸附 / 推送（纯函数）
  gym.ts                 部位轮转 / 套用上次（纯函数）
  stats.ts               热力图 / streak / 汇总（纯函数，全部派生不落盘）
  courseImport.ts        课表粘贴文本解析（纯函数）
  clock.ts / identity.ts 日期与稳定 id
  seed.ts                默认作息表 + 44 个健身动作
  types/dsh.d.ts         DSH 运行时包的 declare module 垫片

src/client/              Browser 半（TSX → 单个 bundle）
  index.ts               注册 shell.overlay + sidebar.footer.action
  runtime.ts             无依赖 mini store + RPC 封装
  styles.ts              全部 CSS（设计令牌 + 样式，注入 <style>）
  shell/                 Root / TopBar / Nav / SidebarEntry
  pages/                 Today / Week / Gym / Review / Record / Settings
  ui/kit.tsx             轻量组件
  icons.tsx              手写 SVG 图标（不用 emoji）

scripts/build.mjs        tsc 出声明 + esbuild 出双 bundle
tests/                   纯函数单测（clock / plan / gym / stats / courseImport / parser）
```

## 开发

```bash
pnpm install
pnpm check        # typecheck + test + build
pnpm test         # 纯函数单测，秒级
pnpm build        # 产出 lib/index.js + lib/client.js
```

注册到 profile：

```bash
# 在 DSH 自带终端里（dsh 不在普通 PATH）
dsh plugin --profile 投研系统 add link:D:/每日计划减少决策
```

- 改 `src/client/**` → `pnpm build` 后浏览器约 500ms 内自动重载，**不用重启 DSH**。
- 改 Host 半 → 必须重启 DSH。
- 清空数据：删掉 `~/.dsh/storages/dsh_daily_plan/`。

## 五个必须知道的坑

1. **表名只能是 `/^[a-z][a-z0-9_]*$/`** —— `gymSessions` 这种驼峰会直接抛错，必须 `gym_sessions`。
2. **`layout` 必须是 `per-record`** —— 勾一个块只重写当天约 5KB 的文件，而不是整个 MB 级域 JSON。
3. **记录 key 必须是纯 ASCII（`/^[a-zA-Z0-9_-]+$/`）** —— 存储层拿 key 当文件名，含中文的 key 会让写入直接抛错：

   ```
   unit 'dsh_daily_plan': per-record key 'x_chest_杠铃卧推' is not path-safe
   ```

   这个坑的真实后果是**功能静默变空**：内置动作库的 id 原本是 `x_chest_杠铃卧推`，44 个动作一个都没写进去，健身页只显示「0 个动作」加一个加载按钮，日志里只有一行 warn。**记录里的名字可以是中文，只有当文件名的 key 不行。** 现在由 `identity.isPathSafeKey()` 守着，并有一条单测穷举全部 44 个内置 id。
4. **读 agent 会话输出要用 `session.log`，不是 `session.events`** —— 后者在 DSH 2.0.5 **不存在**：

   ```js
   var Session = class Session {
     log = [];                                 // ← 事件日志在这里
     get seq() { return SessionLogOffset(this.log.length); }
   ```

   读 `session.events` 会抛 `events is not iterable`。因为这个异常在 try/catch 里，
   表现是 **UI 上写「AI 未完成」**，看起来像 Agnes 不干活，实际是一个属性名写错了 ——
   而且我们参考的那个插件（`dsh-cross-market-review`）里写的是同一个错。

   ```js
   const text = session.log
     .filter((e) => e.seq >= firstSeq && e.type === 'assistant/message')
     .flatMap((e) => e.data.message.content.filter((b) => b.type === 'text').map((b) => b.text))
     .join('')
   const done = session.log.some((e) => e.seq >= firstSeq && e.type === 'turn/end' && e.data.reason.kind === 'completed')
   ```

5. **永远不要为了让数据迁移而升 domain `version`** —— `per-record` 布局下升版本会**静默丢弃全部历史记录**（存储后端的注释原文：*a version bump discards stale records instead of migrating them*）。演进靠记录内的 `schemaVersion` + zod `.default()` 兜底。

## License

MIT
