/**
 * The private page feedback is read on, from a phone or any browser. It holds
 * no message: it asks for FEEDBACK_KEY, keeps it in this browser, and fetches
 * them with it. A message was written by anyone at all, so it only ever goes
 * on the page as text. {{NONCE}} is filled in for each response (worker/feedback).
 */
export const INBOX_PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="color-scheme" content="light dark" />
    <title>Nib feedback</title>
    <style nonce="{{NONCE}}">
      :root { color-scheme: light dark; --paper: #fff; --ink: #1c1b19; --muted: #6e6a64; --line: #e4e1dc; }
      @media (prefers-color-scheme: dark) { :root { --paper: #171614; --ink: #eceae6; --muted: #a39f98; --line: #34322e; } }
      * { box-sizing: border-box; }
      [hidden] { display: none !important; }
      body { margin: 0; background: var(--paper); color: var(--ink); font: 16px/1.5 -apple-system, system-ui, sans-serif; }
      main { max-width: 640px; margin: 0 auto; padding: max(24px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) 48px max(16px, env(safe-area-inset-left)); }
      h1 { margin: 0 0 4px; font-size: 22px; font-weight: 600; }
      form { display: grid; gap: 10px; margin-top: 12px; }
      label, #state, .about { color: var(--muted); font-size: 14px; }
      #state { margin: 0 0 16px; }
      input { width: 100%; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: transparent; color: inherit; font: inherit; }
      button { min-height: 44px; padding: 0 14px; border: 1px solid var(--line); border-radius: 8px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
      button:disabled { opacity: 0.5; }
      ul { margin: 0 0 24px; padding: 0; list-style: none; }
      li { padding: 14px 0; border-top: 1px solid var(--line); }
      .text { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
      .about { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 8px; }
      #wrong { margin: 0; }
    </style>
  </head>
  <body>
    <main>
      <h1>Nib feedback</h1>
      <p id="state" role="status"></p>
      <form id="unlock" hidden>
        <label for="key">Key</label>
        <input id="key" name="password" type="password" autocomplete="current-password" autocapitalize="none" spellcheck="false" required />
        <button>Open</button>
        <p id="wrong" role="alert" hidden>That key didn’t open it.</p>
      </form>
      <ul id="messages"></ul>
      <button id="lock" type="button" hidden>Forget the key on this device</button>
    </main>
    <script nonce="{{NONCE}}">
      ;(() => {
        const STORED = 'nib-feedback-key'
        const NAMES = { iphone: 'iPhone', ipad: 'iPad', mac: 'Mac' }
        const byId = (id) => document.getElementById(id)
        const remembered = () => { try { return localStorage.getItem(STORED) } catch { return null } }
        const remember = (value) => { try { localStorage.setItem(STORED, value) } catch {} }
        const forget = () => { try { localStorage.removeItem(STORED) } catch {} }
        let key = remembered()

        const say = (words) => { byId('state').textContent = words }
        const authorised = () => ({ Authorization: 'Bearer ' + key })

        function counted() {
          const n = byId('messages').children.length
          say(n === 0 ? 'No messages.' : n === 1 ? '1 message.' : n + ' messages.')
        }

        function asking(wrong) {
          say('')
          byId('messages').replaceChildren()
          byId('lock').hidden = true
          byId('unlock').hidden = false
          byId('wrong').hidden = !wrong
        }

        function row(message) {
          const item = document.createElement('li')
          const text = document.createElement('p')
          text.className = 'text'
          text.dir = 'auto'
          text.textContent = message.text
          const about = document.createElement('div')
          about.className = 'about'
          const from = document.createElement('span')
          from.textContent = NAMES[message.device] + ', Nib ' + message.version + ', ' + message.day
          const remove = document.createElement('button')
          remove.type = 'button'
          remove.textContent = 'Delete'
          remove.addEventListener('click', async () => {
            if (!confirm('Delete this message for good?')) return
            remove.disabled = true
            const done = await fetch('/v1/feedback/messages/' + message.id, { method: 'DELETE', headers: authorised() }).catch(() => null)
            if (!done || !done.ok) {
              remove.disabled = false
              say('That didn’t delete. Please try again.')
              return
            }
            item.remove()
            counted()
          })
          about.append(from, remove)
          item.append(text, about)
          return item
        }

        async function load() {
          say('Loading…')
          const response = await fetch('/v1/feedback/messages', { headers: authorised(), cache: 'no-store' }).catch(() => null)
          if (response && response.status === 404) {
            forget()
            key = null
            asking(true)
            return
          }
          if (!response || !response.ok) {
            say('Can’t reach the server. Reload to try again.')
            return
          }
          const { messages } = await response.json()
          remember(key)
          byId('key').value = ''
          byId('unlock').hidden = true
          byId('lock').hidden = false
          byId('messages').replaceChildren(...messages.map(row))
          counted()
        }

        byId('unlock').addEventListener('submit', (event) => {
          event.preventDefault()
          key = byId('key').value.trim()
          if (key) void load()
        })
        byId('lock').addEventListener('click', () => {
          forget()
          key = null
          asking(false)
        })

        if (key) void load()
        else asking(false)
      })()
    </script>
  </body>
</html>
`
