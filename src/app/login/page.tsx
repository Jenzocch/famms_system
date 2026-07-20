'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { Loader2, Wrench, Eye, EyeOff } from 'lucide-react'
import { accountNameToEmail } from '@/lib/login-name'
import { useI18n } from '@/lib/i18n'
import LanguageSwitcher from '@/components/shared/LanguageSwitcher'

export default function LoginPage() {
  const router = useRouter()
  const { t } = useI18n()
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    // Created lazily here (not during render) so the page can be statically
    // prerendered at build time without Supabase env vars present.
    const supabase = createClient()
    try {
      // Accept a login name (mapped to a synthetic email) or a real email.
      const email = accountNameToEmail(account)
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
      router.push('/dashboard')
      router.refresh()
    } catch {
      toast.error(t('login.invalidCredentials'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      {/* Language switcher — first screen users hit, so let them pick a language */}
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>

      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-blue-600 rounded-2xl mb-4 shadow-lg">
            <Wrench className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{t('login.appTitle')}</h1>
          <p className="text-sm text-gray-500 mt-1">{t('login.appSubtitle')}</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-6">{t('login.signIn')}</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="account">{t('login.account')}</Label>
              <Input
                id="account"
                type="text"
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                placeholder={t('login.accountPlaceholder')}
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="username"
                required
                className="mt-1 h-12 text-base"
              />
            </div>
            <div>
              <Label htmlFor="password">{t('login.password')}</Label>
              <div className="relative mt-1">
                <Input
                  id="password"
                  type={showPwd ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                  className="h-12 pr-10 text-base"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(v => !v)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600"
                  tabIndex={-1}
                  aria-label={showPwd ? t('login.hidePassword') : t('login.showPassword')}
                >
                  {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <Button type="submit" className="w-full h-12 text-base" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t('login.submit')}
            </Button>
          </form>

          <p className="text-center text-xs text-gray-400 mt-6">
            {t('login.adminNote')}
          </p>
        </div>
      </div>
    </div>
  )
}
