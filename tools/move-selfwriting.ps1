# ============================================================
#  move-selfwriting.ps1
#  把 selfwriting 从「含中文的路径」搬到 D:\dsh\selfwriting
#  （aapt2 不认中文路径，搬到 ASCII 路径后可以直接构建）
#
#  做法：记录搬移前的完整指纹 → 移动 → 逐文件比对 SHA256，
#        任何一处不一致都会明确报错，绝不静默丢文件。
#
#  用法:
#    powershell -ExecutionPolicy Bypass -File tools\move-selfwriting.ps1 -WhatIf
#    powershell -ExecutionPolicy Bypass -File tools\move-selfwriting.ps1
# ============================================================
param(
  [string]$Source = 'D:\dsh\重启按钮\selfwriting',
  [string]$Target = 'D:\dsh\selfwriting',
  [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'

function Get-Inventory($root) {
  $items = Get-ChildItem -LiteralPath $root -Recurse -File -Force -ErrorAction SilentlyContinue
  $list = @()
  foreach ($f in $items) {
    $rel = $f.FullName.Substring($root.Length).TrimStart('\')
    $list += [pscustomobject]@{
      Rel   = $rel
      Size  = $f.Length
      Hash  = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash
    }
  }
  return $list
}

Write-Host "源目录  : $Source"
Write-Host "目标目录: $Target"
Write-Host ""

if (-not (Test-Path -LiteralPath $Source)) { throw "源目录不存在: $Source" }
if (Test-Path -LiteralPath $Target) { throw "目标已存在，为安全起见不覆盖: $Target" }

Write-Host "[1/5] 记录源目录指纹 ..."
$before = Get-Inventory $Source
$bytesBefore = ($before | Measure-Object Size -Sum).Sum
Write-Host "  文件数=$($before.Count)  总字节=$bytesBefore"

if ($WhatIf) {
  Write-Host ""
  Write-Host "-WhatIf：仅预演，不执行移动。"
  exit 0
}

Write-Host "[2/5] 停止占用该目录的进程 ..."
$stopped = 0
foreach ($port in 8099, 8100, 8101) {
  $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  foreach ($c in $conns) {
    try {
      $p = Get-Process -Id $c.OwningProcess -ErrorAction Stop
      Write-Host "  停止进程 $($p.ProcessName) (PID $($p.Id))，端口 $port"
      Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
      $stopped++
    } catch { }
  }
}
Start-Sleep -Milliseconds 1200
if ($stopped -eq 0) { Write-Host "  没有发现占用端口的进程" }

Write-Host "[3/5] 移动目录（移动不复制，保留时间戳与属性）..."
Move-Item -LiteralPath $Source -Destination $Target -Force
Write-Host "  已移动到 $Target"

Write-Host "[4/5] 重新记录目标目录指纹并比对 ..."
$after = Get-Inventory $Target
$bytesAfter = ($after | Measure-Object Size -Sum).Sum
Write-Host "  文件数=$($after.Count)  总字节=$bytesAfter"

$fail = 0
if ($before.Count -ne $after.Count) {
  Write-Host "  [x] 文件数不一致: 前 $($before.Count) / 后 $($after.Count)"
  $fail++
}
$mapAfter = @{}
foreach ($a in $after) { $mapAfter[$a.Rel] = $a }
foreach ($b in $before) {
  if (-not $mapAfter.ContainsKey($b.Rel)) { Write-Host "  [x] 丢失: $($b.Rel)"; $fail++; continue }
  $a = $mapAfter[$b.Rel]
  if ($a.Size -ne $b.Size) { Write-Host "  [x] 大小变化: $($b.Rel)  $($b.Size) -> $($a.Size)"; $fail++; continue }
  if ($a.Hash -ne $b.Hash) { Write-Host "  [x] 内容变化: $($b.Rel)"; $fail++ }
}

Write-Host "[5/5] 结果 ..."
if ($fail -gt 0) {
  Write-Host "  [x] 校验失败：$fail 处异常。文件已在 $Target，请勿删除源路径残留。"
  exit 1
}
if ($bytesBefore -ne $bytesAfter) {
  Write-Host "  [x] 总字节不一致: $bytesBefore -> $bytesAfter"
  exit 1
}
Write-Host "  校验通过：$($after.Count) 个文件全部逐字节一致（SHA256 逐个比对）"
Write-Host "  源目录已不再存在: $(-not (Test-Path -LiteralPath $Source))"
exit 0
