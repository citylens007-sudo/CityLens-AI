export interface Coordinates {
  latitude: number
  longitude: number
}

export type CoordinatePairResult =
  | { coordinates: Coordinates | null }
  | { error: string }

export function parseCoordinatePair(latitudeText: string, longitudeText: string): CoordinatePairResult {
  const latitudeInput = latitudeText.trim()
  const longitudeInput = longitudeText.trim()
  if (!latitudeInput && !longitudeInput) return { coordinates: null }
  if (!latitudeInput || !longitudeInput) {
    return { error: 'Enter both coordinates, or leave both blank.' }
  }

  const latitude = Number(latitudeInput)
  const longitude = Number(longitudeInput)
  if (
    !Number.isFinite(latitude)
    || !Number.isFinite(longitude)
    || latitude < -90
    || latitude > 90
    || longitude < -180
    || longitude > 180
  ) {
    return { error: 'Latitude must be between -90 and 90 and longitude between -180 and 180.' }
  }

  return { coordinates: { latitude, longitude } }
}

export function parseGpsSidecar(contents: string): Coordinates {
  let payload: unknown
  try {
    payload = JSON.parse(contents)
  } catch {
    throw new Error('The GPS sidecar must contain valid JSON.')
  }
  if (
    typeof payload !== 'object'
    || payload === null
    || !('latitude' in payload)
    || !('longitude' in payload)
    || typeof payload.latitude !== 'number'
    || typeof payload.longitude !== 'number'
    || !Number.isFinite(payload.latitude)
    || !Number.isFinite(payload.longitude)
    || payload.latitude < -90
    || payload.latitude > 90
    || payload.longitude < -180
    || payload.longitude > 180
  ) {
    throw new Error('The GPS sidecar must contain latitude and longitude numbers within valid ranges.')
  }
  return { latitude: payload.latitude, longitude: payload.longitude }
}

export function geolocationErrorMessage(code: number): string {
  switch (code) {
    case 1:
      return 'Location permission was denied. Allow location access in your browser settings, then retry.'
    case 2:
      return 'Your device could not determine a location. Check GPS or network availability, then retry.'
    case 3:
      return 'Location detection timed out. Move to an area with a clearer signal, then retry.'
    default:
      return 'The device location could not be detected. Check location settings, then retry.'
  }
}
