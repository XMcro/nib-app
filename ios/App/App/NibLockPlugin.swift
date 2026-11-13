import Foundation
import Capacitor
import LocalAuthentication
import UIKit

/// "Lock Nib": Face ID, Touch ID or the device passcode before anything is
/// shown. Enforced here rather than in the page: the cover has to be up before
/// the web view has drawn anything on a cold launch, and before iOS takes the
/// app-switcher snapshot on the way out, and JavaScript runs too late for both.
/// The page only shows and changes the setting (src/lib/lock.ts).
///
/// The cover is its own window above Nib's, not a view inside it, so it also
/// covers whatever Nib has presented on top: a share sheet, the Save dialog.
final class NibLock {
    static let shared = NibLock()

    private static let enabledKey = "nib.lock.enabled"
    private static let afterKey = "nib.lock.after"
    /// The delays Settings offers (src/lib/lock.ts `LOCK_AFTER`). Anything else
    /// is taken down to the nearest of them, never up.
    private static let delays = [0, 60, 300, 900, 3600]
    private static func clamped(_ after: Int) -> Int { delays.last { $0 <= after } ?? 0 }

    /// Stored natively, so it is known before the page loads.
    var enabled: Bool { UserDefaults.standard.bool(forKey: Self.enabledKey) }
    /// Seconds away before it locks again; 0 is immediately.
    var after: Int { Self.clamped(UserDefaults.standard.integer(forKey: Self.afterKey)) }

    private var cover: UIWindow?
    private weak var scene: UIWindowScene?
    /// Nib's own window, to take the keyboard from and to hand focus back to.
    private weak var window: UIWindow?
    /// Authentication is needed before the cover comes down. Read by the Mac
    /// menu bar (AppDelegate), whose commands would otherwise run behind it.
    private(set) var locked = false
    /// The Face ID or passcode sheet makes the app resign and become active
    /// again. Without this, coming back from the sheet would ask again, forever.
    private var authenticating = false
    /// The sheet being shown, so that leaving can call it off.
    private var context: LAContext?
    /// When Nib went away, in nanoseconds of a clock that keeps counting while
    /// the device sleeps and that setting the date and time can't move. With
    /// `Date()`, setting the clock back opened Nib without asking.
    private var awayAt: UInt64?
    /// Nib has stopped being the app in use, on an iPad, but hasn't left:
    /// back within `moment`, in nanoseconds, it wasn't away (`sceneDidBecomeActive`).
    private var onlyResigned = false
    /// Ten seconds, so Control Center or a glance at another app doesn't ask
    /// for Face ID again, and a real stay beside another app still does (the
    /// user's choice, 2026-11-13; it was two).
    private static let moment: Int64 = 10_000_000_000
    private static func now() -> UInt64 { clock_gettime_nsec_np(CLOCK_MONOTONIC) }
    #if targetEnvironment(macCatalyst)
    /// Covers a window left showing behind another app's once the delay is up.
    private var relock: Timer?
    #endif
    /// The page's vault is open (NibLockPlugin `vault`), so a locked note's
    /// text or title may be on screen: covered on the way out, for the
    /// app-switcher snapshot, even with Lock Nib off.
    var vaultOpen = false

    private static let privacyKey = "nib.lock.privacy"
    /// Privacy mode (Settings, on an iPhone or iPad): covered on the way out
    /// whatever is on screen, as with the vault open, and with nothing asked
    /// on the way back; and covered for as long as the screen is being
    /// recorded, mirrored or shared (`watched`). Stored natively, so it holds
    /// before the page loads.
    var privacy: Bool {
        get { UserDefaults.standard.bool(forKey: Self.privacyKey) }
        set {
            UserDefaults.standard.set(newValue, forKey: Self.privacyKey)
            // Turned on or off while a recording runs: covered, or shown, from now.
            captureChanged()
        }
    }

    /// In privacy mode with the screen being recorded, mirrored or shared:
    /// the cover is up, and stays up through whatever else would take it down.
    private var watched: Bool {
        #if targetEnvironment(macCatalyst)
        return false
        #else
        return privacy && scene?.screen.isCaptured == true
        #endif
    }
    private var captureWatch: NSObjectProtocol?
    static let watchedReason = "Covered while the screen is being recorded or shared. Privacy mode is on in Nib’s Settings."

    private func captureChanged() {
        if watched { show() }
        // Not while Nib is away: coming back takes the cover down, or asks first.
        else if !locked, scene?.activationState == .foregroundActive { hide() }
    }

    // MARK: Scene lifecycle (SceneDelegate)

    func sceneDidConnect(_ scene: UIWindowScene, window: UIWindow?) {
        // A cover made for a scene since gone would show nowhere: made anew.
        if cover?.windowScene !== scene { cover = nil }
        self.scene = scene
        self.window = window
        #if !targetEnvironment(macCatalyst)
        if captureWatch == nil {
            captureWatch = NotificationCenter.default.addObserver(forName: UIScreen.capturedDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
                self?.captureChanged()
            }
        }
        #endif
        // A cold launch always locks: there is no telling how long it was away.
        if enabled { lock() }
        // Launched into a recording, in privacy mode.
        else if watched { show() }
    }

    func sceneWillResignActive() {
        #if !targetEnvironment(macCatalyst)
        if !enabled, vaultOpen || privacy { return show(keepingKeyboard: true) }
        #endif
        guard enabled, !authenticating else { return }
        #if targetEnvironment(macCatalyst)
        // A Mac has no app-switcher snapshot, and covering the window every
        // time another app is in front would hide the writing for nothing.
        // Being away starts here instead, and a window left showing behind
        // another app's is covered once the delay is up, as it would be on
        // the way back.
        awayAt = Self.now()
        relock?.invalidate()
        relock = Timer.scheduledTimer(withTimeInterval: TimeInterval(after), repeats: false) { [weak self] _ in
            guard let self, self.enabled, !self.locked else { return }
            self.lock()
        }
        #else
        // Up before the snapshot is taken. This alone does not ask for Face ID:
        // pulling down Notification Center is not leaving. Nor does it take the
        // keyboard, and the caret with it: leaving does (sceneDidEnterBackground).
        show(keepingKeyboard: true)
        // Beside another app, though (Split View, Slide Over, Stage Manager), inactive is
        // that app in use with Nib still on screen, for as long as the writer
        // likes. That is away, as on the Mac: an hour in Safari beside Nib
        // ended with the notes open to a tap. On every iPad, as Nib's window
        // can be full-size with another app over it; a return within a moment
        // is Notification Center and the like, and isn't away.
        if UIDevice.current.userInterfaceIdiom == .pad, awayAt == nil {
            awayAt = Self.now()
            onlyResigned = true
        }
        #endif
    }

    func sceneDidEnterBackground() {
        #if !targetEnvironment(macCatalyst)
        if !enabled, vaultOpen || privacy { return show() }
        #endif
        guard enabled else { return }
        // Even with a Face ID or passcode sheet up: the sheet only makes Nib
        // resign, never leave, so being here means the writer left. Skipping
        // this left Nib uncovered and never relocking. Away since it went
        // inactive beside another app, if it did.
        awayAt = awayAt ?? Self.now()
        onlyResigned = false
        show()
        context?.invalidate()
    }

    func sceneDidBecomeActive() {
        #if targetEnvironment(macCatalyst)
        relock?.invalidate()
        relock = nil
        #endif
        guard !authenticating else { return }
        if !locked, enabled, let away = awayAt {
            // A clock that went backwards is not time to trust: lock.
            let away = Int64(bitPattern: Self.now()) - Int64(bitPattern: away)
            if away < 0 || away >= max(Int64(after) * 1_000_000_000, onlyResigned ? Self.moment : 0) { lock() }
        }
        awayAt = nil
        onlyResigned = false
        if locked { authenticate(reason: "unlock your notes") { if $0 { self.unlock() } } }
        else { hide() }
    }

    // MARK: Settings (NibLockPlugin)

    struct Status {
        var enabled: Bool
        var after: Int
        /// False when the device has no passcode, so there is nothing to unlock with.
        var available: Bool
        var biometry: String
        /// Behind the cover now, waiting for Face ID or the passcode.
        var locked: Bool
    }

    func status() -> Status {
        let context = LAContext()
        var error: NSError?
        let available = context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error)
        // biometryType is only filled in once canEvaluatePolicy has been asked.
        _ = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        let biometry: String
        switch context.biometryType {
        case .faceID: biometry = "faceID"
        case .touchID: biometry = "touchID"
        default:
            if #available(iOS 17, macCatalyst 17, *), context.biometryType == .opticID { biometry = "opticID" } else { biometry = "none" }
        }
        return Status(enabled: enabled && available, after: after, available: available, biometry: biometry, locked: locked)
    }

    /// Turning it on or off asks first: on, to prove it will open again; off,
    /// so someone handed the unlocked phone cannot quietly leave it off. A
    /// longer delay while it is on asks too, for the same reason; a shorter one
    /// does not.
    func set(enabled next: Bool, after: Int, done: @escaping (Bool) -> Void) {
        let delay = Self.clamped(after)
        let turningOn = next && !enabled
        let store = {
            UserDefaults.standard.set(next, forKey: Self.enabledKey)
            UserDefaults.standard.set(delay, forKey: Self.afterKey)
            // A reminder shows past the lock: those already set stop showing their note's title.
            if turningOn { NibRemindersPlugin.retitle(nil, as: "A reminder") }
            // And the share sheet, which offered notes to add to by their titles, offers none.
            if turningOn { NibInbox.setTargets([]) }
            done(true)
        }
        if next == enabled {
            guard next, delay > self.after else { return store() }
            return authenticate(reason: "lock Nib less often") { ok in
                if ok { store() } else { done(false) }
            }
        }
        // The page disables the switch then, but it must not turn on with
        // nothing to unlock it.
        if next && !status().available { return done(false) }
        authenticate(reason: next ? "turn on Lock Nib" : "turn off Lock Nib") { ok in
            if ok { store() } else { done(false) }
        }
    }

    // MARK: The cover

    private func lock() {
        locked = true
        show()
        // The page shuts the vault when it is hidden, but a Mac window covered
        // after the delay never is: tell it (src/App.tsx `onLocked`).
        (window?.rootViewController as? CAPBridgeViewController)?.bridge?.triggerWindowJSEvent(eventName: "niblock")
    }

    private func unlock() {
        locked = false
        hide()
        // On a launch, the page's loading screen waited behind the cover; it
        // plays now (src/lib/opening.ts).
        (window?.rootViewController as? CAPBridgeViewController)?.bridge?.triggerWindowJSEvent(eventName: "nibunlock")
    }

    // MARK: Colours

    private static let colorsKey = "nib.lock.colors"

    /// The page's shell and ink (NibWindowPlugin `setCover`), kept for the next
    /// launch, whose cover is up before the page has said anything. Till the
    /// page first says, Nib's own light and dark (src/index.css).
    var colors: (shell: UIColor, ink: UIColor) {
        if let stored = UserDefaults.standard.stringArray(forKey: Self.colorsKey), stored.count == 2,
           let shell = Self.color(stored[0]), let ink = Self.color(stored[1]) {
            return (shell, ink)
        }
        return (
            UIColor { $0.userInterfaceStyle == .dark ? Self.color("#0e0f11")! : Self.color("#fafaf8")! },
            UIColor { $0.userInterfaceStyle == .dark ? Self.color("#e6e6e6")! : Self.color("#1a1a1a")! }
        )
    }

    func setColors(shell: String, ink: String) {
        guard Self.color(shell) != nil, Self.color(ink) != nil else { return }
        UserDefaults.standard.set([shell, ink], forKey: Self.colorsKey)
        restyle()
    }

    /// The cover in the page's colours, and the status bar over it light or
    /// dark to suit them, whatever the system's own appearance.
    private func restyle() {
        guard let cover else { return }
        (cover.rootViewController as? CoverController)?.recolor()
        var white: CGFloat = 0
        let stored = UserDefaults.standard.stringArray(forKey: Self.colorsKey) != nil
        colors.shell.getWhite(&white, alpha: nil)
        cover.overrideUserInterfaceStyle = !stored ? .unspecified : white < 0.5 ? .dark : .light
    }

    /// `#rrggbb`, as the page's theme colours are written.
    private static func color(_ hex: String) -> UIColor? {
        guard hex.count == 7, hex.hasPrefix("#"), let value = UInt32(hex.dropFirst(), radix: 16) else { return nil }
        return UIColor(red: CGFloat(value >> 16 & 0xFF) / 255, green: CGFloat(value >> 8 & 0xFF) / 255, blue: CGFloat(value & 0xFF) / 255, alpha: 1)
    }

    private func show(keepingKeyboard: Bool = false) {
        guard let scene else { return }
        // The keyboard sits above every window in the app, cover included, and
        // its suggestions can show words from the note, in the app-switcher
        // snapshot too.
        if !keepingKeyboard { window?.endEditing(true) }
        let window = cover ?? {
            let window = UIWindow(windowScene: scene)
            window.windowLevel = .alert + 1
            window.rootViewController = CoverController { [weak self] in
                self?.authenticate(reason: "unlock your notes") { if $0 { self?.unlock() } }
            }
            cover = window
            restyle()
            return window
        }()
        (window.rootViewController as? CoverController)?.showsUnlock = locked
        (window.rootViewController as? CoverController)?.says = watched ? Self.watchedReason : nil
        window.isHidden = false
        window.makeKeyAndVisible()
        UIAccessibility.post(notification: .screenChanged, argument: window.rootViewController?.view)
    }

    private func hide() {
        guard let cover, !cover.isHidden else { return }
        // Still being recorded or shared, in privacy mode: the cover stays, with nothing left to unlock, saying why.
        if watched {
            (cover.rootViewController as? CoverController)?.showsUnlock = false
            (cover.rootViewController as? CoverController)?.says = Self.watchedReason
            return
        }
        cover.isHidden = true
        window?.makeKeyAndVisible()
        UIAccessibility.post(notification: .screenChanged, argument: nil)
    }

    private func authenticate(reason: String, then: @escaping (Bool) -> Void) {
        // One sheet at a time. A second request is answered, as a no, rather
        // than left waiting for ever.
        guard !authenticating else { return then(false) }
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            if (error as? LAError)?.code == .passcodeNotSet {
                // The passcode was removed after the lock was turned on. There
                // is nothing left to unlock with, so rather than shut the writer
                // out of their own notes, the lock opens and switches itself off.
                UserDefaults.standard.set(false, forKey: Self.enabledKey)
                return then(true)
            }
            return then(false)
        }
        authenticating = true
        self.context = context
        context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { ok, _ in
            DispatchQueue.main.async {
                self.authenticating = false
                self.context = nil
                then(ok)
                // Left while the sheet was up, and back before it answered:
                // coming back was skipped then, so it happens now.
                if self.awayAt != nil, self.scene?.activationState == .foregroundActive { self.sceneDidBecomeActive() }
                #if targetEnvironment(macCatalyst)
                // Left while it was up, and still away: leaving was skipped,
                // as the sheet itself makes Nib resign, so no relock started.
                // A moment on, so the sheet has handed Nib back if it is here.
                DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                    if self.scene?.activationState != .foregroundActive { self.sceneWillResignActive() }
                }
                #endif
            }
        }
    }
}

/// Nothing of the writing: the nib where the launch screen has it, in the
/// page's colours, and the way back in.
private final class CoverController: UIViewController {
    private let onUnlock: () -> Void
    private let nib = UIImageView(image: UIImage(named: "LaunchMark")?.withRenderingMode(.alwaysTemplate))
    private let unlock = UIButton(type: .system)
    private let reason = UILabel()

    var showsUnlock = false {
        didSet { unlock.isHidden = !showsUnlock }
    }
    /// Why it's up, when that needs saying: nothing to unlock, and Nib is in front.
    var says: String? {
        didSet {
            reason.text = says
            reason.isHidden = says == nil
        }
    }

    init(onUnlock: @escaping () -> Void) {
        self.onUnlock = onUnlock
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        // VoiceOver reads this window and nothing behind it.
        view.accessibilityViewIsModal = true

        nib.isAccessibilityElement = true
        nib.accessibilityLabel = "Nib"

        unlock.setTitle("Unlock", for: .normal)
        unlock.titleLabel?.font = .systemFont(ofSize: 15, weight: .medium)
        unlock.isHidden = !showsUnlock
        unlock.addAction(UIAction { [weak self] _ in self?.onUnlock() }, for: .touchUpInside)

        reason.font = .systemFont(ofSize: 13)
        reason.numberOfLines = 0
        reason.textAlignment = .center
        reason.text = says
        reason.isHidden = says == nil

        for subview in [nib, unlock, reason] {
            subview.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(subview)
        }
        NSLayoutConstraint.activate([
            // As LaunchScreen.storyboard has it, so a launch goes from one to
            // the other with nothing moving.
            nib.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            nib.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            nib.widthAnchor.constraint(equalToConstant: 55),
            nib.heightAnchor.constraint(equalToConstant: 89),
            unlock.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            unlock.topAnchor.constraint(equalTo: nib.bottomAnchor, constant: 28),
            reason.topAnchor.constraint(equalTo: unlock.bottomAnchor, constant: 20),
            reason.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            reason.widthAnchor.constraint(lessThanOrEqualToConstant: 300),
            reason.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 32),
        ])
        recolor()
    }

    func recolor() {
        guard isViewLoaded else { return }
        let colors = NibLock.shared.colors
        view.backgroundColor = colors.shell
        nib.tintColor = colors.ink
        unlock.tintColor = colors.ink
        reason.textColor = colors.ink.withAlphaComponent(0.7)
    }
}

/// The page's side of the lock: read the setting, and change it.
@objc(NibLockPlugin)
public class NibLockPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NibLockPlugin"
    public let jsName = "NibLock"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "vault", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "privacy", returnType: CAPPluginReturnPromise)
    ]

    private func describe(_ status: NibLock.Status) -> [String: Any] {
        let device: String
        #if targetEnvironment(macCatalyst)
        device = "Mac"
        #else
        device = UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone"
        #endif
        return ["enabled": status.enabled, "after": status.after, "available": status.available, "biometry": status.biometry, "device": device, "locked": status.locked, "privacy": NibLock.shared.privacy]
    }

    @objc func status(_ call: CAPPluginCall) {
        DispatchQueue.main.async { call.resolve(self.describe(NibLock.shared.status())) }
    }

    @objc func set(_ call: CAPPluginCall) {
        guard let enabled = call.getBool("enabled") else { return call.reject("Expected enabled.") }
        let after = call.getInt("after") ?? NibLock.shared.after
        DispatchQueue.main.async {
            NibLock.shared.set(enabled: enabled, after: after) { ok in
                if ok { call.resolve(self.describe(NibLock.shared.status())) }
                else { call.reject("Cancelled.") }
            }
        }
    }

    /// Privacy mode on or off. Nothing is asked: it's a cover, not a lock.
    @objc func privacy(_ call: CAPPluginCall) {
        guard let on = call.getBool("on") else { return call.reject("Expected on.") }
        DispatchQueue.main.async {
            NibLock.shared.privacy = on
            call.resolve(self.describe(NibLock.shared.status()))
        }
    }

    @objc func vault(_ call: CAPPluginCall) {
        let open = call.getBool("open") ?? false
        DispatchQueue.main.async {
            NibLock.shared.vaultOpen = open
            call.resolve()
        }
    }
}
