import Capacitor
import WebKit

/// Capacitor's view controller, plus the plugins that live in this app rather
/// than in npm packages. Those have to be registered by hand.
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(NibStorePlugin())
        bridge?.registerPluginInstance(NibKeychainPlugin())
        bridge?.registerPluginInstance(NibPdfPlugin())
        bridge?.registerPluginInstance(NibSavePlugin())
        bridge?.registerPluginInstance(NibWindowPlugin())
        bridge?.registerPluginInstance(NibLockPlugin())
        bridge?.registerPluginInstance(NibClipboardPlugin())
        bridge?.registerPluginInstance(NibRemindersPlugin())
        bridge?.registerPluginInstance(NibInboxPlugin())
        bridge?.registerPluginInstance(NibTextPlugin())
        bridge?.registerPluginInstance(NibPicturePlugin())
        bridge?.registerPluginInstance(NibSpeechPlugin())
        bridge?.registerPluginInstance(NibCloudPlugin())
        bridge?.registerPluginInstance(NibPreviewPlugin())

        // On the Mac, tell the page so before any of it runs (`macApp` in
        // src/lib/platform.ts): a Mac has a keyboard and a menu bar, so the
        // desktop rules apply there. Added here rather than in
        // webViewConfiguration(for:), because Capacitor replaces the content
        // controller after that; this runs after, and before the page loads.
        if ProcessInfo.processInfo.isMacCatalystApp {
            webView?.configuration.userContentController.addUserScript(
                WKUserScript(source: "window.nibPlatform = 'mac'", injectionTime: .atDocumentStart, forMainFrameOnly: true)
            )
        }
        // A cold launch with Lock Nib on always locks (NibLock), so the page's
        // loading screen holds its line till the cover is down (index.html).
        if NibLock.shared.enabled {
            webView?.configuration.userContentController.addUserScript(
                WKUserScript(source: "window.nibLaunchedLocked = true", injectionTime: .atDocumentStart, forMainFrameOnly: true)
            )
        }
    }

    /// On the Mac, no inline predictive text in the web view. Its provisional
    /// text fights the editor's own: typing came out garbled, and text deleted
    /// with ⌘A and Delete came back a moment later. The page asks the same of
    /// the editor (`writingsuggestions` in src/editor/Editor.tsx).
    override func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let configuration = super.webViewConfiguration(for: instanceConfiguration)
        if ProcessInfo.processInfo.isMacCatalystApp, #available(iOS 17.0, *) {
            configuration.allowsInlinePredictions = false
        }
        return configuration
    }

    /// On iPhone and iPad the keyboard slides over the text, as it does over
    /// any text on iOS, and the formatting bar (src/editor/FormatBar.tsx)
    /// rides up and down on it. The page hears where the keyboard is going
    /// (`nibkeyboard`) and moves the bar itself, in step: when the web view
    /// was made shorter instead, the page jumped to its new size at once, the
    /// bar arrived before the keyboard, and the window showed white between
    /// the two. For a field (search, the vault, the palette) the page still
    /// asks for the web view to end where the keyboard begins
    /// (`fitsKeyboard`, src/lib/keyboard.ts), since those lay themselves out
    /// in what can be seen.
    ///
    /// And the page itself is held still. WKWebView reaches for the line with
    /// the caret when the keyboard comes up and scrolls the whole page up by
    /// the keyboard's height to show it: the bar flew up the screen, and a
    /// drag then moved the page with the bar on it rather than the text.
    /// Nothing in Nib needs the page to scroll, since the text, the lists and
    /// every panel scroll inside it, so it never does.
    override func viewDidLoad() {
        super.viewDidLoad()
        showLaunchFrame()
        guard !ProcessInfo.processInfo.isMacCatalystApp else { return }
        NotificationCenter.default.addObserver(
            self, selector: #selector(keyboardWillChangeFrame(_:)),
            name: UIResponder.keyboardWillChangeFrameNotification, object: nil
        )
        pageHeldStill = webView?.scrollView.observe(\.contentOffset) { scrollView, _ in
            if scrollView.contentOffset != .zero { scrollView.setContentOffset(.zero, animated: false) }
        }
    }

    /// The launch screen's own frame (LaunchScreen.storyboard), paper and the
    /// nib, light or dark as the system is, laid over the web view till its
    /// page has painted that same frame (index.html's loading screen, which
    /// then calls `painted` through NibWindowPlugin). A web view shows white
    /// till its page paints, so the launch screen gave way to white first; on
    /// the Mac the window opened white. Gone after a few seconds regardless,
    /// so it never hides a page that failed to load.
    private var launchFrame: UIView?

    private func showLaunchFrame() {
        guard let webView else { return }
        let frame = UIView()
        frame.backgroundColor = UIColor {
            $0.userInterfaceStyle == .dark
                ? UIColor(red: 14 / 255, green: 15 / 255, blue: 17 / 255, alpha: 1)
                : UIColor(red: 250 / 255, green: 250 / 255, blue: 248 / 255, alpha: 1)
        }
        let nib = UIImageView(image: UIImage(named: "LaunchMark"))
        for view in [frame, nib] { view.translatesAutoresizingMaskIntoConstraints = false }
        frame.addSubview(nib)
        webView.addSubview(frame)
        NSLayoutConstraint.activate([
            frame.topAnchor.constraint(equalTo: webView.topAnchor),
            frame.bottomAnchor.constraint(equalTo: webView.bottomAnchor),
            frame.leadingAnchor.constraint(equalTo: webView.leadingAnchor),
            frame.trailingAnchor.constraint(equalTo: webView.trailingAnchor),
            nib.centerXAnchor.constraint(equalTo: frame.centerXAnchor),
            nib.centerYAnchor.constraint(equalTo: frame.centerYAnchor),
            nib.widthAnchor.constraint(equalToConstant: 55),
            nib.heightAnchor.constraint(equalToConstant: 89),
        ])
        launchFrame = frame
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in self?.painted() }
    }

    /// The page has painted its loading screen, the same frame, under this one.
    func painted() {
        launchFrame?.removeFromSuperview()
        launchFrame = nil
    }

    private var pageHeldStill: NSKeyValueObservation?
    /// How far a docked keyboard reaches up from the bottom of the window. A
    /// floating one on an iPad lies over the page and counts as none.
    private var keyboardHeight: CGFloat = 0
    /// Whether the web view ends at the keyboard; the page decides (NibWindowPlugin).
    var fitsKeyboard = false {
        didSet { fit() }
    }

    @objc private func keyboardWillChangeFrame(_ notification: Notification) {
        guard let container = view.superview, let screen = view.window?.screen,
              let end = (notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue
        else { return }
        let keyboard = container.convert(end, from: screen.coordinateSpace)
        // One going away ends below the window.
        let docked = keyboard.maxY >= container.bounds.maxY - 1
        keyboardHeight = docked ? max(0, container.bounds.maxY - keyboard.minY) : 0
        fit()
        let height = Int(keyboardHeight.rounded()), window = Int(container.bounds.height.rounded())
        bridge?.triggerWindowJSEvent(eventName: "nibkeyboard", data: "{\"height\":\(height),\"window\":\(window)}")
    }

    private func fit() {
        guard let container = view.superview else { return }
        // Never below nothing: in a very short Stage Manager or Slide Over
        // window the keyboard can be taller than the window itself.
        let height = max(0, container.bounds.height - (fitsKeyboard ? keyboardHeight : 0))
        view.frame = CGRect(x: 0, y: 0, width: container.bounds.width, height: height)
    }

    /// A choice from the Mac menu bar (AppDelegate.buildMenu), passed to the
    /// page by the id of the command it runs.
    func menu(_ id: String) {
        guard id.allSatisfy({ $0.isLetter || $0 == "-" }) else { return }
        bridge?.triggerWindowJSEvent(eventName: "nibmenu", data: "{\"id\":\"\(id)\"}")
    }
}
