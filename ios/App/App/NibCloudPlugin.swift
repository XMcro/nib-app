import Foundation
import Capacitor

/// The stamps in iCloud's key-value store (src/lib/cloud.ts): the days, the
/// stampbook's stamps, the market's trades and the day's coins, as one value,
/// on every iPhone, iPad and Mac signed in to the same Apple Account. Free,
/// and apart from Nib sync, so a pack opened or coins collected on one aren't
/// there to open or collect again on another. Nothing of the writing.
@objc(NibCloudPlugin)
public class NibCloudPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NibCloudPlugin"
    public let jsName = "NibCloud"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise)
    ]

    private static let key = "stamps"
    private let store = NSUbiquitousKeyValueStore.default

    public override func load() {
        NotificationCenter.default.addObserver(self, selector: #selector(changed(_:)), name: NSUbiquitousKeyValueStore.didChangeExternallyNotification, object: store)
        store.synchronize()
    }

    private var value: Any { store.string(forKey: Self.key) ?? NSNull() }

    /// Brought from another device: said to the page as it is now.
    @objc private func changed(_ notification: Notification) {
        let keys = notification.userInfo?[NSUbiquitousKeyValueStoreChangedKeysKey] as? [String] ?? []
        guard keys.contains(Self.key) else { return }
        DispatchQueue.main.async { self.notifyListeners("changed", data: ["value": self.value]) }
    }

    @objc func read(_ call: CAPPluginCall) {
        store.synchronize()
        call.resolve(["value": value])
    }

    @objc func write(_ call: CAPPluginCall) {
        guard let value = call.getString("value") else { return call.reject("Nothing to keep") }
        store.set(value, forKey: Self.key)
        store.synchronize()
        call.resolve()
    }
}
