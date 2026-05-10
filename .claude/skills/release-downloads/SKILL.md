---
name: release-downloads
description: 查询 jellyfin-recents 各版本 GitHub Release 下载次数，以表格形式展示。
allowed-tools: Bash(gh release:*)
---

# 查询各版本下载次数

执行以下命令逐版本查询下载次数：

```bash
gh release list --json tagName --jq '.[].tagName' | while read tag; do
  count=$(gh release view "$tag" --json assets --jq '.assets[] | .downloadCount' 2>/dev/null || echo 0)
  echo "$tag $count"
done
```

将结果整理成以下格式输出：

| 版本 | 下载次数 |
|------|---------|
| vX.X.X | N |
| ... | ... |

最后一行显示所有版本合计下载次数。
