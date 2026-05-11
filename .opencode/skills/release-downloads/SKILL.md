---
name: release-downloads
description: 查询 jellyfin-recents 各版本 GitHub Release 下载次数，以表格形式展示。
compatibility: opencode
metadata:
  source: claude:skills/release-downloads
---

# 查询各版本下载次数

执行以下 PowerShell 命令逐版本查询下载次数（由于本项目使用 Windows / PowerShell 环境，不可用 bash 语法）：

```powershell
$tags = gh release list --json tagName --jq '.[].tagName'
foreach ($tag in ($tags -split '\n' | Where-Object { $_ -ne '' })) {
  $counts = gh release view $tag --json assets --jq '.assets[].downloadCount' 2>$null
  $total = 0; $counts -split '\n' | ForEach-Object { if ($_ -match '^\d+$') { $total += [int]$_ } }
  Write-Output "$tag $total"
}
```

> 注意：每个 Release 可能包含多个 Asset，需将各 Asset 的 `downloadCount` 求和得到该版本的总下载次数。

将结果整理成以下格式输出：

| 版本 | 下载次数 |
|------|---------|
| vX.X.X | N |
| ... | ... |

最后一行显示所有版本合计下载次数。
