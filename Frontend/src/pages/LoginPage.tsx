import type { FormEvent } from 'react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthLayout, AuthLink } from '../components/auth/AuthLayout'
import { AuthAlert, GoogleSignInButton, PrimaryButton } from '../components/auth/AuthButtons'
import { AuthFormField } from '../components/auth/AuthFormField'
import { signInWithEmail, signInWithOAuthProvider } from '../lib/auth'
import { resolvePostAuthPath } from '../lib/projects'

export function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorMessage(null)
    setIsSubmitting(true)

    try {
      await signInWithEmail(email.trim(), password)
      const nextPath = await resolvePostAuthPath()
      navigate(nextPath, { replace: true })
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Sign in failed unexpectedly',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleGoogleSignIn() {
    setErrorMessage(null)
    setIsSubmitting(true)

    try {
      await signInWithOAuthProvider('google')
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Google sign in failed unexpectedly',
      )
      setIsSubmitting(false)
    }
  }

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Access your competitor intelligence workspace."
      footer={
        <>
          Need an account? <AuthLink to="/signup">Sign up</AuthLink>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        {errorMessage ? <AuthAlert message={errorMessage} /> : null}

        <AuthFormField
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        <AuthFormField
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        <PrimaryButton disabled={isSubmitting}>
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </PrimaryButton>
      </form>

      <div className="my-5 flex items-center gap-3 sm:my-6">
        <div className="h-px flex-1 bg-border-hairline" />
        <span className="text-[13px] font-medium text-ink-muted">or continue with</span>
        <div className="h-px flex-1 bg-border-hairline" />
      </div>

      <GoogleSignInButton
        label="Sign in with Google"
        onClick={() => void handleGoogleSignIn()}
        disabled={isSubmitting}
      />
    </AuthLayout>
  )
}
