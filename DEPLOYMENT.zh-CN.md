# 个人账号、手机 Web 与三端部署

源码仓库：https://github.com/Snowball-labbot/daily-plan-agent （私有）。旧版基线：`v0.8.1-baseline`。改造分支：`feat/cloud-mobile-sync`。

## 已完成的个人数据迁移

Supabase 项目：`ykmzzeyxifzulluygmbx`（你已创建的项目，新加坡）。个人应用账号：`wu13527880029@gmail.com`。应用账号与 Supabase 控制台账号是两个登录系统。

2026-10-02 已导入 231 条记录及全局设置；云端回读完整状态的 SHA-256 与待导入状态一致，关联警告为 0。任务编号、日期、完成状态、训练记录、阅读进度、历史复盘与 Agent 原文保留。没有重跑历史建议，没有用计划重量补造训练成绩。独立学习和个人记忆仍各为 0 条。

本机原数据库没有修改。独立备份在 `.local/backups/`，迁移报告在 `.local/cloud-migration-report.json`，个人应用初始密码在 `.local/planner-account-password.txt`。这些文件均被 Git 排除。不要把密码、Token 或数据备份放进源码仓库。

## 服务器配置

`apps/web/.env.local` 已由迁移脚本写入 Supabase 配置。Agnes 密钥只能保存在服务器配置，不会传到手机或手表。

在 `.local/cloud-provision.env` 填写：

```dotenv
SUPABASE_PROJECT_REF=ykmzzeyxifzulluygmbx
SUPABASE_ACCESS_TOKEN=
VERCEL_TOKEN=
AGNES_API_KEY=
AGNES_BASE_URL=https://api.agnes-ai.cn/v1
```

Supabase Personal Access Token 在 https://supabase.com/dashboard/account/tokens 创建；`sb_secret_` 是项目服务端密钥，不能替代管理 Token。Vercel 可使用 `pnpm dlx vercel@latest login` 完成设备登录，或填写自己的 Vercel Token。不要把密钥发到聊天。

当前账号使用 Agnes 国内站，对应 `https://api.agnes-ai.cn/v1`；国际站对应 `https://apihub.agnes-ai.com/v1`。部署脚本读取 `AGNES_BASE_URL`，不会因 401 自动轮换服务线路。

```powershell
pnpm install --frozen-lockfile
node scripts/build-cloud.mjs
pnpm cloud:provision --import-backup
```

重复执行同一份备份时使用迁移收据跳过，不新增副本；目标已有不同内容会停止。首次导入是数据库事务，关联校验未通过时不切换电脑同步。

## Vercel 发布

部署目标是你的 Vercel Hobby 团队，新项目名称 `daily-plan-agent`，Root Directory 为 `apps/web`，Node 为 22，连接上述 GitHub 私有仓库。脚本不会升级付费方案。

`apps/web/vercel.json` 将函数设在新加坡 `sin1`，靠近同区域的 Supabase 数据库；只使用一个区域。

当前可测试的固定分支网址：[个人计划预览](https://daily-plan-agent-git-feat-cloud-mo-1649da-wus-projects-9aa55391.vercel.app)。该网址保留手机缓存所在的域名，适合首轮手机测试；仅发布预览，main 尚未合并。预览站显示应用自己的登录页，个人记录仍由后端账号校验与 RLS 隔离。

```powershell
git push -u origin feat/cloud-mobile-sync
pnpm cloud:provision --deploy
```

脚本先创建项目、写入加密服务器环境变量，再提交功能分支预览部署。预览验证后才发布 main。上线报告中需要记录代码提交、数据库 schema 版本、迁移校验和。

如果使用 Vercel 控制台手动导入，设置：

- Install Command：`corepack enable && pnpm install --frozen-lockfile`
- Build Command：`pnpm run build`
- Root Directory：`apps/web`
- Environment Variables：复制本机 `.env.local` 的服务器配置，覆盖 Preview 与 Production；不用 `NEXT_PUBLIC_` 前缀。

Agnes 未配置时，日程、训练及学习可以读取和编辑；生成 AI 安排会明确提示缺少密钥，不伪造成功。

## 电脑与手机

手机打开预览 HTTPS 网址，用个人应用账号登录；iPhone Safari 的分享菜单可添加到主屏幕。手机专用布局为日期栏、紧凑时间轴、底部导航；Agnes 为独立手机工作页，输入、微调和结果保留在同一页面。桌面保留课表和训练拖拽。

电脑 DSH 的设置里使用“云端账号连接”，填写网站根网址与个人应用账号。连接前会检查云端包含全部本地编号和内容；未迁移齐全则拒绝切换。连接后 RPC 和 Agent 工具统一执行云端服务；断网不会悄悄写回本地数据库。会话仅保存在 Windows DPAPI 加密文件中。

手机离线缓存按账号隔离，完成状态和实际训练补记先写入 IndexedDB，再联网同步；重复请求使用同一个操作编号。AI 需要联网。首次安装和登录需要网络；账号缓存、页面及日程至少要成功读取一次。

验收：手机记录一组训练→电脑读取同一训练；文字生成安排→修改时间→应用→关闭重开仍能找到；断网补记→重连后只出现一组。当前浏览器验证使用隔离样例，真实公网和手机网络联动要在部署后检查。

## Apple Watch

工程见 `apps/apple/README.zh-CN.md`。需要 Mac、Xcode、iPhone 和已配对手表进行签名与真机测试。手机凭证存于 Keychain，手表只缓存所属账号的当天任务和训练，通过 WatchConnectivity 将带稳定编号的补记交给手机，再进入相同后端。

当前仅交付 Swift 源码与 XcodeGen 工程配置，Windows 无法编译或安装到 Apple Watch，不能视为已验收的手表应用。HealthKit 授权和健康数据读取尚未接入，不会自动把身体活动当成任务完成。

## 回滚与恢复

代码基线标签只恢复代码；个人数据需要独立备份恢复。原 DSH 数据库保持原样，正式切换前继续保留它。迁移失败或云端不可用时，可明确断开云端，使用原插件；断开不会自动把云端新记录反向覆盖旧数据库，先下载云端备份。

先验证免费测试网址在你的大陆手机网络上能否正常登录、调用 API。后续有自己的域名后再绑定 Vercel 并设置 Cloudflare DNS，实际测试登录 cookie、后台任务和网络延迟；不预先保证大陆访问稳定。
