import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import FleetOverview from './pages/FleetOverview'
import FunnelAnalysis from './pages/FunnelAnalysis'
import CompletionRates from './pages/CompletionRates'
import DeviceList from './pages/DeviceList'
import DeviceDetail from './pages/DeviceDetail'
import ProblemDetection from './pages/ProblemDetection'
import SpatialView from './pages/SpatialView'

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<FleetOverview />} />
          <Route path="/funnel" element={<FunnelAnalysis />} />
          <Route path="/completion" element={<CompletionRates />} />
          <Route path="/devices" element={<DeviceList />} />
          <Route path="/devices/:device_id" element={<DeviceDetail />} />
          <Route path="/problems" element={<ProblemDetection />} />
          <Route path="/spatial" element={<SpatialView />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}
