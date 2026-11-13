import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        #if targetEnvironment(macCatalyst)
        // Room for the library's header and a readable line of text.
        windowScene.sizeRestrictions?.minimumSize = CGSize(width: 720, height: 480)
        #endif
        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = MainViewController()
        window?.makeKeyAndVisible()
        // Before the page has drawn anything (NibLockPlugin.swift).
        NibLock.shared.sceneDidConnect(windowScene, window: window)

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
        // Chosen from the Dock menu with Nib not running: after the line above, by when the plugin that passes links on is listening.
        if let chosen = connectionOptions.shortcutItem { follow(chosen) }
    }

    /// A choice from the Dock icon's menu (AppDelegate), with Nib running.
    func windowScene(_ windowScene: UIWindowScene, performActionFor shortcutItem: UIApplicationShortcutItem, completionHandler: @escaping (Bool) -> Void) {
        completionHandler(follow(shortcutItem))
    }

    /// Passed to the page as the nib:// link it stands for, the way one from a
    /// widget is announced (NibInboxPlugin), which holds it till the page hears.
    @discardableResult
    private func follow(_ item: UIApplicationShortcutItem) -> Bool {
        guard let url = URL(string: item.type), url.scheme == "nib" else { return false }
        NotificationCenter.default.post(name: .capacitorOpenURL, object: ["url": url, "options": [UIApplication.OpenURLOptionsKey: Any]()] as [String: Any?])
        return true
    }

    /// As a window on an iPad (iPadOS 26 and later) Nib has the system's
    /// window controls in its top-left corner. Left to the system's own
    /// choice they lie over the page, on the library's title and Settings'
    /// heading, and the safe area says nothing of them. Asked for at their
    /// smallest, they get a strip of their own that the system counts in the
    /// top safe area, which the page already keeps clear
    /// (env(safe-area-inset-top)). At full size there are none, and on the
    /// Mac the window has its title bar.
    #if !targetEnvironment(macCatalyst)
    @available(iOS 26.0, *)
    func preferredWindowingControlStyle(for windowScene: UIWindowScene) -> UIWindowScene.WindowingControlStyle {
        windowScene.traitCollection.userInterfaceIdiom == .pad ? .minimal : .automatic
    }
    #endif

    // Lock Nib covers the window on the way out and asks on the way back in.
    func sceneWillResignActive(_ scene: UIScene) {
        NibLock.shared.sceneWillResignActive()
    }

    func sceneDidEnterBackground(_ scene: UIScene) {
        NibLock.shared.sceneDidEnterBackground()
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        NibLock.shared.sceneDidBecomeActive()
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
