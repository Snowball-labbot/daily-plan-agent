# iPhone / Apple Watch 自用工程

此工程通过同一个云端账号读取日计划、本周安排与训练，Apple Watch 使用 WatchConnectivity 经 iPhone 同步。手表保存离线缓存和待上传操作；服务端按操作编号去重。实际训练只写 `gym.set.log`，不会把计划重量变成实绩。

手表分为“今日 / 本周 / Agnes”三个页面。今日可打卡，本周点日期看当天任务；Agnes 使用系统听写输入临时变化或近况，确认文字后由同一云端后台任务理解并更新安排。文字、处理状态和离线队列会保留。手机需要联网并允许应用运行，手表本身不持有云端令牌。账号切换不会混用待上传记录。

iPhone 的“记住密码”把登录凭证存入系统 Keychain，并按网站与账号隔离；关闭后不保留密码。网页使用浏览器或 iCloud 密码管理器保存密码，本地存储只保留邮箱和偏好。

## 在 Mac 上运行

1. 安装 Xcode（包含 iOS 17 / watchOS 10 或更高 SDK），以及 XcodeGen：`brew install xcodegen`。
2. 在此目录执行 `xcodegen generate`，打开生成的 `DailyPlan.xcodeproj`。
3. 两个 target 的 Signing & Capabilities 选择你的 Personal Team，修改 bundle identifier 为你拥有的唯一前缀；同时修改 Watch 的 `WKCompanionAppBundleIdentifier` 指向 iPhone 标识。
4. 用配对的 iPhone 与 Apple Watch 真机运行 `DailyPlan` scheme。手机输入云端测试网址和同一个个人账号。
5. 手机上“同步到手机与手表”；手表应显示当天任务与训练动作。手表记一组、手机同步、电脑刷新，验证只出现一组。
6. 断开手机网络后记一组；重新连接后核对去重。切换账号时不能将旧账号的待上传操作写入新账号。

免费个人签名需要定期重新签名。GitHub Actions 已在 macOS 上通过 9 项 Swift 模型/离线队列测试，并成功完成 iPhone 与嵌入的单 target Watch 应用的未签名 Xcode 编译。签名、系统听写和真机之间的通信仍需按以上步骤验收。

## HealthKit

首版只同步明确填写的动作、重量与次数。暂未读取心率、活动圆环或自动识别训练；需要在 Xcode 添加 HealthKit capability，并实现独立授权与数据来源校验后才接入。Info 描述保留为后续授权用途，不表示已经读取健康数据。

手机 Web 已是完整操作界面；配套 iPhone App 负责 Keychain 登录、手表转发和持久补记队列。内嵌 Web 需首次单独登录，首版没有把原生令牌注入 Web 页面。
