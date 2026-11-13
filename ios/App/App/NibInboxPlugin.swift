import Foundation
import Capacitor

/// The page's side of quick capture (src/lib/inbox.ts).
///
/// The inbox empties in two steps: `list` hands the captures over, the page
/// saves each one as a note, and only then does `ack` delete their files. A
/// crash between the two leaves the files in place, and the next drain, which
/// reuses each capture's id for its note, saves nothing twice.
///
/// It also passes on nib:// links (widgets, Shortcuts), which Capacitor's
/// scene proxy announces when one opens the app. A link that cold-launches
/// Nib arrives before the page is listening, so it is held until it is heard.
@objc(NibInboxPlugin)
public class NibInboxPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NibInboxPlugin"
    public let jsName = "NibInbox"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "ack", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "targets", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "plus", returnType: CAPPluginReturnPromise)
    ]

    override public func load() {
        NotificationCenter.default.addObserver(forName: .capacitorOpenURL, object: nil, queue: .main) { [weak self] notification in
            guard let opened = notification.object as? [String: Any?],
                  let url = opened["url"] as? URL,
                  url.scheme == "nib" else { return }
            self?.notifyListeners("openUrl", data: ["url": url.absoluteString], retainUntilConsumed: true)
        }
    }

    @objc func list(_ call: CAPPluginCall) {
        let captures = NibInbox.list().map { capture -> [String: Any] in
            var described: [String: Any] = ["id": capture.id, "text": capture.text, "createdAt": capture.createdAt]
            if let url = capture.url { described["url"] = url }
            if let into = capture.into { described["into"] = into }
            // Each with where the page can read it from: the files are in the group's folder, not the page's.
            let files = NibInbox.files(of: capture).map { ["name": $0.shared.name, "type": $0.shared.type, "size": $0.shared.size, "uri": $0.at.absoluteString] as [String: Any] }
            if !files.isEmpty { described["files"] = files }
            if let page = capture.page { described["page"] = page }
            if let part = capture.part { described["part"] = part }
            return described
        }
        call.resolve(["captures": captures])
    }

    /// The notes the share sheet may offer to add to. None while Lock Nib is
    /// on, whatever the page says: a title in the share sheet would be one
    /// shown past the lock.
    @objc func targets(_ call: CAPPluginCall) {
        let asked = (call.getArray("targets") ?? []).compactMap { $0 as? [String: Any] }.compactMap { one -> NibInbox.Target? in
            guard let id = one["id"] as? String, let title = one["title"] as? String, let kind = one["kind"] as? String else { return nil }
            return NibInbox.Target(id: id, title: title, kind: kind)
        }
        NibInbox.setTargets(NibLock.shared.enabled ? [] : asked)
        call.resolve()
    }

    /// Whether Nib Plus is on, for the share sheet to go by (NibInbox `plus`).
    @objc func plus(_ call: CAPPluginCall) {
        NibInbox.plus = call.getBool("active") ?? false
        call.resolve()
    }

    @objc func ack(_ call: CAPPluginCall) {
        let ids = call.getArray("ids", String.self) ?? []
        NibInbox.remove(ids)
        call.resolve()
    }
}
