import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BUNDLE_ID, PRODUCT_IDS } from '../worker/jws'
import { KEPT_MONTHS } from '../worker/library'
import { LIBRARY_IDLE_MS, MAX_LIBRARIES } from '../worker/subscriber'
import { FILES_LIMIT, FREE_DAYS, INBOX_BYTES, INBOX_DAILY, INBOX_DAYS, INBOX_WAITING, MAX_FILE, MAX_POST, MAX_SEALED_POST, SHARE_DAYS } from '../worker/wire.mjs'
import config from '../capacitor.config'
import { FORMATS } from './editor/formats'
import { RICH_FORMATS } from './lib/documentExport'
import { SHARE_ORIGIN, SYNC_ORIGIN } from './lib/hosts'
import { linkAction } from './lib/inbox'
import { LOCK_AFTER } from './lib/lock'
import { MIRROR_DIR, MIRROR_FILE, MIRROR_TEMP } from './lib/mirror'
import { NAMED, SHELL, WINTER } from './lib/theme'
import { SERVER_HISTORY_MS } from './sync/engine'

/**
 * Swift and JavaScript can't share a constant, so what crosses between them
 * is read here as text and held against the TypeScript: a name changed on one
 * side fails this instead of doing nothing without a word in the app.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const app = (file: string) => read(`ios/App/App/${file}`)

/** Every match, and at least one: what was looked for having moved is a failure, not nothing to compare. */
function found(text: string, pattern: RegExp): RegExpExecArray[] {
  const matches = [...text.matchAll(pattern)]
  expect(matches, `${pattern} found nothing`).not.toEqual([])
  return matches
}
const firsts = (text: string, pattern: RegExp) => found(text, pattern).map((match) => match[1])

/** All of the app's own code, tests aside. */
const page = readdirSync(new URL('.', import.meta.url), { recursive: true, encoding: 'utf8' })
  .filter((file) => /\.tsx?$/.test(file) && !file.includes('.test.'))
  .map((file) => read(`src/${file}`))
  .join('\n')
const html = read('index.html')
const menu = app('AppDelegate.swift')
const main = app('MainViewController.swift')
const lockPlugin = app('NibLockPlugin.swift')
const pbxproj = read('ios/App/App.xcodeproj/project.pbxproj')
const plist = app('Info.plist')

const pluginFiles = readdirSync(new URL('../ios/App/App/', import.meta.url)).filter((file) => /^Nib\w+Plugin\.swift$/.test(file))
const swiftPlugins = pluginFiles.map((file) => {
  const swift = app(file)
  return { className: file.replace('.swift', ''), jsName: firsts(swift, /jsName = "(\w+)"/g)[0], methods: firsts(swift, /CAPPluginMethod\(name: "(\w+)"/g).sort() }
})

/** The methods a plugin's TypeScript type gives it, inline in registerPlugin<{…}> or by an interface's name. `addListener` is Capacitor's own. */
function typedMethods(jsName: string): string[] {
  const end = `>('${jsName}')`
  const part = page.split('registerPlugin<').find((one) => one.includes(end))
  expect(part, `no registerPlugin for ${jsName}`).toBeDefined()
  const type = part!.slice(0, part!.indexOf(end))
  const body = type.startsWith('{') ? type : found(page, new RegExp(`interface ${type} \\{([\\s\\S]*?)\\n\\}`, 'g'))[0][1]
  return firsts(body, /(?:^\s*|\{ )([a-z]\w*)\(/gm).filter((name) => name !== 'addListener').sort()
}

describe('the native plugins and the page', () => {
  it('registers every plugin in the app', () => {
    expect(firsts(main, /registerPluginInstance\((\w+)\(\)\)/g).sort()).toEqual(swiftPlugins.map((plugin) => plugin.className).sort())
  })

  // `painted` comes from index.html, by name, before any of the app's own code has loaded.
  it.each(swiftPlugins)('has the same methods on both sides of $jsName', ({ jsName, methods }) => {
    expect(typedMethods(jsName)).toEqual(methods.filter((name) => !(jsName === 'NibWindow' && name === 'painted')))
  })

  it('finds the one method only index.html calls', () => {
    expect(swiftPlugins.find((plugin) => plugin.jsName === 'NibWindow')?.methods).toContain('painted')
    expect(html).toContain("cap.nativePromise('NibWindow', 'painted', {})")
  })
})

describe('what the store and Apple know Nib by', () => {
  it('has the one set of product ids', () => {
    const storekit = JSON.parse(read('ios/App/Nib.storekit')) as { subscriptionGroups: { subscriptions: { productID: string }[] }[] }
    const swift = firsts(app('NibStorePlugin.swift'), /productIDs = \[([^\]]+)\]/g)[0]
    expect(firsts(swift, /"([^"]+)"/g)).toEqual(PRODUCT_IDS)
    expect(storekit.subscriptionGroups.flatMap((group) => group.subscriptions.map((subscription) => subscription.productID))).toEqual(PRODUCT_IDS)
  })

  it('has the one bundle id, with its two extensions under it', () => {
    expect(config.appId).toBe(BUNDLE_ID)
    expect(firsts(pbxproj, /\bPRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g).sort()).toEqual([BUNDLE_ID, BUNDLE_ID, `${BUNDLE_ID}.share`, `${BUNDLE_ID}.share`, `${BUNDLE_ID}.widgets`, `${BUNDLE_ID}.widgets`])
    expect(firsts(plist, /<key>CFBundleURLName<\/key>\s*<string>([^<]+)</g)).toEqual([BUNDLE_ID])
  })

  it('has the one App Group, under the bundle id', () => {
    const group = `group.${BUNDLE_ID}`
    expect(firsts(app('NibInbox.swift'), /static let group = "([^"]+)"/g)).toEqual([group])
    expect(firsts(app('App.entitlements'), /application-groups<\/key>\s*<array>\s*<string>([^<]+)</g)).toEqual([group])
    expect(firsts(read('ios/App/NibShare/NibShare.entitlements'), /application-groups<\/key>\s*<array>\s*<string>([^<]+)</g)).toEqual([group])
  })

  it('names the same alternate icons in the project, the page and the asset catalogue', () => {
    const page = firsts(read('src/components/Customize.tsx'), /name: '(AppIcon-\w+)'/g)
    const lines = firsts(pbxproj, /ALTERNATE_APPICON_NAMES\[sdk=iphone\*\]" = "([^"]+)"/g)
    expect(lines).toHaveLength(2)
    for (const line of lines) expect(line.split(' ')).toEqual(page)
    const catalogue = readdirSync(new URL('../ios/App/App/Assets.xcassets/', import.meta.url))
    for (const icon of page) expect(catalogue).toContain(`${icon}.appiconset`)
  })

  it('has the hosts in wrangler.jsonc and the scripts as the app has them', () => {
    const wrangler = read('wrangler.jsonc')
    for (const origin of [SYNC_ORIGIN, SHARE_ORIGIN]) expect(wrangler).toContain(`"pattern": "${new URL(origin).host}"`)
    for (const script of ['scripts/coin-code.mjs', 'scripts/counts.mjs']) expect(read(script)).toContain(`process.env.NIB_SERVER ?? '${SYNC_ORIGIN}'`)
    const release = read('scripts/release-web.mjs')
    expect(release).toContain(`'${SYNC_ORIGIN}/privacy'`)
    expect(release).toContain(`'${SHARE_ORIGIN}/reader.js'`)
  })
})

/**
 * iOS's file picker greys out a file whose kind it doesn't know, and it knows a kind by its ending only where the
 * system or an app says what that ending is. So every ending the import control lists is one the system knows of
 * itself, or one Nib's Info.plist says it reads (seen on the simulator: `UTType(filenameExtension:)` is a made-up
 * kind for the rest, as it was for the theme file that couldn't be picked).
 */
describe('the files the import control can be handed on an iPhone', () => {
  // What iOS knows without being told (asked of the iOS 27 simulator, 2026-11-11).
  const SYSTEM = ['md', 'markdown', 'txt', 'html', 'htm', 'json', 'zip', 'tgz', 'docx']
  const declared = [...plist.matchAll(/<key>public\.filename-extension<\/key>\s*<array>([\s\S]*?)<\/array>/g)].flatMap((found) => [...found[1].matchAll(/<string>([^<]+)<\/string>/g)].map((one) => one[1]))

  it('are each of a kind the system knows, or one Nib says it reads', () => {
    const listed = /export const IMPORT_ACCEPT = \[([\s\S]*?)\]\.join/.exec(read('src/lib/importApps.ts'))![1]
    const endings = [...listed.matchAll(/'\.([a-z0-9]+)'/g)].map((one) => one[1])
    expect(endings.length).toBeGreaterThan(10)
    expect(endings.filter((ending) => !SYSTEM.includes(ending)).sort()).toEqual([...declared].sort())
    expect(declared.sort()).toEqual(['backup', 'bear2bk', 'enex', 'jex', 'textpack'])
  })

  it('are said to be read, not owned: each a kind of Nib’s own naming that is data, under the imported kinds', () => {
    const imported = /<key>UTImportedTypeDeclarations<\/key>\s*<array>([\s\S]*?)\n\t<\/array>/.exec(plist)?.[1] ?? ''
    expect((imported.match(/<key>UTTypeIdentifier<\/key>\s*<string>app\.nib\.import\.[a-z-]+<\/string>/g) ?? []).length).toBe(5)
    expect((imported.match(/<string>public\.data<\/string>/g) ?? []).length).toBe(5)
    expect(plist).not.toContain('UTExportedTypeDeclarations')
    expect(plist).not.toContain('CFBundleDocumentTypes')
  })

  // Seen with real taps on the iOS 27 simulator, 2026-11-11: a kind declared by its ending alone stays greyed out in the picker. With a MIME type it can be picked.
  it('each have a MIME type of their own, without which the picker leaves them greyed out', () => {
    const types = [...plist.matchAll(/<key>public\.mime-type<\/key>\s*<array>\s*<string>([^<]+)<\/string>\s*<\/array>/g)].map((found) => found[1])
    expect(types.length).toBe(declared.length)
    expect(new Set(types).size).toBe(types.length)
    for (const type of types) expect(type).toMatch(/^application\/x-[a-z-]+$/)
  })
})

/** What site/privacy.html promises: a constant changed here makes a published promise false until the page says so too. */
describe('what the privacy policy promises', () => {
  const policy = read('site/privacy.html')
  const days = (ms: number) => ms / 86_400_000
  const word = (n: number) => ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][n - 1]

  it('keeps the history it says', () => {
    expect(policy).toContain(`kept on the server for ${days(SERVER_HISTORY_MS)} days`)
    expect(policy).toContain(`at most ${days(SERVER_HISTORY_MS)} days of history`)
  })

  it('deletes a lapsed library when it says', () => {
    expect(policy).toContain(`your library is deleted from the server ${KEPT_MONTHS} months after that`)
  })

  it('offers links as long as it says', () => {
    expect(policy).toContain(`for ${FREE_DAYS} days, and readers can only read it`)
    expect(policy).toContain(`a link can last ${SHARE_DAYS.slice(0, -1).join(', ')} or ${SHARE_DAYS.at(-1)} days`)
  })

  it('gives full-quality pictures and attached files the room it says, together', () => {
    expect(policy).toContain(`a library’s originals and attached files can take up to ${FILES_LIMIT / 1_000_000_000} GB on the server, and each can be up to ${MAX_FILE / 1024 / 1024} MB`)
  })

  it('keeps a note sent to the inbox as long, and takes as many, as it says; and so does the page on how to send one', () => {
    expect(policy).toContain(`A note that no device takes in is deleted after ${INBOX_DAYS} days.`)
    expect(policy).toContain(`An inbox holds at most ${INBOX_WAITING} notes waiting, and takes at most ${INBOX_DAILY} in a day.`)
    // By its whole address: the policy is published on nibprivacy.com too, where the page isn't.
    expect(policy).toContain(`<a href="${SYNC_ORIGIN}/inbox">how to send to it</a>`)
    const howTo = read('site/inbox.html')
    expect(read('src/lib/plus.ts')).toContain('export const INBOX_HELP_URL = `${SYNC_ORIGIN}/inbox`')
    expect(howTo).toContain(`A post can be up to ${MAX_POST / 1000} KB.`)
    expect(howTo).toContain(`<code>413</code>: the post was over ${MAX_POST / 1000} KB;`)
    expect(howTo).toContain(`<code>429</code>: the inbox has taken ${INBOX_DAILY} notes today`)
    expect(howTo).toContain(`<code>507</code>: ${INBOX_WAITING} notes are waiting, or ${INBOX_BYTES / 1_000_000} MB of them, which is the most it holds.`)
    expect(howTo).toContain(`A note waits on the server for up to ${INBOX_DAYS} days.`)
    // Its examples are sent to where the app's own address begins (sync/inbox), and name the fields the server reads (worker/inbox).
    expect(howTo).toContain(`curl ${SYNC_ORIGIN}/v1/in/YOUR-ADDRESS`)
    for (const field of ['title', 'text', 'url']) {
      expect(howTo).toContain(`<li><code>${field}</code>:`)
      expect(read('worker/inbox.ts')).toMatch(new RegExp(`const FIELDS = \\[.*'${field}'.*\\] as const`))
    }
    expect(read('src/sync/inbox.ts')).toContain('`${SERVER || location.origin}/v1/in/${keys.libraryId}.${secret}`')
  })

  it('says of Nib Web Clipper what the extension does: what it keeps, what it reads, where it sends, and how much', () => {
    expect(policy).toContain(`A clip can be up to ${MAX_SEALED_POST / 1_000_000} MB once encrypted, and an inbox holds at most ${INBOX_BYTES / 1_000_000} MB waiting.`)
    // It keeps the code, and nothing else, in the browser's own storage for the extension: not the kind a browser syncs to an account.
    expect(policy).toContain('The extension keeps one thing, in your browser on that computer: the clipper code')
    const code = ['popup', 'background', 'picker', 'clip'].map((file) => read(`src/clipper/${file}.ts`)).join('\n')
    expect(new Set(code.match(/chrome\.storage\.\w+/g))).toEqual(new Set(['chrome.storage.local']))
    expect(new Set(code.match(/chrome\.storage\.local\s*\.\w+\([^)]*\)/g)?.map((call) => call.replace(/^chrome\.storage\.local\s*/, '')))).toEqual(new Set(['.set({ code })', ".get('code')", ".remove('code')"]))
    // It reads a page when its button is pressed, and at no other time: no script of its own in any page, and leave for the tab in front alone.
    expect(policy).toContain('It reads a page only when you click its button on that page')
    const manifest = JSON.parse(read('extension/manifest.json')) as { permissions: string[]; host_permissions: string[]; content_scripts?: unknown }
    expect(manifest.permissions).toEqual(['activeTab', 'scripting', 'storage'])
    expect(manifest.content_scripts).toBeUndefined()
    // It sends to Nib's server and nowhere else.
    expect(policy).toContain('sent to our server and nowhere else')
    expect(manifest.host_permissions).toEqual([`${SYNC_ORIGIN}/*`])
    expect(code.match(/\bfetch(?:ing)?\(/g)).toEqual(['fetching('])
    expect(code).not.toMatch(/XMLHttpRequest|sendBeacon|WebSocket|EventSource/)

    // The page on how to use it names the buttons as they're written.
    const howTo = read('site/inbox.html')
    const popup = read('extension/popup.html')
    for (const label of ['Use this code', 'Pick parts of the page', 'Save to Nib', 'Use another clipper code']) {
      expect(popup).toContain(`>${label}</button>`)
      expect(howTo).toContain(`“${label}”`)
    }
    expect(read('src/components/SyncPanel.tsx')).toContain("'Copy the code for Nib’s browser extension'")
    expect(howTo).toContain('“Copy the code for Nib’s browser extension”')
    expect(read('src/clipper/clip.ts')).toMatch(/\['link', 'Link only'\],\s*\['selection', 'Selection'\],\s*\['article', 'Article'\],\s*\['visible', 'Part on screen'\],\s*\['whole', 'Whole page'\]/)
    expect(howTo).toContain('the link only, what you’ve selected, the article, the part on screen or the whole page')
    // A link or a selection is a note, anything more a page (sync/inbox `postKind`).
    expect(howTo).toContain('A link or a selection becomes a note, and anything more becomes a page.')
    expect(read('src/sync/inbox.ts')).toContain("(said(post.page) && post.part !== 'selection' ? 'page' : 'note')")
  })

  it('says an import stays on the device, and a backup’s password with it; and Settings names every app Nib imports from', () => {
    expect(policy).toContain('Importing reads the files you choose on your device, and sends nothing of them anywhere.')
    expect(policy).toContain('If a backup you import needs a password, as ColorNote’s can, Nib uses it on your device to open the file, and doesn’t keep it.')
    // What reads an import, and what opens a backup with its password, sends and stores nothing.
    for (const file of ['src/lib/importApps.ts', 'src/lib/colornote.ts', 'src/lib/tar.ts', 'src/components/PasswordDialog.tsx']) {
      expect(read(file)).not.toMatch(/\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|localStorage|sessionStorage|indexedDB|Preferences\b/)
    }
    expect(read('src/components/PasswordDialog.tsx')).toContain('on this device, and doesn’t keep it.')
    const settings = read('src/components/Settings.tsx')
    const line = /Markdown, a Word document, or an export from ([^<]+)</.exec(settings)?.[1] ?? ''
    expect(line.split(/, | or /)).toEqual(['Simplenote', 'Bear', 'Evernote', 'Notesnook', 'Obsidian', 'Apple Notes', 'Google Keep', 'Joplin', 'UpNote', 'Zoho Notebook', 'FuseBase', 'ColorNote'])
    // Each is one the importer has words for.
    const importer = read('src/lib/importApps.ts')
    for (const app of ['Keep', 'Joplin', 'UpNote', 'Zoho Notebook', 'FuseBase', 'ColorNote']) expect(importer).toContain(app)
  })

  it('counts the libraries it says', () => {
    expect(policy).toContain(`sync up to ${word(MAX_LIBRARIES)} libraries`)
    expect(policy).toContain(`renewed for ${days(LIBRARY_IDLE_MS)} days stops counting toward the ${word(MAX_LIBRARIES)}.`)
  })
})

describe('the version', () => {
  it('is the same in package.json and all six Xcode configurations', () => {
    const { version } = JSON.parse(read('package.json')) as { version: string }
    expect(firsts(pbxproj, /\bMARKETING_VERSION = ([^;]+);/g)).toEqual(Array(6).fill(version))
  })

  it('has the one build number in all six', () => {
    const builds = firsts(pbxproj, /\bCURRENT_PROJECT_VERSION = ([^;]+);/g)
    expect(builds).toHaveLength(6)
    expect(new Set(builds).size).toBe(1)
  })
})

describe('what the app tells the page', () => {
  it('sends the window events the page listens for', () => {
    const sent = pluginFiles.concat('MainViewController.swift').flatMap((file) => [...app(file).matchAll(/triggerWindowJSEvent\(eventName: "(\w+)"/g)].map((match) => match[1]))
    expect([...new Set(sent)].sort()).toEqual([...new Set(firsts(page, /window\.addEventListener\('(nib\w+)'/g))].sort())
  })

  it.each([
    ['nibkeyboard', 'lib/keyboard.ts'],
    ['nibmenu', 'App.tsx'],
  ])('sends %s with the fields the page reads', (event, file) => {
    const keys = found(main, new RegExp(`eventName: "${event}", data: "(.*)"\\)`, 'g'))[0][1]
    const [, read_] = found(read(`src/${file}`), /event as Event & \{ ([^}]*) \}/g)[0]
    expect(firsts(keys, /\\"(\w+)\\":/g).sort()).toEqual(firsts(read_, /(\w+)\?:/g).sort())
  })

  it('sets the globals the page reads before it runs', () => {
    expect(main).toContain(`"window.nibPlatform = 'mac'"`)
    expect(page).toContain(`(window as { nibPlatform?: string }).nibPlatform === 'mac'`)
    expect(main).toContain('"window.nibLaunchedLocked = true"')
    expect(html).toContain('window.nibLaunchedLocked === true')
  })

  it('offers the delays Settings offers', () => {
    expect(firsts(lockPlugin, /static let delays = \[([^\]]+)\]/g)[0].split(', ').map(Number)).toEqual(LOCK_AFTER.map(([seconds]) => seconds))
  })

  // Privacy mode (src/lib/lock `privacy`): the page's switch is only as good as these.
  it('covers Nib on both steps of leaving in privacy mode, off the Mac, and tells the page the setting under the name it reads', () => {
    const leaving = found(lockPlugin, /#if !targetEnvironment\(macCatalyst\)\n\s+if !enabled, vaultOpen \|\| privacy \{ return show\((keepingKeyboard: true)?\) \}\n\s+#endif/g)
    expect(leaving).toHaveLength(2)
    expect(lockPlugin).toContain('CAPPluginMethod(name: "privacy", returnType: CAPPluginReturnPromise)')
    expect(lockPlugin).toContain('"privacy": NibLock.shared.privacy')
    expect(lockPlugin).toContain('call.getBool("on")')
  })

  it('covers Nib while the screen is recorded or shared in privacy mode: watched for, kept up through what would take the cover down, and never on the Mac', () => {
    // Only with privacy mode on, and only off the Mac.
    expect(lockPlugin).toMatch(/private var watched: Bool \{\n\s+#if targetEnvironment\(macCatalyst\)\n\s+return false\n\s+#else\n\s+return privacy && scene\?\.screen\.isCaptured == true\n\s+#endif/)
    // Told when a recording starts or stops, at a launch into one, and when the switch changes during one.
    expect(lockPlugin).toMatch(/addObserver\(forName: UIScreen\.capturedDidChangeNotification[^\n]+\n\s+self\?\.captureChanged\(\)/)
    expect(lockPlugin).toMatch(/if enabled \{ lock\(\) \}\n\s+\/\/[^\n]+\n\s+else if watched \{ show\(\) \}/)
    expect(lockPlugin).toMatch(/UserDefaults\.standard\.set\(newValue, forKey: Self\.privacyKey\)\n\s+\/\/[^\n]+\n\s+captureChanged\(\)/)
    // Up when it starts; down when it stops only with Nib in front and nothing to unlock.
    expect(lockPlugin).toMatch(/private func captureChanged\(\) \{\n\s+if watched \{ show\(\) \}\n\s+\/\/[^\n]+\n\s+else if !locked, scene\?\.activationState == \.foregroundActive \{ hide\(\) \}/)
    // And nothing else takes it down meanwhile: unlocking, or coming back to the front.
    expect(lockPlugin).toMatch(/private func hide\(\) \{\n\s+guard let cover, !cover\.isHidden else \{ return \}\n\s+\/\/[^\n]+\n\s+if watched \{[^}]+return\n\s+\}\n\s+cover\.isHidden = true/)
    // The cover says why, in words that say where to turn it off.
    expect(firsts(lockPlugin, /static let watchedReason = "([^"]+)"/g)).toEqual(['Covered while the screen is being recorded or shared. Privacy mode is on in Nib’s Settings.'])
  })

  // The Mac's Dock menu (desktop extras): New Note and New Page, each the link a widget would open.
  describe('the Dock icon’s menu', () => {
    const scene = app('SceneDelegate.swift')

    it('offers New Note and New Page, as links the page knows, and only on the Mac', () => {
      const items = found(menu, /UIApplicationShortcutItem\(type: "(nib:\/\/[a-z-]+)", localizedTitle: "([^"]+)"\)/g).map((match) => [match[1], match[2]])
      expect(items).toEqual([
        ['nib://new-note', 'New Note'],
        ['nib://new-page', 'New Page'],
      ])
      for (const [link] of items) expect(linkAction(link)).not.toBeNull()
      // An iPhone or iPad would show them on a long press of the icon: set only in the Mac's build, and nowhere in Info.plist.
      expect(menu).toMatch(/#if targetEnvironment\(macCatalyst\)\n(?:\s+\/\/[^\n]+\n)+\s+application\.shortcutItems = \[[^\]]+\]\n\s+#endif/)
      expect(found(menu, /shortcutItems/g)).toHaveLength(1)
      expect(app('Info.plist')).not.toContain('UIApplicationShortcutItems')
    })

    it('passes a choice on as its link, with Nib running or launched by it, and nothing that isn’t a nib:// link', () => {
      expect(scene).toMatch(/performActionFor shortcutItem: UIApplicationShortcutItem, completionHandler: @escaping \(Bool\) -> Void\) \{\n\s+completionHandler\(follow\(shortcutItem\)\)/)
      // At a launch: after Capacitor's own proxy, by when the plugin that passes links on is listening.
      expect(scene).toMatch(/SceneDelegateProxy\.shared\.scene\(scene, willConnectTo: session, options: connectionOptions\)\n\s+\/\/[^\n]+\n\s+if let chosen = connectionOptions\.shortcutItem \{ follow\(chosen\) \}/)
      expect(scene).toMatch(/guard let url = URL\(string: item\.type\), url\.scheme == "nib" else \{ return false \}\n\s+NotificationCenter\.default\.post\(name: \.capacitorOpenURL, object: \["url": url,/)
      // Heard where a widget's link is (NibInboxPlugin), and held there till the page is listening.
      expect(app('NibInboxPlugin.swift')).toMatch(/forName: \.capacitorOpenURL[\s\S]+?url\.scheme == "nib"[\s\S]+?notifyListeners\("openUrl", data: \["url": url\.absoluteString\], retainUntilConsumed: true\)/)
    })
  })

  // "Open Nib at login" (Settings, on the Mac): macOS's own list of login items, asked and changed through the app.
  it('asks macOS itself whether Nib opens at login, only on a Mac that can be asked, and tells the page in the words it reads', () => {
    const login = app('NibWindowPlugin.swift')
    expect(login).toMatch(/#if targetEnvironment\(macCatalyst\)\nimport ServiceManagement\n#endif/)
    // What the page reads (src/lib/keyboard `LoginItem`): on only when macOS says enabled; turned off in System Settings is its own answer.
    expect(login).toContain('return ["available": true, "on": status == .enabled, "approval": status == .requiresApproval]')
    expect(login).toContain('return ["available": false, "on": false, "approval": false]')
    expect(read('src/lib/keyboard.ts')).toContain('export type LoginItem = { available: boolean; on: boolean; approval: boolean }')
    // Added and taken off through macOS, and nowhere else kept.
    expect(login).toContain('if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }')
    expect(login).not.toMatch(/UserDefaults[^\n]*login/i)
    // A refusal because it's turned off in System Settings is answered with the state, not as a failure; any other is a failure.
    expect(login).toMatch(/\} catch \{\n\s+\/\/[^\n]+\n\s+if SMAppService\.mainApp\.status != \.requiresApproval \{ return call\.reject\(error\.localizedDescription\) \}\n\s+\}\n\s+return call\.resolve\(loginState\)/)
    // Both behind the Mac's build and macOS 13: elsewhere there's nothing to ask.
    expect(found(login, /#if targetEnvironment\(macCatalyst\)\n\s+if #available\(macCatalyst 16\.0, \*\) \{/g)).toHaveLength(2)
    expect(login).toMatch(/#endif\n\s+call\.reject\("Not on this device\."\)/)
  })

  // As a window on an iPad, the system's controls lie in Nib's top-left corner.
  it('asks for the window controls the top safe area counts, on an iPad only, where the page keeps clear of that area', () => {
    expect(app('SceneDelegate.swift')).toMatch(
      /#if !targetEnvironment\(macCatalyst\)\n\s+@available\(iOS 26\.0, \*\)\n\s+func preferredWindowingControlStyle\(for windowScene: UIWindowScene\) -> UIWindowScene\.WindowingControlStyle \{\n\s+windowScene\.traitCollection\.userInterfaceIdiom == \.pad \? \.minimal : \.automatic\n\s+\}\n\s+#endif/,
    )
    for (const file of ['App.tsx', 'components/Library.tsx', 'components/Settings.tsx']) expect(read(`src/${file}`), file).toContain('pt-[env(safe-area-inset-top)]')
  })

  it('opens only the nib:// links the page knows', () => {
    const links = ['NibIntents.swift', '../NibWidgets/NibWidgets.swift'].flatMap((file) => firsts(app(file), /"(nib:\/\/[a-z-]+)"/g))
    for (const link of links) expect(linkAction(link)).not.toBeNull()
    expect(firsts(app('NibInboxPlugin.swift'), /url\.scheme == "(\w+)"/g)).toEqual(['nib'])
    expect(firsts(plist, /CFBundleURLSchemes<\/key>\s*<array>\s*<string>(\w+)</g)).toEqual(['nib'])
  })

  it('gives each thing in the Xcode project an id of its own: two files under one id, and only one of them is built', () => {
    const ids = firsts(pbxproj, /^\t\t([0-9A-F]{24}) (?:\/\* .*? \*\/ )?= \{/gm)
    expect(ids.length).toBeGreaterThan(100)
    expect(ids.filter((id, at) => ids.indexOf(id) !== at)).toEqual([])
  })

  it('offers the share sheet no note to add to while Lock Nib is on, and never more than the app means to', () => {
    // Whatever the page sends, none is kept while the lock is on; and those kept go as it's turned on.
    expect(app('NibInboxPlugin.swift')).toContain('NibInbox.setTargets(NibLock.shared.enabled ? [] : asked)')
    expect(app('NibLockPlugin.swift')).toContain('if turningOn { NibInbox.setTargets([]) }')
    expect(firsts(app('NibInbox.swift'), /static let maxTargets = (\d+)/g)).toEqual(firsts(read('src/lib/inbox.ts'), /const TARGETS = (\d+)/g))
    // The sheet reads that list and nothing of the library, and a capture says which of them it's for.
    const sheet = read('ios/App/NibShare/ShareViewController.swift')
    expect(sheet).toContain('private let targets = NibInbox.targets()')
    expect(sheet).toContain('try NibInbox.add(text: text.text ?? "", url: sharedURL, into: into?.id, files:')
    // Its own sheet: the system's compose sheet was handed the Save to row on iOS 27 and didn't draw it.
    expect(sheet).not.toContain('SLComposeServiceViewController {')
    expect(app('NibInbox.swift')).toContain('into: into.flatMap { validId($0) ? $0 : nil }')
    expect(app('NibInboxPlugin.swift')).toContain('if let into = capture.into { described["into"] = into }')
  })

  it('takes into the share sheet what the app can keep: as many, as big, and pictures of the kinds a note holds', () => {
    const inbox = app('NibInbox.swift')
    const sheet = read('ios/App/NibShare/ShareViewController.swift')
    const plist = read('ios/App/NibShare/Info.plist')
    const most = firsts(inbox, /static let maxFiles = (\d+)/g)[0]
    expect(firsts(plist, /SupportsImageWithMaxCount<\/key>\s*<integer>(\d+)</g)).toEqual([most])
    expect(firsts(plist, /SupportsFileWithMaxCount<\/key>\s*<integer>(\d+)</g)).toEqual([most])
    // One file as big as the file store keeps, and no bigger.
    expect(firsts(inbox, /static let maxFile = (\d+) \* 1024 \* 1024/g).map(Number)).toEqual([MAX_FILE / 1024 / 1024])
    expect(sheet).toContain('size > NibInbox.maxFile ? "over 25 MB, the most Nib keeps of one file"')
    // A file that isn't a picture is an attachment, which is Plus: refused in the sheet without it.
    expect(sheet).toContain('!picture && !NibInbox.plus ? "attaching files is part of Nib Plus"')
    expect(sheet).toContain('files.filter { $0.refused == nil }')
    // Pictures as they come where a note holds that kind (lib/image), a JPEG made of any other.
    expect(firsts(sheet, /private static let kept: \[UTType\] = \[([^\]]+)\]/g)[0].toLowerCase().replace(/[. ]/g, '').split(',').sort()).toEqual(firsts(read('src/lib/image.ts'), /const IMAGE_TYPES = '([^']+)'/g)[0].split('|').sort())
    // The files go with their capture, and are the last thing written of it.
    expect(inbox).toMatch(/copyItem[\s\S]+JSONEncoder\(\)\.encode\(capture\)/)
    expect(inbox).toContain('if let files = filesFolder(id) { try? FileManager.default.removeItem(at: files) }')
  })

  it('has Safari hand the share sheet the page, a part of it kept only when asked for, more than a selection only with Plus, and none longer than Nib keeps', () => {
    const inbox = app('NibInbox.swift')
    const sheet = read('ios/App/NibShare/ShareViewController.swift')
    const plist = read('ios/App/NibShare/Info.plist')
    const script = read('ios/App/NibShare/Page.js')
    // Safari runs the script by its name, which has to be in the extension to be run.
    expect(firsts(plist, /NSExtensionJavaScriptPreprocessingFile<\/key>\s*<string>(\w+)</g)).toEqual(['Page'])
    expect(firsts(plist, /SupportsWebPageWithMaxCount<\/key>\s*<integer>(\d+)</g)).toEqual(['1'])
    expect(pbxproj).toMatch(/files = \(\s*\w+ \/\* Page\.js in Resources \*\/,/)
    expect(script).toContain('var ExtensionPreprocessingJS = new NibPage()')
    // As long a page as the script hands over, the inbox keeps; and only with the address it's the page of.
    expect(firsts(inbox, /static let maxPage = ([\d_]+)/g).map((n) => Number(n.replace(/_/g, '')))).toEqual(firsts(script, /NibPage\.LIMIT = (\d+)/g).map(Number))
    expect(inbox).toContain('page.flatMap { url != nil && part != nil && !$0.isEmpty && $0.utf16.count <= maxPage ? $0 : nil }')
    // The parts are the same four to the script, the sheet, the inbox and the app, the whole body being the script's `html`.
    const parts = firsts(inbox, /static let parts = \[([^\]]+)\]/g)[0].split(', ').map((part) => part.replace(/"/g, ''))
    expect(parts).toEqual(['selection', 'article', 'visible', 'whole'])
    expect(firsts(read('src/lib/inbox.ts'), /const PARTS = \[([^\]]+)\]/g)[0].replace(/'/g, '').split(', ')).toEqual(parts)
    expect(firsts(sheet, /private static let named = \[(.+)\]\n/g)[0].match(/\("(\w+)", /g)!.map((pair) => pair.slice(2, -3))).toEqual(parts)
    expect(sheet).toContain('for (part, key) in [("selection", "selection"), ("article", "article"), ("visible", "visible"), ("whole", "html")] {')
    for (const key of ['html', 'selection', 'article', 'visible']) expect(script).toMatch(new RegExp(`\\n    ${key}: NibPage\\.part\\(`))
    expect(inbox).toContain('let part = part.flatMap { parts.contains($0) ? $0 : nil }')
    // Saved only as the part chosen: the link alone unless something was selected, and nothing but a selection without Plus.
    expect(sheet).toContain('page: keep.flatMap { parts[$0] }, part: keep)')
    expect(sheet).toContain('keep = parts[Self.free] == nil ? nil : Self.free')
    expect(sheet).toContain('private static let free = "selection"')
    expect(sheet).toContain('let locked = part != nil && part != Self.free && !NibInbox.plus')
    expect(sheet).toContain('attributes: locked ? [.disabled] : []')
    expect(sheet.match(/\bkeep = /g)).toHaveLength(2)
    // What the script hands over is the page, not a file to attach.
    expect(sheet).toContain('if types.contains(where: { $0.conforms(to: .propertyList) }) { return nil }')
    expect(app('NibInboxPlugin.swift')).toContain('if let page = capture.page { described["page"] = page }')
    expect(app('NibInboxPlugin.swift')).toContain('if let part = capture.part { described["part"] = part }')
  })

  it('shows only what Nib made a copy of to open, in the one folder', () => {
    const folder = firsts(read('src/lib/files.ts'), /const OPENED = '(\w+)'/g)[0]
    expect(folder).toBe('opened')
    expect(app('NibPreviewPlugin.swift')).toContain(`appendingPathComponent("${folder}", isDirectory: true)`)
    // Both of its methods take a file by that check, and nothing by any other.
    expect(found(app('NibPreviewPlugin.swift'), /Self\.opened\(call\.getString\("uri"\)\)/g)).toHaveLength(2)
    expect(app('NibPreviewPlugin.swift')).not.toMatch(/getString\("path"\)|URL\(fileURLWithPath: (?!"\/dev\/null")/)
  })

  it('keeps exports in the one folder', () => {
    const folder = firsts(read('src/lib/exportFile.ts'), /const FOLDER = '(\w+)'/g)[0]
    for (const file of ['NibSavePlugin.swift', 'NibPdfPlugin.swift']) expect(app(file)).toContain(`appendingPathComponent("${folder}", isDirectory: true)`)
  })

  // The daily reminder has no snooze buttons: the device knows it by the start of its id, which is the page's to choose.
  it('knows the daily reminder by the page’s own prefix', () => {
    const daily = read('src/lib/reminders.ts').match(/export const DAILY = '([^']+)'/)![1]
    expect(app('NibRemindersPlugin.swift')).toContain(`itemId.hasPrefix("${daily}")`)
  })

  // Said by name from the page, and back to it by `list`: one the device doesn't know is a reminder that rings once and is set again at every look.
  it('repeats a reminder in the four ways the page has', () => {
    const page = read('src/lib/reminders.ts').match(/REPEATS = \[([^\]]+)\]/)![1].split(',').map((word) => word.trim().replace(/'/g, ''))
    const device = app('NibRemindersPlugin.swift').match(/static let parts: \[String: Set<Calendar\.Component>\] = \[([\s\S]*?)\n    \]/)![1]
    expect(firsts(device, /"(\w+)": \[/g).sort()).toEqual([...page].sort())
    expect(page).toHaveLength(4)
  })

  // Matched by name on the page: one renamed turns a cancelled purchase into an error message, and a time that has passed into "Couldn't set the reminder."
  it.each([
    ['NibRemindersPlugin.swift', 'src/lib/reminders.ts'],
    ['NibStorePlugin.swift', 'src/lib/usePurchase.ts'],
    ['NibSavePlugin.swift', 'src/lib/download.ts'],
  ])('rejects from %s with the codes %s tells apart', (swift, file) => {
    expect(firsts(app(swift), /call\.reject\("[^"]*", "(\w+)"/g).sort()).toEqual(firsts(read(file), /\bcode === '(\w+)'/g).sort())
  })

  // A fresh install is told from an update by the library's mirror being there.
  it('looks for the mirror by the names it is written under', () => {
    const keychain = app('NibKeychainPlugin.swift')
    for (const file of [MIRROR_FILE, MIRROR_TEMP, MIRROR_DIR]) expect(keychain).toContain(`documents.appendingPathComponent("${file}")`)
  })
})

describe('the Mac menu', () => {
  const ids = firsts(menu, /\b(?:item|key)\("[^"]+", "([a-z-]+)"/g)

  // Each sends the id of a palette command or a format, or one App's `menu` handles itself; one that resolves to nothing does nothing, without a word.
  it('names only commands the page has', () => {
    const app_ = read('src/App.tsx')
    const own = app_.slice(app_.indexOf('menu.current = (id) =>'), app_.indexOf('const command = buildCommands()'))
    // The palette's rows: App's, and those each feature adds to them.
    const rows = ['src/App.tsx', 'src/components/useDocumentReminder.tsx', 'src/components/useRewardSheets.tsx', 'src/components/useTabs.tsx', 'src/lib/useTheme.ts', 'src/share/useSharing.tsx'].map(read).join('\n')
    const known = new Set([
      ...firsts(rows, /\bid: '([a-z-]+)'/g),
      ...firsts(own, /\bid === '([a-z-]+)'/g),
      ...RICH_FORMATS.map((format) => `export-${format}`),
      ...NAMED.map((one) => `theme-${one.id}`),
      ...FORMATS.map((format) => format.id),
    ])
    expect(ids.filter((id) => !known.has(id))).toEqual([])
    expect(app_).toContain('id: `export-${format}`')
    expect(rows).toContain('id: `theme-${one.id}`')
  })

  // ⌘T is the system's Show Fonts until the Format menu's own items are replaced. A group holding a shortcut that's taken
  // isn't put in at all: in a Mac build, New Tab beside New Note took New Note and New Page out of the File menu with it.
  it('puts New Tab in only after the Format menu is replaced', () => {
    const replaced = menu.indexOf('builder.replaceChildren(ofMenu: .format)')
    expect(replaced).toBeGreaterThan(-1)
    expect(menu.indexOf('"tab-new"')).toBeGreaterThan(replaced)
    expect(menu.indexOf('"new-note"')).toBeLessThan(replaced)
  })

  // Winter is earned on Christmas Day (lib/rewards), and has never been in the menu.
  it('lists every named theme but Winter, by the name the page gives it', () => {
    const listed = found(menu, /item\("([^"]+)", "theme-([a-z-]+)"\)/g)
      .map((match) => [match[1], match[2]])
      .filter(([, id]) => !['light', 'dark', 'system'].includes(id))
    expect(listed).toEqual(NAMED.filter((one) => one.id !== WINTER).map((one) => [one.label, one.id]))
  })
})

describe('the themes before the first paint', () => {
  const pattern = (name: string) => found(html, new RegExp(`var ${name} = /\\^\\(([^)]+)\\)\\$/`, 'g'))[0][1].split('|').sort()

  it('knows every named theme, and which are dark', () => {
    expect(pattern('named')).toEqual(NAMED.map((one) => one.id).sort())
    expect(pattern('darkNamed')).toEqual(NAMED.filter((one) => one.dark).map((one) => one.id).sort())
  })
})

describe('the launch frame', () => {
  const css = read('src/index.css')
  const inside = (block: string, name: string) => found(css, new RegExp(`${block} \\{[^}]*--color-${name}: (#[0-9a-f]{6})`, 'g'))[0][1]
  const light = { shell: inside('@theme', 'shell'), ink: inside('@theme', 'ink') }
  const dark = { shell: inside('\\.dark', 'shell'), ink: inside('\\.dark', 'ink') }

  it('has the shell lib/theme has', () => {
    expect(light.shell).toBe(SHELL.light)
    expect(dark.shell).toBe(SHELL.dark)
  })

  it('has the same colours over the web view, as fractions of 255', () => {
    const colors = found(main, /UIColor\(red: (\d+) \/ 255, green: (\d+) \/ 255, blue: (\d+) \/ 255, alpha: 1\)/g).map((match) => `#${match.slice(1, 4).map((part) => Number(part).toString(16).padStart(2, '0')).join('')}`)
    expect(colors).toEqual([dark.shell, light.shell])
  })

  it('has the same colours on the lock cover', () => {
    const pairs = found(lockPlugin, /userInterfaceStyle == \.dark \? Self\.color\("(#\w+)"\)! : Self\.color\("(#\w+)"\)!/g).map((match) => [match[1], match[2]])
    expect(pairs).toEqual([
      [dark.shell, light.shell],
      [dark.ink, light.ink],
    ])
  })

  it('has the same colours on the loading screen and in the manifest', () => {
    for (const said of [`content="${light.shell}"`, `themeColor.content = '${dark.shell}'`, `background: ${light.shell};`, `fill: ${light.ink};`, `background: ${dark.shell};`, `fill: ${dark.ink};`, `var(--color-shell, ${light.shell})`, `var(--color-ink, ${light.ink})`]) {
      expect(html).toContain(said)
    }
    const vite = read('vite.config.ts')
    expect(vite).toContain(`background_color: '${light.shell}'`)
    expect(vite).toContain(`theme_color: '${light.shell}'`)
  })

  it('has the nib the same size wherever it lies over another', () => {
    const [, width, height] = found(read('ios/App/App/Base.lproj/LaunchScreen.storyboard'), /image="LaunchMark"[^>]*>\s*<rect key="frame" x="\d+" y="\d+" width="(\d+)" height="(\d+)"/g)[0]
    for (const swift of [main, lockPlugin]) {
      expect(swift).toContain(`nib.widthAnchor.constraint(equalToConstant: ${width})`)
      expect(swift).toContain(`nib.heightAnchor.constraint(equalToConstant: ${height})`)
    }
    expect(html).toMatch(new RegExp(`\\.nib-mark \\{\\s*width: ${width}px;\\s*height: ${height}px;`))
  })
})
