import { createContext, useContext } from 'react'

export const AppDataContext = createContext(null)

export function useAppData() {
  const context = useContext(AppDataContext)
  if (!context) throw new Error('useAppData must be used inside <AppDataProvider>')
  return context
}

/** Convenience hook for the backend config with sensible fallbacks. */
export function useConfig() {
  const { config } = useAppData()
  return {
    severities: config?.severities || ['low', 'medium', 'high', 'critical'],
    statuses: config?.statuses || ['pending', 'inspected', 'repaired'],
    defaultCenter: config?.default_center || { lat: 12.9716, lng: 77.5946 },
    uploadLimits: config?.uploads || { images: [], videos: [], max_image_mb: 15, max_video_mb: 200 },
    version: config?.version || '1.0.0',
  }
}
