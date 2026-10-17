import { useEffect } from 'react'
import L from 'leaflet'
import { MapContainer, Marker, TileLayer, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import type { DefectReport } from '../types'

function MapResize() {
  const map = useMap()
  useEffect(() => {
    const timer = window.setTimeout(() => map.invalidateSize(), 120)
    return () => window.clearTimeout(timer)
  }, [map])
  return null
}

function makeMarkerIcon(priority: string) {
  return L.divIcon({
    className: 'leaflet-citylens-marker',
    html: `<span class="map-marker map-marker-${priority.toLowerCase()}"></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  })
}

export function MapView({
  reports = [],
  onSelect,
  preview = false,
}: {
  reports?: DefectReport[]
  onSelect?: (report: DefectReport) => void
  preview?: boolean
}) {
  const geolocatedReports = reports.filter((report) => report.coordinates)

  return (
    <div className={`map-frame${preview ? ' map-frame-preview' : ''}`}>
      <MapContainer center={[20, 0]} zoom={2} minZoom={2} scrollWheelZoom={!preview} worldCopyJump>
        <MapResize />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {geolocatedReports.map((report) => (
          <Marker
            eventHandlers={{ click: () => onSelect?.(report) }}
            icon={makeMarkerIcon(report.priority)}
            key={report.id}
            position={[report.coordinates!.latitude, report.coordinates!.longitude]}
          />
        ))}
      </MapContainer>
      {geolocatedReports.length === 0 && (
        <div className="map-empty-note">
          <span className="map-empty-dot" />
          <span>No GPS-tagged reports in this {preview ? 'demo' : 'view'}</span>
        </div>
      )}
      <span className="map-demo-label">{geolocatedReports.some((report) => report.demo) ? 'DEMO MARKERS' : 'LIVE MAP'}</span>
    </div>
  )
}