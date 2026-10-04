import type { FormEvent } from 'react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AuthLayout, AuthLink } from '../components/auth/AuthLayout'
import { AuthAlert, GoogleSignInButton, PrimaryButton } from '../components/auth/AuthButtons'
import { AuthFormField } from '../components/auth/AuthFormField'
import { signInWithEmail, signInWithOAuthProvider } from '../lib/auth'
import { logDevError, userFacingMessage } from '../lib/devLog'
import { resolvePostAuthPath } from '../lib/projects'

export function LoginPage() {
  const { t } = useTranslation()
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
      logDevError('auth email sign in', {
        error: error instanceof Error ? error.message : String(error),
      })
      setErrorMessage(userFacingMessage(error, t('auth.login.failedUnexpected')))
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
      logDevError('auth google sign in', {
        error: error instanceof Error ? error.message : String(error),
      })
      setErrorMessage(userFacingMessage(error, t('auth.login.googleFailedUnexpected')))
      setIsSubmitting(false)
    }
  }

  return (
    <AuthLayout
      title={t('auth.login.title')}
      subtitle={t('auth.login.subtitle')}
      footer={
        <>
          {t('auth.login.footerNeedAccount')}{' '}
          <AuthLink to="/signup">{t('auth.login.footerSignUp')}</AuthLink>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        {errorMessage ? <AuthAlert message={errorMessage} /> : null}

        <AuthFormField
          label={t('auth.email')}
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        <AuthFormField
          label={t('auth.password')}
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        <PrimaryButton disabled={isSubmitting}>
          {isSubmitting ? t('auth.login.submitting') : t('auth.login.submit')}
        </PrimaryButton>
      </form>

      <div className="my-5 flex items-center gap-3 sm:my-6">
        <div className="h-px flex-1 bg-border-hairline" />
        <span className="text-[13px] font-medium text-ink-muted">{t('auth.orContinueWith')}</span>
        <div className="h-px flex-1 bg-border-hairline" />
      </div>

      <GoogleSignInButton
        label={t('auth.login.google')}
        onClick={() => void handleGoogleSignIn()}
        disabled={isSubmitting}
      />
    </AuthLayout>
  )
}
