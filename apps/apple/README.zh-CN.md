# iPhone / Apple Watch 自用工程

此工程通过同一个云端账号读取日计划与训练，Apple Watch 使用 WatchConnectivity 经 iPhone 同步。手表保存当天离线缓存和待上传操作；服务端按操作编号去重。实际训练只写 `gym.set.log`，不会把计划重量变成实绩。

## 在 Mac 上运行

1. 安装 Xcode（包含 iOS 17 / watchOS 10 或更高 SDK），以及 XcodeGen：`brew install xcodegen`。
2. 在此目录执行 `xcodegen generate`，打开生成的 `DailyPlan.xcodeproj`。
3. 两个 target 的 Signing & Capabilities 选择你的 Personal Team，修改 bundle identifier 为你拥有的唯一前缀；同时修改 Watch 的 `WKCompanionAppBundleIdentifier` 指向 iPhone 标识。
4. 用配对的 iPhone 与 Apple Watch 真机运行 `DailyPlan` scheme。手机输入云端测试网址和同一个个人账号。
5. 手机上“同步到手机与手表”；手表应显示当天任务与训练动作。手表记一组、手机同步、电脑刷新，验证只出现一组。
6. 断开手机网络后记一组；重新连接后核对去重。切换账号时不能将旧账号的待上传操作写入新账号。

免费个人签名需要定期重新签名。工程尚未在 Mac/Xcode 或真机编译验证；Windows 只验证了后端协议和操作去重。

## HealthKit

首版只同步明确填写的动作、重量与次数。暂未读取心率、活动圆环或自动识别训练；需要在 Xcode 添加 HealthKit capability，并实现独立授权与数据来源校验后才接入。Info 描述保留为后续授权用途，不表示已经读取健康数据。

手机 Web 已是完整操作界面；配套 iPhone App 负责 Keychain 登录、手表转发和持久补记队列。内嵌 Web 需首次单独登录，首版没有把原生令牌注入 Web 页面。
