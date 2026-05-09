import { render } from 'preact'
import { App } from './components/App'
import './styles.css'

const root = document.getElementById('jellyfin-recents-root')
if (root && typeof window.ApiClient !== 'undefined') {
  render(<App />, root)
}
