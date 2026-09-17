import type { FormEvent } from 'react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AuthLayout, AuthLink } from '../components/auth/AuthLayout'
import { AuthAlert, GoogleSignInButton, PrimaryButton } from '../components/auth/AuthButtons'
import { AuthFormField } from '../components/auth/AuthFormField'
import { LanguageSelector } from '../components/LanguageSelector'
import { signInWithOAuthProvider, signUpWithEmail } from '../lib/auth'
import { resolvePostAuthPath } from '../lib/projects'

export function SignUpPage() {
  const { t } = useTranslation()
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

      setSuccessMessage(t('auth.signup.checkEmail'))
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : t('auth.signup.failedUnexpected'),
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
        error instanceof Error ? error.message : t('auth.signup.googleFailedUnexpected'),
      )
      setIsSubmitting(false)
    }
  }

  return (
    <AuthLayout
      title={t('auth.signup.title')}
      subtitle={t('auth.signup.subtitle')}
      footer={
        <>
          {t('auth.signup.footerHaveAccount')}{' '}
          <AuthLink to="/login">{t('auth.signup.footerSignIn')}</AuthLink>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        {errorMessage ? <AuthAlert message={errorMessage} /> : null}
        {successMessage ? <AuthAlert message={successMessage} tone="success" /> : null}

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
          autoComplete="new-password"
          minLength={8}
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        <div className="space-y-1.5">
          <label
            htmlFor="signup-language-select"
            className="block text-sm font-medium text-ink"
          >
            {t('auth.language')}
          </label>
          <LanguageSelector
            id="signup-language-select"
            className="w-full rounded-xl border border-border-hairline bg-canvas px-4 py-3 text-sm text-ink transition hover:border-border-hairline/80 hover:bg-canvas-raised"
          />
        </div>

        <PrimaryButton disabled={isSubmitting}>
          {isSubmitting ? t('auth.signup.submitting') : t('auth.signup.submit')}
        </PrimaryButton>
      </form>

      <div className="my-5 flex items-center gap-3 sm:my-6">
        <div className="h-px flex-1 bg-border-hairline" />
        <span className="text-[13px] font-medium text-ink-muted">{t('auth.orContinueWith')}</span>
        <div className="h-px flex-1 bg-border-hairline" />
      </div>

      <GoogleSignInButton
        label={t('auth.signup.google')}
        onClick={() => void handleGoogleSignUp()}
        disabled={isSubmitting}
      />
    </AuthLayout>
  )
}
