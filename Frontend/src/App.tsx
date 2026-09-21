import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthProvider'
import { ThemeProvider } from './contexts/ThemeProvider'
import { GuestRoute } from './components/GuestRoute'
import { ProtectedRoute } from './components/ProtectedRoute'
import { RequireOnboardingComplete } from './components/RequireOnboardingComplete'
import { CalendarPage } from './pages/CalendarPage'
import { InsightsPage } from './pages/PlaceholderFeaturePage'
import { AuthCallbackPage } from './pages/AuthCallbackPage'
import { PostizCallbackPage } from './pages/PostizCallbackPage'
import { AgentsPage } from './pages/AgentsPage'
import { DashboardPage, DashboardRedirectPage } from './pages/DashboardPage'
import { EditProfilingPage } from './pages/EditProfilingPage'
import { LoginPage } from './pages/LoginPage'
import { NewProjectPage } from './pages/NewProjectPage'
import { SignUpPage } from './pages/SignUpPage'
import { WelcomeOnboardingPage } from './pages/WelcomeOnboardingPage'
import { OnboardingLanguagePage } from './pages/OnboardingLanguagePage'
import { OnboardingCompetitorsPage } from './pages/OnboardingCompetitorsPage'
import { OnboardingProfilingPage } from './pages/OnboardingProfilingPage'
import { OnboardingProjectTypePage } from './pages/OnboardingProjectTypePage'

function AnalyticsRedirect() {
  const { projectId } = useParams()
  if (!projectId) {
    return <Navigate to="/dashboard" replace />
  }
  return <Navigate to={`/dashboard/${projectId}`} replace />
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <ThemeProvider>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />

            <Route element={<GuestRoute />}>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignUpPage />} />
            </Route>

            <Route path="/auth/callback" element={<AuthCallbackPage />} />
            <Route path="/auth/postiz/callback" element={<PostizCallbackPage />} />

            <Route element={<ProtectedRoute />}>
              <Route path="/welcome" element={<WelcomeOnboardingPage />} />
              <Route path="/onboarding/language" element={<OnboardingLanguagePage />} />
              <Route path="/onboarding/project" element={<OnboardingProjectTypePage />} />
              <Route path="/onboarding/profiling" element={<OnboardingProfilingPage />} />
              <Route path="/onboarding/competitors" element={<OnboardingCompetitorsPage />} />

              <Route element={<RequireOnboardingComplete />}>
                <Route path="/dashboard" element={<DashboardRedirectPage />} />
                <Route path="/dashboard/:projectId" element={<DashboardPage />} />
                <Route path="/dashboard/:projectId/agents" element={<AgentsPage />} />
                <Route path="/dashboard/:projectId/profiling" element={<EditProfilingPage />} />
                <Route path="/dashboard/:projectId/analytics" element={<AnalyticsRedirect />} />
                <Route path="/dashboard/:projectId/calendar" element={<CalendarPage />} />
                <Route path="/dashboard/:projectId/insights" element={<InsightsPage />} />
                <Route path="/projects/new" element={<NewProjectPage />} />
                <Route path="/avatars/new" element={<NewProjectPage />} />
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </ThemeProvider>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
