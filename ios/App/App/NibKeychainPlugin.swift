import Foundation
import Capacitor
import LocalAuthentication
import Security

/// Keeps the sync code in the Keychain. Not in the web view's storage, which
/// iOS may clear, and not synced through iCloud: the code travels between
/// devices only when the writer types or pastes it.
@objc(NibKeychainPlugin)
public class NibKeychainPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NibKeychainPlugin"
    public let jsName = "NibKeychain"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "vaultStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "vaultStore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "vaultRecall", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "vaultForget", returnType: CAPPluginReturnPromise)
    ]

    private static let service = "app.nib.ios.sync"
    /// The vault's passcode, kept if the writer asks (src/lib/vaultKey.ts).
    private static let vaultService = "app.nib.ios.vault"
    /// Whether it's kept, known without asking for Face ID to find out.
    private static let vaultKept = "nib.vault.biometric"
    /// What's to happen only once on this device, ever (src/lib/feedback.ts).
    /// `forgetIfFreshInstall` leaves these alone, so deleting Nib and
    /// downloading it again doesn't make it happen twice. Nothing of the
    /// writing and nothing secret.
    private static let lastingService = "app.nib.ios.lasting"

    /// The Keychain outlives the app: deleting Nib leaves its sync code behind,
    /// and the next person to install Nib on a shared iPad would join that
    /// library without a word. So a fresh install forgets it. Fresh means
    /// nothing of an earlier Nib is here: no marker in UserDefaults (deleted
    /// with the app, and written only from this version on), no library files
    /// in Documents (src/lib/mirror.ts), and no web view data in Library/WebKit,
    /// where the library itself lives. An update has run its web view before,
    /// so it keeps its code. Called at launch, before anything reads it.
    static func forgetIfFreshInstall() {
        let marker = "nib.installed"
        guard !UserDefaults.standard.bool(forKey: marker) else { return }
        UserDefaults.standard.set(true, forKey: marker)
        let files = FileManager.default
        let documents = files.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let library = files.urls(for: .libraryDirectory, in: .userDomainMask)[0]
        let earlier = [
            documents.appendingPathComponent("nib-library.json"),
            documents.appendingPathComponent("nib-library.json.tmp"),
            documents.appendingPathComponent("nib-library"),
            library.appendingPathComponent("WebKit"),
        ]
        guard !earlier.contains(where: { files.fileExists(atPath: $0.path) }) else { return }
        SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service] as CFDictionary)
        SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: vaultService] as CFDictionary)
    }

    private func query(_ account: String, _ call: CAPPluginCall) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: call.getBool("lasting") == true ? Self.lastingService : Self.service,
            kSecAttrAccount as String: account
        ]
    }

    private func account(_ call: CAPPluginCall) -> String? {
        guard let key = call.getString("key"), !key.isEmpty else {
            call.reject("Missing key.")
            return nil
        }
        return key
    }

    @objc func get(_ call: CAPPluginCall) {
        guard let key = account(call) else { return }
        var request = query(key, call)
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        let status = SecItemCopyMatching(request as CFDictionary, &result)
        if status == errSecItemNotFound { return call.resolve(["value": NSNull()]) }
        guard status == errSecSuccess, let data = result as? Data, let value = String(data: data, encoding: .utf8) else {
            return call.reject("Keychain read failed (\(status)).")
        }
        call.resolve(["value": value])
    }

    @objc func set(_ call: CAPPluginCall) {
        guard let key = account(call) else { return }
        guard let value = call.getString("value") else { return call.reject("Missing value.") }
        let data = Data(value.utf8)
        // In place: deleting first and then failing to add lost the code.
        var status = SecItemUpdate(query(key, call) as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var item = query(key, call)
            item[kSecValueData as String] = data
            // Readable after the first unlock, so a sync can run in the background;
            // never restored onto a different device from a backup.
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            status = SecItemAdd(item as CFDictionary, nil)
        }
        guard status == errSecSuccess else { return call.reject("Keychain write failed (\(status)).") }
        call.resolve()
    }

    @objc func remove(_ call: CAPPluginCall) {
        guard let key = account(call) else { return }
        let status = SecItemDelete(query(key, call) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            return call.reject("Keychain delete failed (\(status)).")
        }
        call.resolve()
    }

    // MARK: The vault's passcode, behind Face ID or Touch ID

    private var vaultQuery: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: Self.vaultService, kSecAttrAccount as String: "passcode"]
    }

    @objc func vaultStatus(_ call: CAPPluginCall) {
        let context = LAContext()
        let biometry: String
        if context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil) {
            switch context.biometryType {
            case .faceID: biometry = "faceID"
            case .touchID: biometry = "touchID"
            default:
                if #available(iOS 17, macCatalyst 17, *), context.biometryType == .opticID { biometry = "opticID" } else { biometry = "none" }
            }
        } else {
            biometry = "none"
        }
        call.resolve(["biometry": biometry, "stored": UserDefaults.standard.bool(forKey: Self.vaultKept)])
    }

    @objc func vaultStore(_ call: CAPPluginCall) {
        guard let passcode = call.getString("passcode"), !passcode.isEmpty else { return call.reject("Missing passcode.") }
        // Biometrics alone, not the device passcode, and only those enrolled
        // now: another face or finger added loses it. Never in a backup, never
        // on another device, and gone with the device's own passcode.
        var error: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, .biometryCurrentSet, &error) else {
            return call.reject("Couldn’t protect it with Face ID or Touch ID.")
        }
        SecItemDelete(vaultQuery as CFDictionary)
        var item = vaultQuery
        item[kSecValueData as String] = Data(passcode.utf8)
        item[kSecAttrAccessControl as String] = access
        let status = SecItemAdd(item as CFDictionary, nil)
        guard status == errSecSuccess else { return call.reject("Keychain write failed (\(status)).") }
        UserDefaults.standard.set(true, forKey: Self.vaultKept)
        call.resolve()
    }

    @objc func vaultRecall(_ call: CAPPluginCall) {
        let context = LAContext()
        context.localizedReason = "open the vault"
        var request = vaultQuery
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        request[kSecUseAuthenticationContext as String] = context
        // Waits for Face ID or Touch ID, so not on the main thread.
        DispatchQueue.global(qos: .userInitiated).async {
            var result: AnyObject?
            let status = SecItemCopyMatching(request as CFDictionary, &result)
            if status == errSecItemNotFound {
                // Lost to a face or finger enrolled since: typed again, then kept anew.
                UserDefaults.standard.set(false, forKey: Self.vaultKept)
                return call.reject("Not kept.")
            }
            guard status == errSecSuccess, let data = result as? Data, let passcode = String(data: data, encoding: .utf8) else {
                return call.reject("Not given (\(status)).")
            }
            call.resolve(["passcode": passcode])
        }
    }

    @objc func vaultForget(_ call: CAPPluginCall) {
        SecItemDelete(vaultQuery as CFDictionary)
        UserDefaults.standard.set(false, forKey: Self.vaultKept)
        call.resolve()
    }
}
