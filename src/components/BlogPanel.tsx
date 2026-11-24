import { useEffect, useState, type FormEvent } from 'react'
import { BlogError, blogPlugin, connectGhost, connectMicroblog, connectWordPress, type Service } from '../lib/blog'

const quiet = 'nib-tap cursor-pointer text-[11px] text-muted hover:text-ink disabled:cursor-default'
const primary = 'nib-tap w-full cursor-pointer rounded-md bg-ink py-2 text-[12px] font-medium text-paper disabled:cursor-default disabled:opacity-50'
const secondary = 'nib-tap w-full cursor-pointer rounded-md border border-line py-2 text-[12px] hover:bg-item-hover disabled:cursor-default disabled:opacity-50'
const SERVICES: Record<Service, string> = { wordpress: 'WordPress', ghost: 'Ghost', microblog: 'Micro.blog' }
const field = 'mt-1 h-[30px] w-full rounded-md border border-line bg-paper px-[9px] text-[12px] text-ink outline-none placeholder:text-muted pointer-coarse:h-11 pointer-coarse:text-[16px]'

/**
 * Settings → Your blog (Nib Plus, in the app): a blog connected on this
 * device, or taken off. A WordPress one by its address, a username and an
 * application password; a Ghost one by its API URL and Admin API key; one on
 * Micro.blog by an app token. Its key is kept in the Keychain and never shown again
 * (lib/blog). A document is sent to it from Commands.
 */
export function BlogPanel({ plus = true, onBack }: {
  /** Without Nib Plus the panel is only here to disconnect a blog connected with it: its key isn't left on the device with no way to take it off. */
  plus?: boolean
  onBack: () => void
}) {
  // Not known till the Keychain has said.
  const [blog, setBlog] = useState<{ site?: string; user?: string } | null>(null)
  useEffect(() => {
    blogPlugin.blog().then(setBlog, () => setBlog({}))
  }, [])
  const [service, setService] = useState<Service>('wordpress')
  const ghost = service === 'ghost'
  const microblog = service === 'microblog'
  const [site, setSite] = useState('')
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function connect(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const connected = microblog ? await connectMicroblog(password) : ghost ? await connectGhost(site, password) : await connectWordPress(site, user, password)
      setBlog({ site: connected.site, user: ghost || microblog ? undefined : user.trim() })
      setPassword('')
    } catch (failed) {
      setError(failed instanceof BlogError ? failed.message : 'Couldn’t connect that blog.')
    } finally {
      setBusy(false)
    }
  }

  async function disconnect() {
    setBusy(true)
    setError(null)
    try {
      await blogPlugin.forget()
      setBlog({})
      if (!plus) onBack()
    } catch {
      // Not said to be gone while it isn't.
      setError('Couldn’t disconnect: your blog’s key is still on this device. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <button onClick={onBack} className={quiet}>
          ← Back
        </button>
        <span className="text-[11px] text-faint">Your blog</span>
      </div>
      <p className="mt-3 text-[11px] leading-[1.5] text-muted">
        Send a note or page to your blog as a draft, from Commands, and publish it there. Sending it again changes that post.
      </p>
      {blog?.site ? (
        <>
          <div className="mt-3 text-[12px] font-medium">Connected to {new URL(blog.site).host}</div>
          {blog.user && <p className="mt-0.5 text-[11px] text-muted">As {blog.user}</p>}
          <button onClick={() => void disconnect()} disabled={busy} className={`${secondary} mt-3`}>
            Disconnect
          </button>
          {error && (
            <p role="alert" className="mt-2 text-[11px] leading-[1.5] text-ink">
              {error}
            </p>
          )}
        </>
      ) : (
        blog &&
        plus && (
          <form onSubmit={(event) => void connect(event)} className="mt-3 flex flex-col gap-2">
            <div role="group" aria-label="Where your blog is" className="flex gap-px rounded-md border border-line p-px text-[11px]">
              {(Object.keys(SERVICES) as Service[]).map((one) => (
                <button
                  key={one}
                  type="button"
                  aria-pressed={one === service}
                  onClick={() => {
                    setService(one)
                    setPassword('')
                    setError(null)
                  }}
                  className="nib-tap flex-1 cursor-pointer rounded-[4px] py-1 text-muted aria-pressed:bg-item-active aria-pressed:text-ink pointer-coarse:min-h-11"
                >
                  {SERVICES[one]}
                </button>
              ))}
            </div>
            {!microblog && (
              <label className="text-[11px] text-muted">
                {ghost ? 'API URL' : 'Address'}
                <input value={site} onChange={(event) => setSite(event.target.value)} placeholder={ghost ? 'yourblog.ghost.io' : 'yourblog.com'} autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="url" className={field} />
              </label>
            )}
            {service === 'wordpress' && (
              <label className="text-[11px] text-muted">
                Username
                <input value={user} onChange={(event) => setUser(event.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" className={field} />
              </label>
            )}
            <label className="text-[11px] text-muted">
              {microblog ? 'App token' : ghost ? 'Admin API key' : 'Application password'}
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="off" className={field} />
            </label>
            <p className="text-[10.5px] leading-[1.5] text-faint">
              {microblog
                ? 'Make one on Micro.blog, under Account → App tokens. It lets Nib post to your blog, and you can delete it there. Posts go to your first blog there.'
                : ghost
                  ? 'Make one in Ghost, under Settings → Integrations → Add custom integration, and copy its API URL and Admin API key. It lets Nib post to your site, and deleting the integration there stops it.'
                  : 'Make one in WordPress, under Users → Profile → Application Passwords. It lets Nib post as you, and you can revoke it there.'}
            </p>
            {error && (
              <p role="alert" className="text-[11px] leading-[1.5] text-ink">
                {error}
              </p>
            )}
            <button type="submit" disabled={busy || (!microblog && !site.trim()) || (service === 'wordpress' && !user.trim()) || !password.trim()} className={primary}>
              {busy ? 'Connecting…' : 'Connect'}
            </button>
          </form>
        )
      )}
      <p className="mt-3 text-[10.5px] leading-[1.5] text-faint">
        Its address and key stay in this device’s Keychain, and Nib sends to your blog from here: nothing goes through Nib’s server. Connect it on each device you send from.
      </p>
    </div>
  )
}
