# 采样素材来源与许可（assets/samples/）

本目录里的 MP3 是**构建期**由 `tools/fetch-samples.js` 从公开素材库下载的，
随应用一起打包（离线包内直接读取，运行期不联网、不发任何请求）。

## 1. 素材库

| 项目 | 内容 |
| --- | --- |
| 素材库 | **MIDI.js Soundfonts**（`gleitz/midi-js-soundfonts`），音色集 **FluidR3_GM** |
| 仓库地址 | https://github.com/gleitz/midi-js-soundfonts |
| 下载前缀（CDN） | `https://cdn.jsdelivr.net/gh/gleitz/midi-js-soundfonts@gh-pages/FluidR3_GM/<instrument>-mp3/<Note>.mp3` |
| 仓库许可文件 | `LICENSE.txt`：Copyright (C) 2012 Benjamin Gleitzman — **MIT License** |
| 音色内容许可 | 仓库 `README.md` 明确写明：FluidR3_GM 由 `FluidR3_GM.sf2` 渲染而来，**Released under Creative Commons Attribution 3.0 license (CC BY 3.0)**；原始音色库 Fluid (R3) SoundFont 由 **Frank Wen** 制作（其自带 README 声明以 MIT 发布） |
| 下载日期 | 2026-09-24（见 `manifest.json` 的 `generatedAt`） |
| 采用的乐器（GM 名） | `acoustic_grand_piano`（钢琴）、`electric_piano_1`（电钢琴）、`acoustic_guitar_steel`（吉他）、`electric_bass_finger`（贝斯） |

### 许可结论

* 该仓库的**脚本与清单**是 **MIT**；FluidR3_GM 的**采样内容**按其 README 是 **CC BY 3.0**。
* 两者都是**宽松许可**（允许商用、允许再分发、允许修改与打包），**不是 NC / ND / 未知来源**。
* CC BY 3.0 要求**署名**。本项目的署名方式：
  1. 本文件（随采样一起发布在应用包内）；
  2. 应用「音乐创作 → 试音台」的乐器徽章提示里写明「真采样：FluidR3_GM（CC BY 3.0）」；
  3. `assets/samples/manifest.json` 里记录了 `source` / `sourceUrl` / `licence` 字段。
* 署名对象：**FluidR3_GM / Fluid (R3) SoundFont — Frank Wen**；渲染与分发：**MIDI.js Soundfonts (gleitz) — MIT**。

## 2. 下载了什么

每个乐器**每隔 3 个半音**取一个音（相邻采样最多变调 ±1.5 个半音，听不出「变声器」味），
文件名一律 ASCII（`C4.mp3` / `Eb3.mp3` / `Bb2.mp3` …）：

| 目录 | GM 音色 | MIDI 音域 | 文件数 |
| --- | --- | --- | --- |
| `assets/samples/piano/` | acoustic_grand_piano | 48–90（C3–Gb6） | 15 |
| `assets/samples/epiano/` | electric_piano_1 | 48–87（C3–Eb6） | 14 |
| `assets/samples/guitar/` | acoustic_guitar_steel | 40–70（E2–Bb4） | 11 |
| `assets/samples/bass/` | electric_bass_finger | 28–49（E1–Db3） | 8 |
| **合计** | | | **48 个 mp3 + `manifest.json`** |

* 总体积：**约 949 KB**（48 个 mp3 约 941 KB + 清单约 8 KB），预算上限 2.5 MB。
* `manifest.json` 是应用启动时读的清单：里面有什么就加载什么；文件缺失或解码失败
  会自动回退到内置合成音色，所以删掉整个目录应用照样能出声（只是全走合成）。
* 采样在解码时会被裁短（钢琴 2.3s / 电钢 2.1s / 吉他 1.05s / 贝斯 1.35s）并统一
  归一化到 0.9 峰值；实际发声时长由 `js/view-music.js` 的时长表决定
  （吉他 0.9s 内、贝斯 1.3s 内强制静音），录音自身的尾音不会放出来。

## 3. 没有采用的素材（记录一下，避免以后重复调研）

* `MusyngKite`、`FatBoy`（同一仓库）：**CC BY-SA 3.0**（传染性 ShareAlike），与离线包分发策略冲突，未采用。
* 同仓库 `Tabla` 打击乐音色：README 未声明许可 → **来源不明**，未采用；鼓组继续使用内置合成。
* 其它常见免费鼓采样包（MusicRadar Sample RADAR、99Sounds 等）：许可多为「仅限音乐作品使用、
  不得再分发」，不适合随应用打包，未采用。

## 4. 重新下载 / 校验

```bash
node tools/fetch-samples.js          # 只补缺失的文件，可反复跑
node tools/fetch-samples.js --force  # 全部重下
node tools/fetch-samples.js --dry    # 只打印计划
```

脚本会打印「文件数 / 新增字节 / 目录总计」，并重写 `manifest.json`。

## 5. 打包注意（离线 APK / PWA）

* **APK**：`android/pkgassets.bat` 目前只拷 `assets\*` 这一层，**不递归子目录**，
  所以 `assets/samples/**` 不会被打进 APK（应用会静默回退合成）。需要在那个脚本里补一行：

  ```bat
  if exist "%ROOT%\assets\samples" xcopy /e /i /q /y "%ROOT%\assets\samples" "%TGT%\assets\samples\" >nul
  ```

* **PWA**：`sw.js` 的 `ASSETS` 里已经列了这 49 个采样路径（首次安装即离线可用）。
  注意 `cache.addAll()` 是「一个失败就整批不缓存」，所以**如果删掉本目录，
  必须同时删掉 `sw.js` 里 `./assets/samples/…` 那几行**，否则 Service Worker 的
  预缓存会整体失败（应用照常出声，但离线启动会退化成在线）。
