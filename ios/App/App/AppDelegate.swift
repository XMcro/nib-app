import UIKit
import Capacitor
import UserNotifications

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Reminders (NibRemindersPlugin). Set here, before launch finishes, or
        // the tap that launches Nib is never heard; capacitor.config.ts tells
        // Capacitor to leave the delegate alone.
        UNUserNotificationCenter.current().delegate = self
        NibRemindersPlugin.offerSnooze()
        // Before the page asks for the sync code (NibKeychainPlugin).
        NibKeychainPlugin.forgetIfFreshInstall()
        #if targetEnvironment(macCatalyst)
        // The Dock icon's menu, on the Mac: each a nib:// link the page knows,
        // as a widget's is (SceneDelegate `follow`). An iPhone or iPad would show
        // these on a long press of Nib's icon, so they are set only here.
        application.shortcutItems = [
            UIApplicationShortcutItem(type: "nib://new-note", localizedTitle: "New Note"),
            UIApplicationShortcutItem(type: "nib://new-page", localizedTitle: "New Page"),
        ]
        #endif
        return true
    }

    /// A reminder that comes due while Nib is open still shows.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list, .sound])
    }

    /// A reminder was tapped: open its note. Or one of its snooze buttons was pressed: it's put off, and Nib isn't opened.
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let content = response.notification.request.content
        guard let itemId = content.userInfo["itemId"] as? String else { return completionHandler() }
        if let later = NibRemindersPlugin.snoozeDate(response.actionIdentifier) {
            return NibRemindersPlugin.snooze(content, itemId: itemId, until: later, done: completionHandler)
        }
        NibRemindersPlugin.opened(itemId: itemId)
        completionHandler()
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }

    #if targetEnvironment(macCatalyst)
    /// Handled here rather than in MainViewController: the app delegate is
    /// always in the responder chain, so the items stay enabled even when
    /// nothing in the window has focus, as on a fresh launch.
    @objc func nibMenu(_ command: UICommand) {
        // Behind Lock Nib's cover, nothing: Export Everything or Back Up
        // Library would hand every note to whoever is at the Mac.
        guard !NibLock.shared.locked, let id = command.propertyList as? String else { return }
        let controller = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .compactMap { $0.rootViewController as? MainViewController }
            .first
        controller?.menu(id)
    }

    /// Ticks the current choice under View → Appearance, and greys out every
    /// command of Nib's while Lock Nib covers the window (see `nibMenu`).
    override func validate(_ command: UICommand) {
        super.validate(command)
        guard command.action == #selector(nibMenu(_:)), let id = command.propertyList as? String else { return }
        if NibLock.shared.locked { command.attributes.insert(.disabled) } else { command.attributes.remove(.disabled) }
        guard id.hasPrefix("theme-") else { return }
        command.state = id == "theme-\(NibWindowPlugin.theme)" ? .on : .off
    }

    /// The Mac menu bar. Each item runs the palette command of the same id in
    /// the page (see `menu` in src/App.tsx), so the menu, the palette and the
    /// keyboard all do the same thing.
    override func buildMenu(with builder: UIMenuBuilder) {
        super.buildMenu(with: builder)
        guard builder.system == .main else { return }

        // Nib is one window of text, not a document app. Its own commands
        // replace the system's sidebar, find and format menus, which do nothing
        // here (Nib keeps its own library, searches every note, and has its own
        // styles rather than the font panel).
        builder.remove(menu: .newScene)
        if #available(macCatalyst 16, *) { builder.remove(menu: .document) }
        builder.remove(menu: .toolbar)
        builder.remove(menu: .sidebar)
        builder.remove(menu: .find)

        let action = #selector(nibMenu(_:))
        func item(_ title: String, _ id: String) -> UICommand {
            UICommand(title: title, action: action, propertyList: id)
        }
        func key(_ title: String, _ id: String, _ input: String, _ flags: UIKeyModifierFlags) -> UIKeyCommand {
            UIKeyCommand(title: title, action: action, input: input, modifierFlags: flags, propertyList: id)
        }

        let newOnes = UIMenu.Identifier("app.nib.menu.new")
        builder.insertChild(UIMenu(title: "", identifier: newOnes, options: .displayInline, children: [
            key("New Note", "new-note", "n", .command),
            key("New Page", "new-page", "n", [.command, .shift]),
        ]), atStartOfMenu: .file)
        builder.insertChild(UIMenu(options: .displayInline, children: [
            item("Share a Draft…", "share-draft"),
            item("Remind Me…", "remind"),
            UIMenu(title: "Export This One", children: [
                key("Markdown…", "export-one", "e", [.command, .shift]),
                item("Word…", "export-docx"),
                item("PDF…", "export-pdf"),
                item("HTML…", "export-html"),
            ]),
            item("Export Everything as Markdown…", "export-all"),
            item("Back Up Library…", "backup"),
        ]), atEndOfMenu: .file)

        builder.insertChild(UIMenu(options: .displayInline, children: [
            key("Find…", "find", "f", .command),
            key("Search All Notes", "search", "f", [.command, .alternate]),
        ]), atEndOfMenu: .edit)

        // The same styles as the Aa panel and the palette (src/editor/formats.ts),
        // with the editor's own shortcuts. Headings only act in a page; in a
        // note the page says why.
        builder.replaceChildren(ofMenu: .format) { _ in [
            UIMenu(options: .displayInline, children: [
                key("Title", "format-title", "1", [.command, .alternate]),
                key("Heading", "format-heading", "2", [.command, .alternate]),
                key("Subheading", "format-subheading", "3", [.command, .alternate]),
                key("Heading 4", "format-heading-four", "4", [.command, .alternate]),
                key("Heading 5", "format-heading-five", "5", [.command, .alternate]),
                key("Heading 6", "format-heading-six", "6", [.command, .alternate]),
                key("Body", "format-body", "0", [.command, .alternate]),
                key("Monostyled", "format-mono", "c", [.command, .alternate]),
                key("Quote", "format-quote", "b", [.command, .shift]),
            ]),
            UIMenu(options: .displayInline, children: [
                key("Bold", "format-bold", "b", .command),
                key("Italic", "format-italic", "i", .command),
                key("Underline", "format-underline", "u", .command),
                key("Strikethrough", "format-strike", "s", [.command, .shift]),
                key("Highlight", "format-highlight", "h", [.command, .shift]),
            ]),
            UIMenu(options: .displayInline, children: [
                key("Checklist", "format-checklist", "9", [.command, .shift]),
                key("Bulleted List", "format-bullets", "8", [.command, .shift]),
                key("Numbered List", "format-numbers", "7", [.command, .shift]),
                key("Indent", "format-indent", "]", .command),
                key("Outdent", "format-outdent", "[", .command),
            ]),
            UIMenu(options: .displayInline, children: [
                item("Callout", "format-callout"),
                UIMenu(title: "Callout Type", children: [
                    item("Note", "format-callout-note"),
                    item("Info", "format-callout-info"),
                    item("Tip", "format-callout-tip"),
                    item("Success", "format-callout-success"),
                    item("Question", "format-callout-question"),
                    item("Important", "format-callout-important"),
                    item("Warning", "format-callout-warning"),
                    item("Caution", "format-callout-caution"),
                ]),
            ]),
            UIMenu(options: .displayInline, children: [
                item("Align Left", "format-align-left"),
                item("Align Center", "format-align-center"),
                item("Align Right", "format-align-right"),
                item("Justify", "format-justify"),
            ]),
            // Pages only, as headings are; rows and columns need the caret in a table.
            UIMenu(title: "Table", children: [
                item("Insert Table", "table-insert"),
                UIMenu(options: .displayInline, children: [
                    item("Add Row", "table-add-row"),
                    item("Add Column", "table-add-column"),
                ]),
                UIMenu(options: .displayInline, children: [
                    item("Delete Row", "table-delete-row"),
                    item("Delete Column", "table-delete-column"),
                    item("Delete Table", "table-delete"),
                ]),
            ]),
        ] }

        // Tabs (src/lib/tabs), with Nib Plus and a window wide enough: without, the page asks for Plus or does nothing.
        // Put in only now: ⌘T is the system's Show Fonts until the Format menu above is replaced, and a group
        // with a shortcut that's taken isn't put in at all, which took New Note and New Page out with it.
        builder.insertSibling(UIMenu(options: .displayInline, children: [
            key("New Tab", "tab-new", "t", .command),
            item("Open in a New Tab…", "tab-open"),
        ]), afterMenu: newOnes)

        builder.insertChild(UIMenu(options: .displayInline, children: [
            key("Command Palette", "palette", "k", .command),
            key("Toggle Library", "library", "s", [.command, .control]),
            key("Focus Mode", "focus", "f", [.command, .shift]),
            UIMenu(title: "Appearance", children: [
                item("Light", "theme-light"),
                item("Dark", "theme-dark"),
                item("System", "theme-system"),
                // The named themes (src/lib/theme NAMED). A Plus one opens
                // Billing without Plus, as in the palette.
                UIMenu(options: .displayInline, children: [
                    item("Midnight Blue", "theme-midnight-blue"),
                    item("Gruvbox Dark", "theme-gruvbox-dark"),
                    item("Green Olive", "theme-green-olive"),
                    item("Clean Blue", "theme-clean-blue"),
                    item("Gruvbox Light", "theme-gruvbox-light"),
                    item("Pastel Pink", "theme-pastel-pink"),
                    item("Cream Soda", "theme-cream-soda"),
                ]),
                UIMenu(options: .displayInline, children: [
                    item("Purple Green", "theme-purple-green"),
                    item("Alien Pink", "theme-alien-pink"),
                    item("drcl", "theme-drcl"),
                    item("Nib Plus", "theme-nib-plus"),
                ]),
            ]),
        ]), atStartOfMenu: .view)

        // Only with tabs showing: with one document open, these do nothing.
        builder.insertChild(UIMenu(options: .displayInline, children: [
            key("Show Next Tab", "tab-next", "\t", .control),
            key("Show Previous Tab", "tab-previous", "\t", [.control, .shift]),
            item("Pin or Unpin Tab", "tab-pin"),
            item("Close Tab", "tab-close"),
        ]), atStartOfMenu: .window)
    }
    #endif
}
