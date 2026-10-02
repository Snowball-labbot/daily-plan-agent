# 0.8 验证记录

日期：2026-10-02。

- `pnpm check`：类型检查、218 项测试、Host 与 Web client 构建全部通过。
- 原生 DSH 兼容：8 个工具、10 张表、domain version 1、原生 RPC 错误信封通过。
- `scripts/verify-editable-preview.ts`：待应用建议重开恢复，微调名称/备注/真实分钟，将弹性任务指定时段，撤下冲突旧安排；只调用一次模拟模型。
- `scripts/verify-estimated-planning.ts`：空结束时间与字符串训练建议规范化，估算时间可编辑，应用后保留输入区和模式，跨周重新加载恢复后续安排，第二段描述更新旧日程且不重复；共两次模拟模型调用。
- 单元验证还覆盖：估算避开锁定时段，明确时间不偷偷移动，已过去的暂定开始移到当前分钟之后，中文“下午六点半”补全，晚上活动不挪到早上，实际训练次数缺失不会生成成绩。

浏览器使用 Edge headless 与真实 React/RPC/业务服务，存储为隔离的内存 fixture；没有写用户正式数据、没有调用真实 Agnes API，没有重启用户的 DSH。

新版界面截图：

- `output/playwright/agnes-estimated-preview.png`
- `output/playwright/agnes-estimated-applied.png`

构建产物已更新到 `lib/`；宿主业务逻辑需重新加载插件后生效。云端登录、PWA 与 iPhone/Watch 是设计方案，本轮未部署。三端真实同步与 HealthKit 授权需实施后在配对真机验收。
