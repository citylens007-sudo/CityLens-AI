import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { demoDefects } from '../data/demo'
import { MapView } from './MapView'
import { Panel } from './ui'

export default function DashboardMapPanel() {
  return (
    <Panel className="map-panel" subtitle="Global view · demo records include no GPS coordinates" title="Road health map" action={<Link className="panel-link" to="/map">Open map <ArrowRight size={14} /></Link>}>
      <MapView preview reports={demoDefects} />
    </Panel>
  )
}