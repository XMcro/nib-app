import Foundation
import Capacitor
import Vision

/// Reads the words in a picture, on this device, for a paste or a drop
/// (src/lib/pictureText.ts). Vision's document reader gives back paragraphs
/// in reading order, with the lines a paragraph wrapped onto joined up again
/// and a word broken at a line's end made whole; a list's items and a
/// table's cells come back a paragraph each. Nothing leaves the device.
///
/// The reader is new in iOS 26 (macOS 26 for the Mac). Before that this finds
/// no words, and the picture goes in as a picture, as it always did.
@objc(NibTextPlugin)
public class NibTextPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NibTextPlugin"
    public let jsName = "NibText"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise)
    ]

    @objc func read(_ call: CAPPluginCall) {
        // A data URL, as the page reads a file: the picture is what follows the comma.
        guard let url = call.getString("image"), let comma = url.firstIndex(of: ","),
              let data = Data(base64Encoded: String(url[url.index(after: comma)...])) else {
            call.reject("Expected a picture.")
            return
        }
        guard #available(iOS 26.0, *) else {
            call.resolve(["paragraphs": []])
            return
        }
        Task {
            do {
                let documents = try await RecognizeDocumentsRequest().perform(on: data)
                call.resolve(["paragraphs": documents.flatMap { $0.document.paragraphs.map(\.transcript) }])
            } catch {
                call.reject("Couldn't read the picture.", nil, error)
            }
        }
    }
}
