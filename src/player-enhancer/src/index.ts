import { injectStyles } from './styles';
import { initInjector } from './injector';
import type { JellyfinPluginDeps } from './types/jellyfin';

export default class PlayerEnhancerPlugin {
  constructor({ playbackManager, events }: JellyfinPluginDeps) {
    injectStyles();
    initInjector(playbackManager, events);
  }
}
