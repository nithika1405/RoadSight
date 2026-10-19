import { Navigate, Route, Routes } from 'react-router-dom'

import Layout from './components/Layout.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Detect from './pages/Detect.jsx'
import MapView from './pages/MapView.jsx'
import Records from './pages/Records.jsx'

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/detect" element={<Detect />} />
        <Route path="/map" element={<MapView />} />
        <Route path="/records" element={<Records />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}
