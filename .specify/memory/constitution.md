<!-- Sync Impact Report
Version change: 0.0.0 (template) → 1.0.0 (initial ratification)
Added sections: Core Principles (I–V), Development Constraints, Deployment Workflow, Governance
Removed: all template placeholder tokens
Templates requiring updates: ✅ N/A (no template changes required)
Deferred TODOs: none
-->

# Jellyfin Suite Plugin Constitution

## Core Principles

### I. Jellyfin Source Is the Ground Truth

When any behavior of the Jellyfin web UI is unclear — DOM structure, routing,
events, tab switching, plugin loading, etc. — the **authoritative reference is
the Jellyfin web source code at `d:\Dev\jellyfin-web\`**. Always read the
relevant source file before making assumptions. Do NOT guess based on external
documentation alone; the local source reflects the exact version in use.

Key files to consult first:
- Tab/routing: `src/elements/emby-tabs/emby-tabs.js`, `src/components/maintabsmanager.js`
- Routing: `src/RootAppRouter.tsx`, `src/components/router/appRouter.js`
- Plugin pages: `src/apps/dashboard/routes/routes.tsx`

### II. Test Before Deploy (NON-NEGOTIABLE)

The deploy workflow is strictly ordered and MUST NOT be skipped:

1. `make test` — full test suite (Rust + TypeScript + C#)
2. User reviews results and explicitly confirms
3. `make update` — deploys to `jellyfin-dev` container (destructive: restarts container)

`make update` MUST NOT run without prior `make test` passing and explicit user
approval. Direct `cargo`/`vitest`/`dotnet` invocations do NOT substitute for
`make test`.

### III. C# JSON Serialization Must Be Explicit

ASP.NET Core controllers in this plugin default to **PascalCase** JSON property
names. Every DTO whose fields are consumed by frontend JavaScript MUST carry
`[JsonPropertyName("camelCaseName")]` on each property to guarantee camelCase
output. Never assume the wire format — verify with DevTools when in doubt.

```csharp
using System.Text.Json.Serialization;
public sealed class ExampleDto {
    [JsonPropertyName("myField")]
    public string MyField { get; set; } = "";
}
```

### IV. Independent IIFE Bundles — No Runtime Sharing

Each injection target (config page `frontend`, `player-enhancer`,
`home-injector`) is built as an independent IIFE bundle by Vite. Bundles share
**source code at build time** (via Vite path aliases) but are completely
independent at runtime. No shared global state, no cross-bundle `import()`.
The `frontend` IIFE entry point (`index.tsx`) MUST NOT be modified in a way
that alters its self-mounting behavior.

### V. Speckit Branch Rules Are Overridden

The speckit `00x-xxx` branch naming convention and the `/speckit-git-feature`
hook are **not used** in this project. Spec documents (spec/plan/tasks) are
committed directly on the current working branch. No separate spec branches are
created.

## Development Constraints

- **Shell**: All CLI operations (`npm`, `cargo`, `dotnet`, `make`) use **bash**.
  PowerShell is only used for file operations when explicitly required by tooling.
- **Paths**: File operations use Windows paths (`D:\Dev\...`); bash commands use
  Unix paths (`/d/Dev/...`).
- **Selectors**: DOM selectors injected into Jellyfin pages MUST fail silently
  (return early) when the target element is not found. Never throw on missing nodes.
- **Idempotent injection**: Use data-attribute markers (e.g. `data-jfs-hometab`)
  to prevent double-injection across MutationObserver firings.

## Deployment Workflow

```
Container: jellyfin-dev
Access:    http://localhost:8600  (user: root / 123456)
Image:     jellyfin/jellyfin:latest (10.11.x)
Deploy:    make update  ← restarts container, requires user approval
```

Startup flags required (MSYS path conversion workaround):
```bash
MSYS_NO_PATHCONV=1 docker run ... -e JELLYFIN_WEB_DIR=/jellyfin/jellyfin-web
```

## Governance

This constitution supersedes all other conventions in this repository. Amendments
require: (1) a documented rationale, (2) version bump per semantic versioning
(MAJOR = governance change, MINOR = new principle, PATCH = clarification), and
(3) update of this file before implementation begins.

All implementation plans and task lists must be consistent with these principles.
When a plan or task contradicts a principle, the principle wins.

**Version**: 1.0.0 | **Ratified**: 2026-05-20 | **Last Amended**: 2026-05-20
