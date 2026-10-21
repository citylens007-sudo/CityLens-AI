import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiUrl, operationsApi } from './api'
import { geolocationErrorMessage, parseCoordinatePair, parseGpsSidecar } from './location'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('road media API', () => {
  it('resolves protected evidence URLs through the configured API root', () => {
    expect(apiUrl('/evidence/photo-id/preview')).toMatch(/\/api\/v1\/evidence\/photo-id\/preview$/)
  })

  it('requests the persisted image gallery with session credentials', async () => {
    const response = {
      items: [],
      total: 0,
      limit: 50,
      offset: 0,
    }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(operationsApi.imageEvidence()).resolves.toEqual(response)

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/\/api\/v1\/evidence\/images\?limit=50&offset=0$/)
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: 'include' })
  })
})

describe('road video location validation', () => {
  it('accepts valid manual coordinates at the geographic boundaries', () => {
    expect(parseCoordinatePair('-90', '180')).toEqual({
      coordinates: { latitude: -90, longitude: 180 },
    })
  })

  it('rejects incomplete, non-numeric, and out-of-range coordinate pairs', () => {
    expect(parseCoordinatePair('45', '')).toHaveProperty('error')
    expect(parseCoordinatePair('north', '20')).toHaveProperty('error')
    expect(parseCoordinatePair('90.01', '20')).toHaveProperty('error')
    expect(parseCoordinatePair('45', '-180.01')).toHaveProperty('error')
    expect(parseCoordinatePair('', '')).toEqual({ coordinates: null })
  })

  it('parses only sidecar JSON with finite in-range coordinates', () => {
    expect(parseGpsSidecar('{"latitude":45.5,"longitude":-73.6}')).toEqual({
      latitude: 45.5,
      longitude: -73.6,
    })
    expect(() => parseGpsSidecar('not json')).toThrow('valid JSON')
    expect(() => parseGpsSidecar('{"latitude":91,"longitude":0}')).toThrow('valid ranges')
    expect(() => parseGpsSidecar('{"latitude":true,"longitude":0}')).toThrow('valid ranges')
  })

  it('maps browser location errors to actionable messages', () => {
    expect(geolocationErrorMessage(1)).toMatch(/permission was denied/i)
    expect(geolocationErrorMessage(2)).toMatch(/could not determine a location/i)
    expect(geolocationErrorMessage(3)).toMatch(/timed out/i)
  })
})
