# 发布到 GitHub

这个仓库已经整理成可以直接上传的状态。下面三种方式任选一种。

## 0. 上传前复查（可选，1 条命令）

```powershell
node tools/prepare-github.js
```

它会做三件事：

1. **体检**：扫描仓库里有没有个人信息、密钥、服务器令牌、大文件、乱码文件；
2. 缺失时生成 `LICENSE`（MIT + 第三方采样署名）；
3. 生成 `github-upload/MANIFEST.txt`（需要上传的文件清单，含体积）。

已确认**不会**被上传的内容（`.gitignore` + 脚本双重排除）：

- `dist/`、`build/`、`shots/`、`node_modules/`（运行期产物与截图）
- **所有 `.apk` 与签名文件**（`selfwriting*.apk`、`*.jks`、`*.keystore`）—— 签名密钥只留在你本机
- `.server-info.json`（内含本机服务端口、局域网地址与访问令牌）
- `tools/android/`（JDK / aapt2 等构建工具，可重新下载）

## 1. 最省事：GitHub Desktop（推荐，不需要命令行）

1. 打开 GitHub Desktop → **File → Add local repository** → 选 `D:\dsh\selfwriting`
   （提示不是仓库时点 **create a repository**，Name 填 `selfwriting`）
2. 左下角填一句提交说明（例如 `selfwriting 1.15.0`）→ **Commit to main**
3. 右上 **Publish repository** → 取消勾选 *Keep this code private*（想让别人也能用时）→ **Publish**

发布完把 **Releases → Draft a new release** 打开，把 `dist/selfwriting-1.15.0.apk` 拖进去当附件，
别人就能直接下载安装包（源码仓库不放 APK，避免仓库体积膨胀）。

## 2. 网页上传（不装任何软件）

1. GitHub 上 **New repository** → 名字 `selfwriting` → Create
2. 打开仓库 → **Add file → Upload files**
3. 把 `D:\dsh\selfwriting` 里除下列内容外的文件/目录拖进去：
   `dist/`、`build/`、`shots/`、`node_modules/`、`tools/android/`、`*.apk`、`.server-info.json`
   （单次上传上限 100 个文件；本仓库需要上传约 220 个文件，分 2–3 次即可，
   文件清单见 `github-upload/MANIFEST.txt`）
4. 提交说明填 `selfwriting 1.15.0` → Commit

## 3. 命令行（装了 Git 之后；本机目前没装 Git）

```powershell
cd D:\dsh\selfwriting
git init
git add .
git commit -m "selfwriting 1.15.0"
git branch -M main
git remote add origin https://github.com/<你的用户名>/selfwriting.git
git push -u origin main
```

`git add .` 会自动遵守 `.gitignore`，不会把安装包、签名密钥、截图与服务令牌提交上去。

## 发布前请自行确认

- 仓库里**没有**任何人的作品、日记、导入的书籍或个人资料（本仓库只有代码、文档与采样素材）
- 「专属码 / 昵称 / 头像」只存在每个用户自己的设备上，安装包里也没有预置任何人的信息
- 采样素材来自 MIDI.js Soundfonts 的 FluidR3_GM（CC BY 3.0），署名在 `assets/samples/LICENSE.md`，请勿删除
