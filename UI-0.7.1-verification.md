# 0.7.1 应用与微调验证

- 修复：原生 Connection 要求错误包含 `code/message/details`；旧插件缺 `details`，客户端因此报 `invalid server-response failure`。原生 `serverResponseSchema` 已验证新错误响应可用。
- 原问题：已保存的真实建议将未提供结束时间的饭局推测成 18:00–22:00，与 21:40 起的手动阅读重叠。只读加载记录到内存隔离副本回放，确认明确的 14:00–16:00 活动可应用，不确定饭局列为待补充。未写用户存储、未调用真实 AI、未重启用户 DSH。
- 默认最新文字优先：撤下旧的未完成个人位置，保留/重排目标；固定课表、routine 和已完成事实保护。应用重试不会重建重复目标，当前复盘补记的完成不会被撤下操作反向复活。
- 待应用条目可编辑名称、备注、日期、开始和结束时间；任务可指定时段。用户修改附加为明确的手动依据，直接保存和应用，不需要第二次 AI 调用。
- `pnpm check`：211 项测试、TypeScript 和 Host/Web 构建通过。
- `scripts/check-native-compat.mjs`：8 工具、10 表、domain version 1、原生失败响应校验通过。
- `scripts/verify-editable-preview.ts`：真实 React、真实隔离后端、一次模拟 AI 响应；浏览器修改活动到 19:30–21:00、论文到 10/05 11:00–12:00，修改名称和备注，再应用。存储分钟及文本与编辑一致，旧阅读位置撤下。通过管道浏览器验证，不依赖本地 HTTP 套接字。
- 截图：`output/playwright/agnes-editable-preview.png`、`output/playwright/agnes-edited-result.png`。
