import Foundation
import Capacitor
import UIKit
#if targetEnvironment(macCatalyst)
import ServiceManagement
#endif

/// Gives Nib's theme to the window, light or dark, so on the Mac the title bar
/// matches the page instead of following macOS, and on iPhone and iPad the
/// status bar and keyboard do (see `applyTheme` in src/App.tsx). "system" hands
/// the choice back to the system. The window's style is also the web view's
/// prefers-color-scheme, which is what "system" reads.
@objc(NibWindowPlugin)
public class NibWindowPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NibWindowPlugin"
    public let jsName = "NibWindow"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setTheme", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "fitKeyboard", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setIcon", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "icon", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "painted", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setCover", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hideEditMenu", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "login", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setLogin", returnType: CAPPluginReturnPromise)
    ]

    /// The current choice, for the View → Appearance checkmark (AppDelegate).
    static var theme = "system"

    @objc func setTheme(_ call: CAPPluginCall) {
        let theme = call.getString("theme") ?? "system"
        // A named theme (src/lib/theme NAMED) says whether it is dark.
        let named = call.getBool("dark")
        let style: UIUserInterfaceStyle = theme == "light" ? .light : theme == "dark" ? .dark
            : named.map { $0 ? .dark : .light } ?? .unspecified
        DispatchQueue.main.async {
            Self.theme = theme
            self.bridge?.viewController?.view.window?.overrideUserInterfaceStyle = style
            call.resolve()
        }
    }

    /// Customize's app icon (Nib Plus), on iPhone and iPad: one of the
    /// alternates in Assets.xcassets (the build's
    /// ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES), or none for the
    /// standard one. iOS tells the writer itself, in an alert.
    @objc func setIcon(_ call: CAPPluginCall) {
        let name = call.getString("name")
        DispatchQueue.main.async {
            guard UIApplication.shared.supportsAlternateIcons else {
                call.reject("This device keeps one icon")
                return
            }
            UIApplication.shared.setAlternateIconName(name) { error in
                if let error { call.reject(error.localizedDescription) } else { call.resolve() }
            }
        }
    }

    /// The alternate icon in use, if any.
    @objc func icon(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let name = UIApplication.shared.alternateIconName { call.resolve(["name": name]) } else { call.resolve([:]) }
        }
    }

    /// On iPhone and iPad: whether the web view ends where the keyboard begins
    /// (true while a field is being typed in) or runs on beneath it (while the
    /// text is, with the formatting bar riding on the keyboard). See
    /// MainViewController and src/lib/keyboard.ts.
    @objc func fitKeyboard(_ call: CAPPluginCall) {
        let fit = call.getBool("fit") ?? false
        DispatchQueue.main.async {
            (self.bridge?.viewController as? MainViewController)?.fitsKeyboard = fit
            call.resolve()
        }
    }

    /// Lock Nib's cover in the page's shell and ink, as #rrggbb (NibLock).
    @objc func setCover(_ call: CAPPluginCall) {
        guard let shell = call.getString("shell"), let ink = call.getString("ink") else { return call.reject("Expected shell and ink.") }
        DispatchQueue.main.async {
            NibLock.shared.setColors(shell: shell, ink: ink)
            call.resolve()
        }
    }

    /// Puts away the system's Cut, Copy and Paste menu, which sits by the
    /// selection, over the selection toolbar's ••• panel as it opens
    /// (src/editor/SelectionToolbar). The page can't: a selection it sets
    /// again leaves the menu up. A tap in the selection brings it back.
    @objc func hideEditMenu(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if #available(iOS 16, *) {
                var views: [UIView] = self.bridge?.webView.map { [$0] } ?? []
                while let view = views.popLast() {
                    for case let menu as UIEditMenuInteraction in view.interactions { menu.dismissMenu() }
                    views.append(contentsOf: view.subviews)
                }
            } else {
                UIMenuController.shared.hideMenu()
            }
            call.resolve()
        }
    }

    /// "Open Nib at login", on a Mac (Settings): whether macOS has Nib among
    /// its login items. `approval`: asked for, and turned off in System
    /// Settings, where it has to be allowed. Not `available` anywhere else,
    /// nor on a Mac before macOS 13.
    private var loginState: [String: Any] {
        #if targetEnvironment(macCatalyst)
        if #available(macCatalyst 16.0, *) {
            let status = SMAppService.mainApp.status
            return ["available": true, "on": status == .enabled, "approval": status == .requiresApproval]
        }
        #endif
        return ["available": false, "on": false, "approval": false]
    }

    @objc func login(_ call: CAPPluginCall) {
        call.resolve(loginState)
    }

    @objc func setLogin(_ call: CAPPluginCall) {
        guard let on = call.getBool("on") else { return call.reject("Expected on.") }
        #if targetEnvironment(macCatalyst)
        if #available(macCatalyst 16.0, *) {
            do {
                if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
            } catch {
                // Refused because it's turned off in System Settings: that isn't a failure, it's what the state says.
                if SMAppService.mainApp.status != .requiresApproval { return call.reject(error.localizedDescription) }
            }
            return call.resolve(loginState)
        }
        #endif
        call.reject("Not on this device.")
    }

    /// The page has painted its loading screen (index.html), so the launch
    /// screen's frame over it can go (MainViewController).
    @objc func painted(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            (self.bridge?.viewController as? MainViewController)?.painted()
            call.resolve()
        }
    }
}
