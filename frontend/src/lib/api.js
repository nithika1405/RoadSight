/**
 * Thin REST client for the RoadSight backend.
 * When VITE_API_BASE_URL is empty the dev server proxies /api to FastAPI.
 */
const BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

export const API_BASE = BASE

export function qs(params = {}) {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    if (Array.isArray(value)) {
      if (!value.length) return
      search.set(key, value.join(','))
      return
    }
    if (typeof value === 'boolean') {
      search.set(key, value ? 'true' : 'false')
      return
    }
    search.set(key, String(value))
  })
  const text = search.toString()
  return text ? `?${text}` : ''
}

async function errorMessage(response) {
  try {
    const data = await response.json()
    const detail = data?.detail
    if (Array.isArray(detail)) {
      return detail.map((item) => `${(item.loc || []).slice(1).join('.')}: ${item.msg}`).join(' · ')
    }
    if (typeof detail === 'string') return detail
    if (detail) return JSON.stringify(detail)
    return `${response.status} ${response.statusText}`
  } catch {
    return `${response.status} ${response.statusText}`
  }
}

async function request(path, { method = 'GET', body, signal } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    signal,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!response.ok) throw new Error(await errorMessage(response))
  if (response.status === 204) return null
  return response.json()
}

export function uploadWithProgress(path, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${BASE}${path}`)
    xhr.timeout = 15 * 60 * 1000
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)))
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          onProgress?.(100)
          resolve(JSON.parse(xhr.responseText))
        } catch {
          reject(new Error('The server returned a malformed response'))
        }
        return
      }
      let message = `${xhr.status} ${xhr.statusText}`
      try {
        const data = JSON.parse(xhr.responseText)
        if (typeof data?.detail === 'string') message = data.detail
        else if (Array.isArray(data?.detail)) message = data.detail.map((d) => d.msg).join(' · ')
      } catch {
        /* keep the status text */
      }
      reject(new Error(message))
    }
    xhr.onerror = () => reject(new Error('Network error while uploading'))
    xhr.ontimeout = () => reject(new Error('The upload timed out'))
    xhr.send(formData)
  })
}

export function mediaUrl(path) {
  if (!path) return null
  if (/^https?:/i.test(path)) return path
  return `${BASE}${path}`
}

export const api = {
  health: () => request('/api/health'),
  config: () => request('/api/config'),

  listPotholes: (params, signal) => request(`/api/potholes${qs(params)}`, { signal }),
  getPothole: (id) => request(`/api/potholes/${id}`),
  createPothole: (payload) => request('/api/potholes', { method: 'POST', body: payload }),
  updatePothole: (id, payload) => request(`/api/potholes/${id}`, { method: 'PATCH', body: payload }),
  deletePothole: (id) => request(`/api/potholes/${id}`, { method: 'DELETE' }),
  stats: (params, signal) => request(`/api/potholes/stats${qs(params)}`, { signal }),
  route: (params) => request(`/api/potholes/route${qs(params)}`),
  exportUrl: (params) => `${BASE}/api/potholes/export.csv${qs(params)}`,

  detectImage: (formData, onProgress) => uploadWithProgress('/api/detect/image', formData, onProgress),
  detectVideo: (formData, onProgress) => uploadWithProgress('/api/detect/video', formData, onProgress),
  detectionLimits: () => request('/api/detect/limits'),
  streamStatus: () => request('/api/stream/status'),
  streamUrl: () => `${BASE}/api/stream/events`,
}

export function downloadCsv(params, filename) {
  const link = document.createElement('a')
  link.href = api.exportUrl(params)
  link.setAttribute('download', filename || 'potholes.csv')
  document.body.appendChild(link)
  link.click()
  link.remove()
}
