SHELL := bash
export PATH := /c/Program Files/nodejs:$(PATH)

.PHONY: build-frontend build-plugin build-poster-gen build-poster-gen-win build update clean \
        test test-rust test-frontend test-csharp workflow-test workflow-test-release

build-frontend:
	cd src/frontend && npm run build

# Build Linux Rust binary via Docker (cross 在 Windows 上有工具链检测 bug，改用 docker run 直接编译)
build-poster-gen:
	MSYS_NO_PATHCONV=1 docker run --rm \
		-v "$$(cygpath -m $(CURDIR))/src/poster-gen:/workspace" \
		-w /workspace \
		rust:1.88-slim-bookworm \
		cargo build --release
	cp src/poster-gen/target/release/poster-gen \
		src/JellyfinRecents.Plugin/poster-gen-linux-x64

# Build Windows Rust binary natively (run on Windows where cargo targets Windows by default)
build-poster-gen-win:
	cd src/poster-gen && cargo build --release
	cp src/poster-gen/target/release/poster-gen.exe \
		src/JellyfinRecents.Plugin/poster-gen-win-x64.exe

build-plugin:
	dotnet build src/JellyfinRecents.Plugin -c Debug --output build/plugin

build: build-frontend build-plugin

update: build-poster-gen build
	MSYS_NO_PATHCONV=1 docker cp build/plugin/JellyfinRecents.Plugin.dll \
		jellyfin-dev:/config/plugins/JellyfinRecents/JellyfinRecents.Plugin.dll
	MSYS_NO_PATHCONV=1 docker cp build/plugin/poster-gen-linux-x64 \
		jellyfin-dev:/config/plugins/JellyfinRecents/poster-gen-linux-x64
	docker restart jellyfin-dev
	@echo "Waiting for Jellyfin to start..."
	@sleep 20
	@MSYS_NO_PATHCONV=1 docker exec jellyfin-dev \
		curl -s -o /dev/null -w "Health check: %{http_code}\n" http://localhost:8096/health

# ── Tests ────────────────────────────────────────────────────────────────────

test-rust:
	cd src/poster-gen && cargo test

test-frontend:
	cd src/frontend && bun test ../../tests/frontend/

test-csharp:
	dotnet test tests/JellyfinRecents.Tests

# Run all test suites sequentially; fail fast on first error
test: test-rust test-frontend test-csharp

workflow-test:
	act -W .github/workflows/build.yml \
		-P ubuntu-latest=catthehacker/ubuntu:act-latest

# Release workflow：构建步骤可测，GitHub Release/Pages 步骤因需真实 token 会失败（属正常）
# gh auth token 仅用于拉取 Action 定义（公开仓库），Release/Pages 上传因 local repo 而失败属预期
workflow-test-release:
	act push -W .github/workflows/release.yml \
		-P ubuntu-latest=catthehacker/ubuntu:act-latest \
		-e .github/act-events/tag-push.json \
		--secret GITHUB_TOKEN=$$(gh auth token) \
		--env GITHUB_REF=refs/tags/v0.0.0-test \
		--env GITHUB_REPOSITORY=local/jellyfin-recents

clean:
	rm -rf build/
	cd src/frontend && rm -rf dist/
	cd src/poster-gen && cargo clean
