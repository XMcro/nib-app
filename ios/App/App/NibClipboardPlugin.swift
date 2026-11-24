import Foundation
import Capacitor
import UIKit
import UniformTypeIdentifiers

/// Copying, for the page (src/lib/clipboard.ts). When a page writes the
/// clipboard itself, as the editor does on every copy, WebKit keeps the plain
/// text in a private type of its own: on the Mac other apps were handed only
/// the HTML, and for a Copy button nothing at all. Written here, the text goes
/// on as plain text, with the HTML beside it when there is some.
@objc(NibClipboardPlugin)
public class NibClipboardPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NibClipboardPlugin"
    public let jsName = "NibClipboard"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise)
    ]

    @objc func write(_ call: CAPPluginCall) {
        guard let text = call.getString("text") else { return call.reject("Nothing to copy.") }
        var item: [String: Any] = [UTType.utf8PlainText.identifier: text]
        if let html = call.getString("html"), !html.isEmpty {
            item[UTType.html.identifier] = Data(html.utf8)
        }
        // Something private (lib/clipboard Privately): gone after a while, and
        // a locked note's text kept off the writer's other devices.
        var options: [UIPasteboard.OptionsKey: Any] = [:]
        if let ms = call.getDouble("expiresIn") { options[.expirationDate] = Date(timeIntervalSinceNow: ms / 1000) }
        if call.getBool("localOnly") == true { options[.localOnly] = true }
        #if targetEnvironment(macCatalyst)
        // And marked, as nspasteboard.org has it, for the Mac's clipboard managers (Maccy, Paste, Alfred,
        // Raycast) to leave out of their history, which keeps what's copied long after the copy's gone.
        if !options.isEmpty {
            item["org.nspasteboard.ConcealedType"] = Data()
            item["org.nspasteboard.TransientType"] = Data()
        }
        #endif
        DispatchQueue.main.async {
            UIPasteboard.general.setItems([item], options: options)
            #if targetEnvironment(macCatalyst)
            if let ms = call.getDouble("expiresIn") {
                self.expire(UIPasteboard.general.changeCount, at: Date(timeIntervalSinceNow: ms / 1000))
            }
            #endif
            call.resolve()
        }
    }

    #if targetEnvironment(macCatalyst)
    /// The Mac ignores `.expirationDate`: other apps could still paste the copy
    /// after it passed. So Nib clears it itself, when the time is up or, if Nib
    /// was quit before then, at its next start. Only if nothing has been copied
    /// since, which the change count tells without reading what's there.
    private static let expiring = "nib.clipboard.expiring"

    override public func load() {
        guard let saved = UserDefaults.standard.dictionary(forKey: Self.expiring),
              let count = saved["count"] as? Int,
              let at = saved["at"] as? Double else { return }
        expire(count, at: Date(timeIntervalSince1970: at))
    }

    private func expire(_ count: Int, at: Date) {
        UserDefaults.standard.set(["count": count, "at": at.timeIntervalSince1970], forKey: Self.expiring)
        // By the clock on the wall: the other kind stops while the Mac sleeps, and the copy outlived its time by as long as that was.
        DispatchQueue.main.asyncAfter(wallDeadline: .now() + max(0, at.timeIntervalSinceNow)) {
            // A later private copy has its own turn.
            guard (UserDefaults.standard.dictionary(forKey: Self.expiring)?["count"] as? Int) == count else { return }
            UserDefaults.standard.removeObject(forKey: Self.expiring)
            if UIPasteboard.general.changeCount == count { UIPasteboard.general.items = [] }
        }
    }
    #endif
}
