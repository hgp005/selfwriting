# 安装到安卓手机

| 交付产物 | 说明 |
| --- | --- |
| `dist/selfwriting-1.9.0.apk` | **主安装包**（983,015 字节 ≈ 960 KB，Android 7.0+，已用正式密钥签名 v2+v3） |
| `dist/selfwriting-signing-key.jks` | 签名密钥（口令 `selfwriting`），**重装/升级务必保留** |

版本 **1.9.0**（versionCode 11）· 支持 **Android 7.0（API 24）及以上**

> **升级安装**：同一签名可直接覆盖安装（点安装包或 `adb install -r`），数据不丢。
> 若提示「应用未安装」，通常是签名不一致，需先卸载旧版
> （卸载会清数据，先做「设置 → 导出整库备份」）。

### 1.10.0：账号 / 状态 / 多人创作 / 音乐大升级

- **个人账号**：注册只要一个昵称；头像可用表情或相册图片（压缩后存本机）；
  自动生成专属码（SW-XXXXXX）用于加密友；昵称同时也是协作与日记的署名
- **状态**（仿微信 / QQ）：一句话 + 表情 + 时效，显示在个人页、各模块首页状态卡与顶部栏头像上
- **多人创作标记**：日记条目、小说 / 文章作品与章节都能记参与者，界面上统一标「多人创作 · 参与者」
- **音乐模块**：钢琴改成多谐波合成，新增电钢琴 / 吉他（真实定弦指板）/ 贝斯 / 鼓组（打击垫），
  并加了「试音台」——选乐器、弹奏、调音量 / 延音 / 明亮度、看电平表、听示范乐句
- 语言切换器里的语言名称（简体中文 / English / 繁體中文）不再被翻译

### 1.9.0：打开书不再卡、返回键像原生、日记日期规则、多语种彻底

- **阅读器改成渐进渲染**：只建章节标题，正文先渲染当前这一屏，其余滚到哪渲染到哪；
  还原阅读位置改为「瞬时」，不再从第一页平滑滚过整本书。300 章的书打开同步耗时
  从「一次布局全书」降到 10 ms 级（详见 README 的「打开一本书为什么不卡」）
- **返回键接管**：`onBackPressed` 交给网页里的 `UI.hardwareBack()`，
  一层层退页面栈、先关弹层、最外层「再按一次退出」；换章节不再堆历史
- **日记不能记未来日期**，以前的日记随时可以改（含改日期）
- **多语种**：切换语言不再刷新页面；界面文案（含 placeholder、动态字数、日期时长）
  英文与繁体都覆盖到底，用户自己写的内容永远不动

### 1.4.0：导入的书终于能读了

1.3.0 让「选择文件」能用了，但选进来的 EPUB / MOBI **解析不出来**，表现为
目录空白、正文空白。根因是两个：

1. **DEFLATE 解压写错了比特顺序** —— zip 里的 EPUB 条目几乎都是压缩存储的，
   而 DEFLATE 规定「低比特优先」，旧实现按高比特优先读，
   于是解出来的是一堆乱码，章节自然为空（TXT 不走压缩，所以只有它一直正常）
2. **MOBI 的记录表项按 4 字节读了** —— PalmDB 的记录表每项是 8 字节
   （偏移 4 + 属性 1 + 填充 3），读错步长会把属性字节当成下一个偏移；
   另外 MOBI 头的位置是固定的「记录 0 + 16」，旧实现却去读一个并不存在的字段

现在：EPUB 读 OPF 清单按 spine 顺序取章节，MOBI 解析 PalmDOC 并按
`<mbp:pagebreak>` 分节，PDF 提取文本层，TXT/MD/HTML 自动识别
UTF-8 / UTF-16 / GBK / Big5。导入小说时优先用**书内的书名与作者**。

回归覆盖：`tools/parser-node-test.js`（15 项，inflate 与 Node zlib 逐字节对拍）
+ `tools/verify.js` 里那条「导入 EPUB：解析出章节与正文」。

### 导入文件打不开？（1.3.0 已修）

早期版本的壳**没有接管 WebView 的文件选择回调**（`onShowFileChooser`），
所以点「选择文件」不会有任何反应，也无法在手机上导入 txt / md。同时
`setAllowContentAccess(false)` 会让 WebView 读不到系统选择器返回的 `content://` 文件。

1.3.0 的修复：

- 壳里实现了 `onShowFileChooser` + `onActivityResult`，用 `ACTION_OPEN_DOCUMENT`
  拉起系统文件管理器，支持多选，选中后把 URI 交回网页
- 打开 `setAllowContentAccess(true)`，WebView 才能读出所选文件的内容
- 网页侧加了**读取兜底**：`FileReader` 读不出内容时改用 `file.text()`
- 网页侧加了**「粘贴文本」导入**：文件管理器不可用的机型，先在别处复制全文再粘贴进来
  （导入对话框里「选择文件」与「粘贴文本」并列）

### 关于 1.1.0 那个「启动异常」提示

1.1.0 加的自检过于严格：`onPageFinished` 只表示文档解析完成，**脚本可能还在执行**，
于是在较慢的设备上会误判为「资源未完整加载」，并把整个界面换成报错页——
而实际上应用是好的（判断依据：那时标题栏已经是应用自己的深色主题，
说明 CSS/JS 都已生效）。

1.1.1 改成：**多次采样（约 6 秒）+ 连续失败才提示 + 提示只是底部一条不遮挡界面的横幅**，
恢复正常后自动消失。横幅上还有「诊断信息」按钮，会列出本地服务收到的每一条请求
（路径、状态码、字节数、MIME）与最后一次 WebView 报错——出问题时把这一屏发我即可定位。

排查顺序（万一再遇到）：

1. 确认装的是 **1.9.0**（应用内「统计 → 设置」底部有版本号）
2. 先等几秒，看底部横幅是否自行消失
3. 用 `node tools\verify-apk.js dist\selfwriting-1.9.0.apk` 确认安装包完好（31 项）
4. 需要更细的日志：数据线连接后 `adb logcat -s chromium:V`

与网页版功能完全相同、完全离线、数据保存在手机本机。

- 只有一个权限：`INTERNET`，而且只用于访问**本机回环地址**上的内置静态服务
  （安卓 WebView 用 `file://` 打开本地页面时无法使用 IndexedDB，数据存不下来，
  所以壳里起了一个只监听 `127.0.0.1` 的本地服务；子资源请求不带查询串，因此不做令牌校验，
  安全由「只监听回环 + 壳里拒绝一切非本机请求」保证）
- 界面本体就是 `assets/www/` 里那一份离线网页应用

安装前可先自检（不需要手机或模拟器）：

```powershell
node tools\verify-apk.js dist\selfwriting-1.9.0.apk
# 26 项：ZIP 结构 / 反斜杠 / assets 布局 / 载荷逐字节一致 / 转义符完好 / 清单 / dex
```

### 最强的一步：直接对安装包里的资源跑整站回归

`tools\serve-apk-assets.js` 会把 APK 里的 `assets/www` 原样抽出来，
按壳里 `LocalServer` 的规则（只监听回环、进入应用需一次性令牌、同一套 MIME）提供出来，
再用 `tools\verify.js` 打完整套 50 项检查：

```powershell
node tools\serve-apk-assets.js dist\selfwriting-1.9.0.apk 8123   # 记下打印出的令牌
node tools\verify.js --base "http://127.0.0.1:8123/index.html?k=<令牌>"
```

这样验证的不是工作目录里那份源码，而是**真正打进 APK 的那份资源**。

---

## 一、装到手机（三种方式任选）

### 方式 1：手机浏览器直接下载（最省事）

1. 电脑上启动服务：`node server.js 8099`
2. 手机连同一个 Wi-Fi，用安卓 Chrome 打开终端提示的地址（形如 `http://192.168.x.x:8099/`）
3. 进入应用后：**统计 → 设置 → 安装到手机 → 下载 selfwriting.apk**
   （或者直接访问 `http://192.168.x.x:8099/selfwriting.apk`）
4. 下载完成后点击安装，系统提示时允许「安装未知来源应用」

### 方式 2：数据线 + adb（最快，能直接看到结果）

```powershell
# 手机打开「开发者选项 → USB 调试」，用数据线连电脑
& "$env:USERPROFILE\OneDrive\Desktop\platform-tools\adb.exe" devices
& "$env:USERPROFILE\OneDrive\Desktop\platform-tools\adb.exe" install -r dist\selfwriting-1.9.0.apk
```

### 方式 3：先不装 APK，用浏览器「安装应用」

Chrome 菜单 →「安装应用 / 添加到主屏幕」。同样离线可用、有桌面图标，
区别是它依赖浏览器运行；APK 是独立应用。

---

## 二、这个 APK 是怎么构建的

本机没有 Android Studio，也**不需要**它。构建链用的是 Google 官方工具，
正是 Gradle 内部会调用的那几个（`android/build.bat`）：

| 步骤 | 工具 | 作用 |
| --- | --- | --- |
| 1 | `pkgassets.bat` | 把 `index.html / css / js / assets` 收进 `assets/www`（只复制，绝不改写内容） |
| 2 | `aapt2 compile` | 编译 `android/res`（图标矢量图、颜色、主题） |
| 3 | `aapt2 link` | 生成二进制 `AndroidManifest.xml`、`resources.arsc`，输出 APK 骨架 |
| 4 | `javac`（JDK 17） | 编译 `MainActivity.java`、`LocalServer.java`、`R.java` |
| 5 | `d8`（R8 项目） | Java 字节码 → `classes.dex` |
| 6 | PowerShell | 把 `classes.dex` 写进 APK |
| 7 | `fix-apk-paths.js` | 修正 Windows 版 aapt2 写入的反斜杠条目名（否则设备上资源全部读不到） |
| 8 | `apksig` | 签名（v2 + v3）并校验 |

一条命令完成：

```powershell
android\build.bat           # 产物：dist\selfwriting-1.9.0.apk
```

> 项目位于纯 ASCII 路径 `D:\dsh\selfwriting`，可直接构建。
> 早期放在含中文的路径下时，aapt2 会因路径编码失败，必须镜像到 `D:\swbuild`
> 再构建；搬到 ASCII 路径后这一步已经不需要了。

依赖的工具都在 `tools/android/`（`get-tools.bat` 可重新下载）：
便携版 JDK 17、`aapt2.exe`、`r8.jar`、`apksig.jar`、平台 `android.jar`（提供框架资源表）。

签名密钥在构建时自动生成到 `android/keystore/selfwriting.jks`（口令 `selfwriting`）。
**换机重装请保留这个文件**，否则新旧 APK 签名不同，无法覆盖安装。
仓库里另存了一份 `dist/selfwriting-signing-key.jks`。

---

## 三、为什么要自己写一个本地小服务

安卓 WebView 直接加载 `file://` 页面时，`localStorage` 和 `IndexedDB` 都不可用，
作品根本存不下来。所以 `LocalServer.java` 在本机回环地址上提供 `assets/www`：

- 只绑定 `127.0.0.1`，不对外网开放
- 每个请求都要带一次性随机令牌（应用启动时生成），
  WebView 里的 `shouldInterceptRequest` 同时拒绝一切非本机请求
- 于是网页拿到了正常的 `http://127.0.0.1:端口` 来源，本地数据库、离线缓存全部可用，
  并且下次启动端口固定优先用 8731，保证同一个来源、数据能接着用

---

## 四、标准工具链（Android SDK + Gradle）已经装好

本机已安装并**实测出包**：

| 组件 | 位置 | 版本 |
| --- | --- | --- |
| Android SDK | `D:\Android\sdk` | cmdline-tools latest、platform-tools、platforms;android-34、build-tools;34.0.0 |
| Gradle | `D:\Gradle\gradle-8.9` | 8.9（配合 AGP 8.5.2） |
| JDK 17 | `tools\android\jdk17` | Temurin 17.0.20 |

工程在 `android-gradle/`，与手动构建链共用同一份源码/资源/清单。构建：

```powershell
# 首次：配置工程（自动探测 JDK / Gradle / SDK，写出 local.properties）
powershell -ExecutionPolicy Bypass -File android-gradle\setup.ps1 `
  -Sdk D:\Android\sdk -Jdk <仓库>\tools\android\jdk17 -Gradle D:\Gradle\gradle-8.9

# 出包
android-gradle\build-gradle.bat                 # assembleDebug
android-gradle\build-gradle.bat assembleRelease # 产物 app\build\outputs\apk\release\app-release.apk
```

实测结果：`assembleDebug` / `assembleRelease` 均 **BUILD SUCCESSFUL**，
产物通过 `tools\verify-apk.js` 全部 22 项自检。

> 想用 Android Studio 打开也行：直接 Open `android-gradle/` 目录即可（它已是标准 AGP 工程）。

### 模拟器（可选）

SDK 里还装了 `emulator` 与 `system-images;android-34;google_apis;x86_64`，AVD 名 `swtest`。
但本机 **CPU 虚拟化在 BIOS 里开着、Windows 里却没装 hypervisor**，
x86_64 镜像需要硬件加速才能启动，安装它需要管理员权限：

```powershell
# 以管理员身份运行（二选一）
# A) 安装 Android 官方 hypervisor 驱动
D:\Android\sdk\cmdline-tools\latest\bin\sdkmanager.bat "extras;google;Android_Emulator_Hypervisor_Driver"
D:\Android\sdk\extras\google\Android_Emulator_Hypervisor_Driver\silent_install.bat
# B) 或启用 Windows 虚拟机监控程序平台（需重启）
dism /online /enable-feature /featurename:HypervisorPlatform /all
```

之后即可 `emulator -avd swtest` 启动，用 `adb install -r` 装包做真机级验证。

---

## 五、另一条路：不装 SDK/Gradle 也能出包

`android/build.bat` 用同一批 Google 官方工具（aapt2 / d8 / apksig + 便携 JDK）直接产出 APK，
工具由 `tools\android\get-tools.bat` 一键取回，适合在没有 SDK 的机器上构建。

```powershell
android\build.bat      # 产物 dist\selfwriting-1.9.0.apk
```

两条链产出的 APK 功能一致，都过了同一套自检。

---

## 六、Capacitor 方案（也可用）

仓库里还放了 `capacitor.config.json` 与 `package.json`，若偏好 Capacitor：

```powershell
New-Item -ItemType Directory -Force www | Out-Null
Copy-Item index.html,manifest.webmanifest,sw.js -Destination www -Force
Copy-Item css,js,assets -Destination www -Recurse -Force
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap add android
npx cap sync android
cd android; ./gradlew assembleDebug
```

---

## 七、构建过程中踩到的坑（都已修好，留个记录）

1. **aapt2 处理不了中文路径**：仓库路径含中文时 `aapt2` 直接报「找不到目录」。
   项目原先放在 `D:\dsh\重启按钮\selfwriting`，因此构建要先镜像到 `D:\swbuild`；
   后来整个项目搬到 `D:\dsh\selfwriting`（纯 ASCII），已可直接构建，
   镜像与 `tools/sync-to-swbuild.ps1` 都不再需要。
2. **Windows 版 aapt2 往 APK 里写反斜杠条目名**（`assets/www/css\style.css`），
   而安卓 AssetManager 不做规范化，真机上资源全部读不到 →
   签名前必须用 `tools/fix-apk-paths.js` 修正（签名后再改会破坏签名）。
3. **`-A` 目录的语义**：aapt2 会把该目录**里面**的内容直接放到 `assets/` 下，
   所以必须传「包含 `www` 这一层的父目录」，否则 `assets/www/index.html` 被拍平成
   `assets/index.html`，套壳找不到页面。Gradle 的 `assets.srcDirs` 同理。
4. **清单里的 `package` 属性**：AGP 8 会提示忽略（改用 `namespace`），
   但 aapt2 手动链接时**必须**有这个属性，两边共存无妨。
5. **XML 注释不能含 `--`**：`--rename-manifest-package` 这种字样写进注释会让解析失败。
6. **PowerShell 5.1 按 GBK 读无 BOM 的 `.ps1`**：中文注释会把脚本语法拆坏，
   脚本必须存成「UTF-8 with BOM」；批处理脚本则统一用 ASCII。
7. **最危险的一个：打包脚本「顺手」改写网页载荷**。曾有一版 `pkgassets.ps1`
   为了「统一路径分隔符」把复制过去的文件里所有 `\` 换成 `/`，
   结果把 JavaScript 的转义序列 `\uXXXX`、`\n`、`\'` 一并破坏，
   应用在设备上直接白屏——而所有结构检查当时都是绿的。
   现在：**打包阶段绝不改写网页内容**（APK 条目名由 `fix-apk-paths.js` 单独处理），
   并且 `verify-apk.js` 会用哈希逐字节比对 APK 内文件与源文件，
   `pkgassets.bat` 也会在打包后立刻做一次完整性断言。
