import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthProvider'
import { GuestRoute } from './components/GuestRoute'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AuthCallbackPage } from './pages/AuthCallbackPage'
import { AgentsPage } from './pages/AgentsPage'
import { DashboardPage, DashboardRedirectPage } from './pages/DashboardPage'
import { EditProfilingPage } from './pages/EditProfilingPage'
import { LoginPage } from './pages/LoginPage'
import { NewProjectPage } from './pages/NewProjectPage'
import { SignUpPage } from './pages/SignUpPage'

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />

          <Route element={<GuestRoute />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignUpPage />} />
          </Route>

          <Route path="/auth/callback" element={<AuthCallbackPage />} />

          <Route element={<ProtectedRoute />}>
            <Route path="/dashboard" element={<DashboardRedirectPage />} />
            <Route path="/dashboard/:projectId" element={<DashboardPage />} />
            <Route path="/dashboard/:projectId/agents" element={<AgentsPage />} />
            <Route path="/dashboard/:projectId/profiling" element={<EditProfilingPage />} />
            <Route path="/projects/new" element={<NewProjectPage />} />
            <Route path="/avatars/new" element={<NewProjectPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
