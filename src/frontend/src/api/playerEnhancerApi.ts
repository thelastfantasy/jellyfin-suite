export interface EnhancerStatus {
  autoInjectEnabled: boolean
}

export async function getEnhancerStatus(): Promise<EnhancerStatus> {
  if (!window.ApiClient) throw new Error('ApiClient unavailable')
  const url = window.ApiClient.getUrl('JellyfinSuite/PlayerEnhancer/Status')
  const data = await window.ApiClient.ajax({ url, type: 'GET', dataType: 'json' })
  return data as EnhancerStatus
}

export async function injectEnhancer(): Promise<void> {
  if (!window.ApiClient) throw new Error('ApiClient unavailable')
  const url = window.ApiClient.getUrl('JellyfinSuite/PlayerEnhancer/Inject')
  await window.ApiClient.ajax({ url, type: 'POST' })
}

export async function removeEnhancer(): Promise<void> {
  if (!window.ApiClient) throw new Error('ApiClient unavailable')
  const url = window.ApiClient.getUrl('JellyfinSuite/PlayerEnhancer/Inject')
  await window.ApiClient.ajax({ url, type: 'DELETE' })
}
