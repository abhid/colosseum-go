import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { RunsPage } from './pages/RunsPage'
import { RunDetailPage } from './pages/RunDetailPage'
import { AgentsPage } from './pages/AgentsPage'
import { AgentDetailPage } from './pages/AgentDetailPage'
import { SettingsPage } from './pages/SettingsPage'
import { ApprovalsPage } from './pages/ApprovalsPage'
import { ToolsPage } from './pages/ToolsPage'
import { EnvironmentsPage } from './pages/EnvironmentsPage'
import { CredentialVaultsPage } from './pages/CredentialVaultsPage'
import { PoliciesPage } from './pages/PoliciesPage'

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/sessions" replace />} />
        <Route path="/sessions" element={<RunsPage />} />
        <Route path="/sessions/:id" element={<RunDetailPage />} />
        <Route path="/runs" element={<Navigate to="/sessions" replace />} />
        <Route path="/runs/:id" element={<RunDetailPage />} />
        <Route path="/agents" element={<AgentsPage />} />
        <Route path="/agents/:id" element={<AgentDetailPage />} />
        <Route path="/tools" element={<ToolsPage />} />
        <Route path="/environments" element={<EnvironmentsPage />} />
        <Route path="/credential-vaults" element={<CredentialVaultsPage />} />
        <Route path="/policies" element={<PoliciesPage />} />
        <Route path="/approvals" element={<ApprovalsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/sessions" replace />} />
      </Routes>
    </Layout>
  )
}

export default App
