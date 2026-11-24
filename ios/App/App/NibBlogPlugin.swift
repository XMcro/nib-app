import Foundation
import Capacitor
import Security
import CryptoKit

/// The writer's blog (src/lib/blog.ts): where it is and its key, kept in the
/// Keychain on this device alone, and the requests to it made from here. So
/// the key never reaches the page, the page's content policy never has to let
/// it reach a site of the writer's, and nothing goes through Nib's server.
/// A request reaches only the service's own API on that site.
@objc(NibBlogPlugin)
public class NibBlogPlugin: CAPPlugin, CAPBridgedPlugin, URLSessionTaskDelegate {
    public let identifier = "NibBlogPlugin"
    public let jsName = "NibBlog"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "connect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "blog", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "forget", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise)
    ]

    static let service = "app.nib.ios.blog"
    private static let account = "blog"

    /// Each service, and where its API is under the blog's address.
    private static let apis = ["wordpress": "/wp-json/wp/v2/", "ghost": "/ghost/api/admin/", "microblog": "/micropub"]

    private struct Blog: Codable {
        let service: String
        let site: String
        let user: String?
        let key: String
    }

    /// Cookies and caches kept nowhere, and a redirect followed only on the blog's own host.
    private lazy var session = URLSession(configuration: .ephemeral, delegate: self, delegateQueue: nil)

    @objc func connect(_ call: CAPPluginCall) {
        guard let service = call.getString("service"), Self.apis[service] != nil,
              let given = call.getString("site"), let site = Self.site(given),
              let key = call.getString("key"), !key.isEmpty else {
            // Coded, so the page can tell the writer it's the address.
            return call.reject("Expected a blog: its service, its address and its key.", "address")
        }
        if service == "ghost" && Self.ghostToken(key) == nil {
            return call.reject("Expected an Admin API key.", "key")
        }
        let user = call.getString("user").flatMap { $0.isEmpty ? nil : $0 }
        guard let data = try? JSONEncoder().encode(Blog(service: service, site: site, user: user, key: key)) else {
            return call.reject("Couldn’t keep the blog.")
        }
        let status = Self.store(data)
        guard status == errSecSuccess else { return call.reject("Keychain write failed (\(status)).") }
        call.resolve(["site": site])
    }

    /// The blog, but never its key.
    @objc func blog(_ call: CAPPluginCall) {
        guard let blog = Self.load() else { return call.resolve([:]) }
        var answer: [String: Any] = ["service": blog.service, "site": blog.site]
        if let user = blog.user { answer["user"] = user }
        call.resolve(answer)
    }

    @objc func forget(_ call: CAPPluginCall) {
        let status = SecItemDelete(Self.query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { return call.reject("Keychain delete failed (\(status)).") }
        call.resolve()
    }

    /// `path` under the blog's address, within its API; `json` or `form` a body to send as it is, or `file` (base64)
    /// to upload. Answers the response's status, its body as text, and where it says to look, if it does.
    @objc func request(_ call: CAPPluginCall) {
        guard let blog = Self.load(), let api = Self.apis[blog.service] else { return call.reject("No blog is connected.") }
        let method = call.getString("method") ?? "GET"
        guard ["GET", "POST", "PUT", "DELETE"].contains(method), let path = call.getString("path"), path.hasPrefix(api),
              !path.contains(".."), !path.contains("#"), let url = URL(string: blog.site + path) else {
            return call.reject("That isn’t a request Nib makes.")
        }
        var request = URLRequest(url: url, timeoutInterval: 60)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if blog.service == "wordpress" {
            request.setValue("Basic " + Data("\(blog.user ?? ""):\(blog.key)".utf8).base64EncodedString(), forHTTPHeaderField: "Authorization")
        } else if blog.service == "ghost" {
            guard let token = Self.ghostToken(blog.key) else { return call.reject("That isn’t an Admin API key.") }
            request.setValue("Ghost " + token, forHTTPHeaderField: "Authorization")
            request.setValue("v5.0", forHTTPHeaderField: "Accept-Version")
        } else if blog.service == "microblog" {
            request.setValue("Bearer " + blog.key, forHTTPHeaderField: "Authorization")
        }
        if let json = call.getString("json") {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = Data(json.utf8)
        } else if let form = call.getString("form") {
            request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
            request.httpBody = Data(form.utf8)
        } else if let file = call.getObject("file") {
            guard let data = (file["data"] as? String).flatMap({ Data(base64Encoded: $0) }), let type = file["type"] as? String,
                  type.hasPrefix("image/"), !type.contains("\r"), !type.contains("\n"),
                  let name = (file["name"] as? String).map(Self.fileName), !name.isEmpty else {
                return call.reject("Expected a picture to upload.")
            }
            if blog.service != "wordpress" {
                // Ghost and Micro.blog take it as a form, the file in its `file` field.
                let boundary = "nib-" + UUID().uuidString
                request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
                var body = Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(name)\"\r\nContent-Type: \(type)\r\n\r\n".utf8)
                body.append(data)
                body.append(Data("\r\n--\(boundary)--\r\n".utf8))
                request.httpBody = body
            } else {
                // WordPress takes the file as the body itself, named in its header.
                request.setValue(type, forHTTPHeaderField: "Content-Type")
                request.setValue("attachment; filename=\"\(name)\"", forHTTPHeaderField: "Content-Disposition")
                request.httpBody = data
            }
        }
        session.dataTask(with: request) { data, response, error in
            guard let response = response as? HTTPURLResponse else {
                return call.reject("Couldn’t reach your blog.", nil, error)
            }
            var answer: [String: Any] = ["status": response.statusCode, "body": data.flatMap { String(data: $0, encoding: .utf8) } ?? ""]
            // Micro.blog says where an upload went only here.
            if let location = response.value(forHTTPHeaderField: "Location") { answer["location"] = location }
            call.resolve(answer)
        }.resume()
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                           newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(request.url?.host == task.originalRequest?.url?.host ? request : nil)
    }

    /// The blog's address as Nib keeps it: https, with no query or fragment, and no slash at the end. Plain http only
    /// for this machine, to test with: a key sent over it could be read on the way.
    private static func site(_ given: String) -> String? {
        guard var parts = URLComponents(string: given.trimmingCharacters(in: .whitespacesAndNewlines)), let host = parts.host, !host.isEmpty,
              parts.scheme == "https" || (parts.scheme == "http" && ["localhost", "127.0.0.1"].contains(host)),
              parts.user == nil, parts.password == nil else { return nil }
        parts.query = nil
        parts.fragment = nil
        while parts.path.hasSuffix("/") { parts.path.removeLast() }
        return parts.string
    }

    /// A token for Ghost's Admin API, signed on this device with the key's secret and good for five minutes, as
    /// Ghost asks: the secret itself is never sent. The key is the integration's id and its secret, in hex, with a
    /// colon between.
    private static func ghostToken(_ key: String) -> String? {
        let parts = key.split(separator: ":", omittingEmptySubsequences: false).map(String.init)
        guard parts.count == 2, !parts[0].isEmpty, parts[0].allSatisfy({ $0.isLetter || $0.isNumber }), let secret = hex(parts[1]) else { return nil }
        let now = Int(Date().timeIntervalSince1970)
        guard let header = try? JSONSerialization.data(withJSONObject: ["alg": "HS256", "typ": "JWT", "kid": parts[0]], options: .withoutEscapingSlashes),
              let claims = try? JSONSerialization.data(withJSONObject: ["iat": now, "exp": now + 300, "aud": "/admin/"] as [String: Any], options: .withoutEscapingSlashes) else { return nil }
        let signed = base64URL(header) + "." + base64URL(claims)
        let signature = HMAC<SHA256>.authenticationCode(for: Data(signed.utf8), using: SymmetricKey(data: secret))
        return signed + "." + base64URL(Data(signature))
    }

    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    /// Bytes from hex: nothing if it isn't hex.
    private static func hex(_ text: String) -> Data? {
        guard !text.isEmpty, text.count % 2 == 0 else { return nil }
        var data = Data()
        var at = text.startIndex
        while at < text.endIndex {
            let next = text.index(at, offsetBy: 2)
            guard let byte = UInt8(text[at..<next], radix: 16) else { return nil }
            data.append(byte)
            at = next
        }
        return data
    }

    /// A file's name for its header: letters, digits, dots, dashes and underscores.
    private static func fileName(_ given: String) -> String {
        String(given.unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) || ".-_".unicodeScalars.contains($0) }.prefix(80))
    }

    private static var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    private static func load() -> Blog? {
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(request as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return try? JSONDecoder().decode(Blog.self, from: data)
    }

    private static func store(_ data: Data) -> OSStatus {
        var status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var item = query
            item[kSecValueData as String] = data
            // As the sync code: never restored onto another device from a backup.
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            status = SecItemAdd(item as CFDictionary, nil)
        }
        return status
    }
}
