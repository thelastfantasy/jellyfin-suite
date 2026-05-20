# Research: Home Tab Injection

## 调研方法

- DevTools 实时观察（主页 tab 切换、路由事件）
- Jellyfin web 源码分析（`d:\Dev\jellyfin-web\`）

---

## 1. Tab 栏 DOM 结构（实测 10.11.x）

```html
<div is="emby-tabs" data-index="0"
     class="tabs-viewmenubar emby-tabs focusable scrollX hiddenScrollX"
     data-scroll-mode-x=custom>
  <div class="emby-tabs-slider">
    <button type="button" is="emby-button"
            class="emby-tab-button emby-button emby-tab-button-active lastFocused"
            data-index="0">
      <div class="emby-button-foreground">Home</div>
    </button>
    <button type="button" is="emby-button"
            class="emby-tab-button emby-button"
            data-index="1">
      <div class="emby-button-foreground">Favorites</div>
    </button>
  </div>
</div>
```

---

## 2. 原生 Tab 切换机制

**源码**：`src/elements/emby-tabs/emby-tabs.js`、`src/components/maintabsmanager.js`

点击 tab 按钮的完整流程：

1. `emby-tabs.js` 的 `onClick()` 捕获 click 事件
2. 读取 `data-index`，切换 `emby-tab-button-active` 类
3. 触发自定义事件 `beforetabchange`（携带 `previousIndex` / `selectedTabIndex`）
4. 120ms 后触发 `tabchange` 事件
5. `maintabsmanager.js` 监听 `beforetabchange`，切换对应 `.pageTabContent` 的 `is-active` 类

**关键：URL 不变，纯 DOM 切换**，不触发任何路由导航。

---

## 3. Tab HTML 生成规则（maintabsmanager.js 第 106–127 行）

```javascript
if (t.href) {
    // 有 href → 生成导航链接，点击会跳转路由
    tabHtml = '<a href="' + t.href + '" is="emby-linkbutton" class="emby-tab-button emby-button" data-index="' + index + '">'
            + '<div class="emby-button-foreground">' + t.name + '</div></a>';
} else {
    // 无 href → 生成普通按钮，点击只切换 DOM
    tabHtml = '<button type="button" is="emby-button" class="emby-tab-button emby-button" data-index="' + index + '">'
            + '<div class="emby-button-foreground">' + t.name + '</div></button>';
}
```

**结论**：我们需要跨页导航，必须使用 `<a is="emby-linkbutton">` 形式。

---

## 4. 路由机制

**源码**：`src/RootAppRouter.tsx`、`src/components/router/appRouter.js`

Jellyfin 使用 **React Router v6 + createHashRouter**，所有路由基于 `#/` 前缀。

### 插件配置页路由

`src/apps/dashboard/routes/routes.tsx`：
```typescript
{
    path: 'configurationpage',   // DASHBOARD_APP_PATHS.PluginConfig
    element: <ServerContentPage view='/web/configurationpage' />
}
```

`ServerContentPage` 读取 `location.search`（即 `?name=JellyfinSuite`），向服务器请求 `/web/configurationpage?name=JellyfinSuite`，加载并渲染插件页 HTML。

### 正确导航 URL

```
/#/configurationpage?name=JellyfinSuite
```

带 `!` 的 hashbang 格式（`#!/configurationpage?name=JellyfinSuite`）也可以，`appRouter.show()` 内部会剥离 `#` 和 `!` 前缀后调用 `history.push()`。

### DevTools 实测验证

```javascript
// 设置 hash 后成功跳转，title 变为"最近播放"
location.hash = '!/configurationpage?name=JellyfinSuite';
// → URL 变为 http://localhost:8600/web/#/configurationpage?name=JellyfinSuite ✓
```

---

## 5. emby-linkbutton 的导航机制

**源码**：`src/elements/emby-button/emby-button.js`

```javascript
function onAnchorClick(e) {
    const href = this.getAttribute('href') || '';
    if (href !== '#') {
        e.preventDefault();
        appRouter.show(href);   // ← 统一入口
    }
}
```

`appRouter.show(path)`（`src/components/router/appRouter.js`）：
1. 剥离 `#`、`!` 前缀
2. 添加 `/` 前缀（若缺失）
3. 调用 `history.push(path)` → React Router 导航

`window.Emby.Page` 就是 `appRouter` 的实例（DevTools 确认字段一致：`promiseShow`、`resolveOnNextShow`、`lastPath`、`baseRoute`）。备用调用：`window.Emby.Page.show('configurationpage?name=JellyfinSuite')`

---

## 6. 侧边栏插件入口

**源码**：`src/apps/dashboard/components/drawer/sections/PluginDrawerSection.tsx`

插件配置页通过 API `/System/Configuration/configurationpages` 枚举（`IHasWebPages` 接口），生成侧边栏链接：

```typescript
to={`/${Dashboard.getPluginUrl(pageInfo.Name)}`}
// → /configurationpage?name=JellyfinSuite
```

**实测发现**：dev 环境侧边栏中**没有出现** JellyfinSuite 插件入口（可能需要特定的 `EnableInMainMenu` 标志或 Stable 布局），这也是注入 home tab 的动机之一。

---

## 7. 关键结论

| 问题 | 结论 |
|------|------|
| 原生 tab 如何切换 | 纯 DOM（`is-active`），URL 不变 |
| 我们的 tab 如何导航 | 必须用 `<a is="emby-linkbutton" href="...">` |
| 正确的 href 值 | `configurationpage?name=JellyfinSuite` |
| 是否可以用 `window.location.hash` | 可以但不规范，应走 appRouter |
| `window.Emby.Page` 是什么 | `appRouter` 实例，可调用 `.show()` |
| plan.md 的错误 | 用了 `<button>` + `location.hash`，应改为 `<a is="emby-linkbutton">` |
