import type { FormEvent } from 'react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthLayout, AuthLink } from '../components/auth/AuthLayout'
import { AuthAlert, GoogleSignInButton, PrimaryButton } from '../components/auth/AuthButtons'
import { AuthFormField } from '../components/auth/AuthFormField'
import { signInWithOAuthProvider, signUpWithEmail } from '../lib/auth'
import { resolvePostAuthPath } from '../lib/projects'

export function SignUpPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorMessage(null)
    setSuccessMessage(null)
    setIsSubmitting(true)

    try {
      const result = await signUpWithEmail(email.trim(), password)

      if (result.kind === 'session_created') {
        const nextPath = await resolvePostAuthPath()
        navigate(nextPath, { replace: true })
        return
      }

      setSuccessMessage(
        'Check your email to confirm your account, then sign in to continue.',
      )
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Sign up failed unexpectedly',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleGoogleSignUp() {
    setErrorMessage(null)
    setSuccessMessage(null)
    setIsSubmitting(true)

    try {
      await signInWithOAuthProvider('google')
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Google sign up failed unexpectedly',
      )
      setIsSubmitting(false)
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Start tracking competitors and market signals."
      footer={
        <>
          Already have an account? <AuthLink to="/login">Sign in</AuthLink>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        {errorMessage ? <AuthAlert message={errorMessage} /> : null}
        {successMessage ? <AuthAlert message={successMessage} tone="success" /> : null}

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
          autoComplete="new-password"
          minLength={8}
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        <PrimaryButton disabled={isSubmitting}>
          {isSubmitting ? 'Creating account…' : 'Sign up'}
        </PrimaryButton>
      </form>

      <div className="my-5 flex items-center gap-3 sm:my-6">
        <div className="h-px flex-1 bg-border-hairline" />
        <span className="text-[13px] font-medium text-ink-muted">or continue with</span>
        <div className="h-px flex-1 bg-border-hairline" />
      </div>

      <GoogleSignInButton
        label="Sign up with Google"
        onClick={() => void handleGoogleSignUp()}
        disabled={isSubmitting}
      />
    </AuthLayout>
  )
}
