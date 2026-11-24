import Foundation
import Capacitor
import Vision
import CoreText

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
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "warm", returnType: CAPPluginReturnPromise)
    ]

    /// Vision makes its document reader ready the first time an app uses it:
    /// about 24 seconds on a Mac, then a fifth of a second a picture, kept
    /// between launches until the system is updated. Asked for once a launch,
    /// a little after it (src/lib/pictureText.ts warmUp), so the first picture
    /// pasted doesn't wait: a few words drawn and read, at background
    /// priority. A blank picture readies only half of it (12 s of the 24).
    @objc func warm(_ call: CAPPluginCall) {
        guard #available(iOS 26.0, *) else {
            call.resolve()
            return
        }
        Task.detached(priority: .background) {
            if let image = Self.words() { _ = try? await RecognizeDocumentsRequest().perform(on: image) }
            call.resolve()
        }
    }

    /// "Words to read", black on white.
    private static func words() -> CGImage? {
        guard let context = CGContext(data: nil, width: 480, height: 120, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue),
              let font = CTFontCreateUIFontForLanguage(.system, 40, nil) else { return nil }
        context.setFillColor(gray: 1, alpha: 1)
        context.fill(CGRect(x: 0, y: 0, width: 480, height: 120))
        let line = NSAttributedString(string: "Words to read", attributes: [NSAttributedString.Key(kCTFontAttributeName as String): font, NSAttributedString.Key(kCTForegroundColorAttributeName as String): CGColor(gray: 0, alpha: 1)])
        context.textPosition = CGPoint(x: 24, y: 44)
        CTLineDraw(CTLineCreateWithAttributedString(line), context)
        return context.makeImage()
    }

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
