# 项目搬家记录

## 2026-09-23：`D:\dsh\重启按钮\selfwriting` → `D:\dsh\selfwriting`

**原因**：原路径含中文（`重启按钮`），而 Android 构建工具链里的 `aapt2`
无法处理中文路径 —— 直接构建会报「找不到目录」。此前只能先把源码镜像到
`D:\swbuild` 再构建，多出一道容易出错的同步步骤。

搬到现在这个纯 ASCII 路径后，`android\build.bat` 可以直接跑，镜像机制已废弃
（`tools/sync-to-swbuild.ps1` 已删除）。

## 怎么搬的（保证不损坏）

用 `tools/move-selfwriting.ps1`：

1. 搬移前对源目录**每个文件**记录大小与 SHA256
2. 停掉占用该目录的进程（8099 服务等）
3. `Move-Item` 整体移动（不是复制，保留时间戳与属性）
4. 搬移后对目标目录重新计算 SHA256，**逐个文件比对**
5. 文件数、每个文件的大小与哈希、总字节数任一处不符都会明确报错

结果：**122 个文件、222,112,492 字节，全部逐字节一致**，源目录已消失。

> 注意：发起搬家的进程如果工作目录就在源目录里，Windows 会拒绝重命名
> （`The process cannot access the file because it is being used by another process`）。
> 所以脚本要以脱离方式运行（`Start-Process`），且不要以源目录为工作目录。

## 搬家后同步更新的东西

| 项目 | 处理 |
| --- | --- |
| 桌面快捷方式（创作 / 手机安装 / 停止服务） | 目标与工作目录都改成 `D:\dsh\selfwriting` |
| `tools/android/jdk17/`（被 .gitignore 忽略，未随包分发） | 用项目里自带的 `jdk17-portable.zip` 就地解压 |
| `tools/android/android.jar`、`android28.jar` | 从旧镜像复制过来 |
| `README.md` / `ANDROID.md` | 构建说明改为「可直接构建」，不再提镜像 |

## 验证

| 项目 | 结果 |
| --- | --- |
| 搬家完整性 | 122/122 文件 SHA256 一致 |
| 从新路径重新构建 APK | 成功，且产物与搬家前**逐字节一致**（`B83914F9…42CF`） |
| APK 自检 | 26/26 |
| 解析器测试 | 15/15 |
| Web 端整站回归 | 50/50 |

签名密钥未变，旧版本可以直接覆盖安装，数据不丢。

## 现在的路径一览

```
D:\dsh\selfwriting\           项目本体（纯 ASCII，可直接构建）
D:\dsh\重启按钮\              DSH 自身的重启脚本与 tools（与本项目无关，未改动）
D:\swbuild\                   旧的镜像构建目录，已废弃，可以删除
```

启动方式不变：双击桌面「selfwriting 创作」，或
`cd /d D:\dsh\selfwriting && node launcher.js start`。
手机安装：双击「selfwriting 手机安装」，或手机浏览器打开
`http://<本机局域网IP>:8099/`。
