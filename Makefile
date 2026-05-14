.PHONY: build-frontend build-plugin build update

build-frontend:
	cd src/frontend && npm run build

build-plugin:
	dotnet build src/JellyfinRecents.Plugin -c Debug --output build/plugin

build: build-frontend build-plugin

update: build
	MSYS_NO_PATHCONV=1 docker cp build/plugin/JellyfinRecents.Plugin.dll \
		jellyfin-dev:/config/plugins/JellyfinRecents/JellyfinRecents.Plugin.dll
	docker restart jellyfin-dev
	@echo "Waiting for service..."
	@sleep 8
	@MSYS_NO_PATHCONV=1 docker exec jellyfin-dev \
		curl -s -o /dev/null -w "Health check: %{http_code}\n" http://localhost:8096/health
