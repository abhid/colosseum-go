import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { RunsPage } from './pages/RunsPage'
import { RunDetailPage } from './pages/RunDetailPage'
import { AgentsPage } from './pages/AgentsPage'
import { SettingsPage } from './pages/SettingsPage'
import { ApprovalsPage } from './pages/ApprovalsPage'
import { ToolsPage } from './pages/ToolsPage'
import { EcosystemPage } from './pages/EcosystemPage'
import { EvaluationsPage } from './pages/EvaluationsPage'

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<RunsPage />} />
        <Route path="/runs/:id" element={<RunDetailPage />} />
        <Route path="/agents" element={<AgentsPage />} />
        <Route path="/tools" element={<ToolsPage />} />
        <Route path="/evaluations" element={<EvaluationsPage />} />
        <Route path="/ecosystem" element={<EcosystemPage />} />
        <Route path="/approvals" element={<ApprovalsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}

export default App
