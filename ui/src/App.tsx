import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { LoadingState } from './components/Common'

const RunsPage = lazy(() => import('./pages/RunsPage').then((module) => ({ default: module.RunsPage })))
const RunDetailPage = lazy(() => import('./pages/RunDetailPage').then((module) => ({ default: module.RunDetailPage })))
const AgentsPage = lazy(() => import('./pages/AgentsPage').then((module) => ({ default: module.AgentsPage })))
const AgentDetailPage = lazy(() => import('./pages/AgentDetailPage').then((module) => ({ default: module.AgentDetailPage })))
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })))
const ApprovalsPage = lazy(() => import('./pages/ApprovalsPage').then((module) => ({ default: module.ApprovalsPage })))
const ToolsPage = lazy(() => import('./pages/ToolsPage').then((module) => ({ default: module.ToolsPage })))
const EnvironmentsPage = lazy(() => import('./pages/EnvironmentsPage').then((module) => ({ default: module.EnvironmentsPage })))
const CredentialVaultsPage = lazy(() => import('./pages/CredentialVaultsPage').then((module) => ({ default: module.CredentialVaultsPage })))
const PoliciesPage = lazy(() => import('./pages/PoliciesPage').then((module) => ({ default: module.PoliciesPage })))
const ChatPage = lazy(() => import('./pages/ChatPage').then((module) => ({ default: module.ChatPage })))

function App() {
  return (
    <Layout>
      <Suspense fallback={<LoadingState label="Loading page..." />}>
        <Routes>
          <Route path="/" element={<Navigate to="/runs" replace />} />
          <Route path="/runs" element={<RunsPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/chat/:sessionID" element={<ChatPage />} />
          <Route path="/runs/:id" element={<RunDetailPage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/agents/:id" element={<AgentDetailPage />} />
          <Route path="/tools" element={<ToolsPage />} />
          <Route path="/environments" element={<EnvironmentsPage />} />
          <Route path="/credential-vaults" element={<CredentialVaultsPage />} />
          <Route path="/policies" element={<PoliciesPage />} />
          <Route path="/approvals" element={<ApprovalsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/runs" replace />} />
        </Routes>
      </Suspense>
    </Layout>
  )
}

export default App
