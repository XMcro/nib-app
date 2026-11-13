import Foundation
import Capacitor

/// Fetches one picture from a web address the writer gives, for "Add a
/// picture from a link" (src/lib/pictureLink.ts). The page can't: its own
/// policy lets it reach Nib's servers and nothing else, and a picture on
/// another site isn't the page's to read.
///
/// Only https, to the end: a redirect to anything else isn't followed.
/// Nothing goes with the request but the address: a session made for this
/// one fetch, which keeps and sends no cookies and caches nothing. Only what
/// the answer says is a picture, and no more than `most` bytes of it, stopped
/// as soon as it runs past that. What comes back is the page's to check
/// again, as it checks a picture pasted in.
@objc(NibPicturePlugin)
public class NibPicturePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NibPicturePlugin"
    public let jsName = "NibPicture"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "fetch", returnType: CAPPluginReturnPromise)
    ]

    /// More than any picture Nib keeps: the page makes a larger one smaller (src/lib/image.ts).
    static let most = 15 * 1024 * 1024

    @objc func fetch(_ call: CAPPluginCall) {
        guard let text = call.getString("url"), let url = URL(string: text),
              url.scheme?.lowercased() == "https", url.host?.isEmpty == false else {
            call.reject("Not an https address.", "address")
            return
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 20
        configuration.timeoutIntervalForResource = 60
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.urlCache = nil
        var request = URLRequest(url: url)
        request.setValue("image/*", forHTTPHeaderField: "Accept")
        // The session holds its delegate until it's done, and is done after this one task.
        let session = URLSession(configuration: configuration, delegate: PictureFetch(call), delegateQueue: nil)
        session.dataTask(with: request).resume()
        session.finishTasksAndInvalidate()
    }
}

/// One fetch: what has arrived, and why it was stopped, if it was. The codes
/// are the page's (src/lib/pictureLink.ts): address, kind, size, failed.
private final class PictureFetch: NSObject, URLSessionDataDelegate {
    private let call: CAPPluginCall
    private var data = Data()
    private var type = ""
    private var refused: (message: String, code: String)?

    init(_ call: CAPPluginCall) {
        self.call = call
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(request.url?.scheme?.lowercased() == "https" ? request : nil)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        type = (response.mimeType ?? "").lowercased()
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            refused = ("The address answered \(http.statusCode).", "failed")
        } else if !type.hasPrefix("image/") {
            refused = ("Not a picture.", "kind")
        } else if response.expectedContentLength > Int64(NibPicturePlugin.most) {
            refused = ("Too large.", "size")
        }
        completionHandler(refused == nil ? .allow : .cancel)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive chunk: Data) {
        data.append(chunk)
        // Whatever length the answer gave, or didn't.
        if data.count > NibPicturePlugin.most {
            refused = ("Too large.", "size")
            dataTask.cancel()
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let refused {
            call.reject(refused.message, refused.code)
        } else if let error {
            call.reject("Couldn't fetch the picture.", "failed", error)
        } else {
            call.resolve(["data": data.base64EncodedString(), "type": type])
        }
    }
}
