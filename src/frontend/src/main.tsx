import { render } from 'preact'
import { App } from './components/App'
import './styles.css'

function mount() {
  const root = document.getElementById('jellyfin-recents-root')
  if (!root || !window.ApiClient) return
  // 防止重复挂载
  if (root.childElementCount > 0) return
  render(<App />, root)
}

// 立即尝试（桌面端通常直接成功）
mount()

// Jellyfin SPA 每次显示页面时在页面元素上触发 viewshow
// 手机端 / 二次导航时作为保底
document.getElementById('jellyfinRecentsPage')?.addEventListener('viewshow', mount)
