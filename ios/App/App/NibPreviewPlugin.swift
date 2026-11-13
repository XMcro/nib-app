import Foundation
import Capacitor
import UIKit
import QuickLook
import QuickLookThumbnailing

/// An attached file (src/lib/attachment.ts), opened in the system's own viewer,
/// where it can be read, searched and shared; and a small picture of its first
/// page, for a PDF's card in the note. Both go by a file's name to know what it
/// is, so each is given the copy Nib made to open, under its name
/// (src/lib/files.ts `OPENED`), and nothing else on the device.
@objc(NibPreviewPlugin)
public class NibPreviewPlugin: CAPPlugin, CAPBridgedPlugin, QLPreviewControllerDataSource {
    public let identifier = "NibPreviewPlugin"
    public let jsName = "NibPreview"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "show", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "thumbnail", returnType: CAPPluginReturnPromise)
    ]

    /// The file the viewer has up.
    private var shown: URL?

    @objc func show(_ call: CAPPluginCall) {
        guard let url = Self.opened(call.getString("uri")) else {
            call.reject("Expected a file opened from Nib.")
            return
        }
        DispatchQueue.main.async {
            guard var presenter = self.bridge?.viewController, presenter.view.window != nil else {
                call.reject("Nib is not on screen.")
                return
            }
            // On top of whatever is up already, as the Save dialog goes (NibSavePlugin).
            while let above = presenter.presentedViewController { presenter = above }
            guard !(presenter is QLPreviewController) else {
                call.reject("Already showing a file.")
                return
            }
            self.shown = url
            let viewer = QLPreviewController()
            viewer.dataSource = self
            // Answered once it's up: asked any sooner, neither it nor the one presenting it says so.
            presenter.present(viewer, animated: true) { call.resolve() }
        }
    }

    public func numberOfPreviewItems(in controller: QLPreviewController) -> Int {
        shown == nil ? 0 : 1
    }

    public func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
        (shown ?? URL(fileURLWithPath: "/dev/null")) as NSURL
    }

    /// The file's first page, or whatever the system draws for its kind, as a
    /// PNG no bigger than `edge` points a side.
    @objc func thumbnail(_ call: CAPPluginCall) {
        guard let url = Self.opened(call.getString("uri")) else {
            call.reject("Expected a file opened from Nib.")
            return
        }
        let edge = min(max(call.getDouble("edge") ?? 96, 16), 512)
        DispatchQueue.main.async {
            let scale = self.bridge?.viewController?.view.window?.screen.scale ?? 2
            let request = QLThumbnailGenerator.Request(fileAt: url, size: CGSize(width: edge, height: edge), scale: scale, representationTypes: .thumbnail)
            QLThumbnailGenerator.shared.generateBestRepresentation(for: request) { drawn, _ in
                guard let png = drawn?.uiImage.pngData() else {
                    call.reject("No picture of that file.")
                    return
                }
                call.resolve(["png": png.base64EncodedString()])
            }
        }
    }

    /// Only a copy made to open, in its folder in Caches (src/lib/files.ts):
    /// nothing else on the device is the page's to show.
    private static func opened(_ uri: String?) -> URL? {
        guard let uri = uri, let url = URL(string: uri), url.isFileURL,
              let caches = try? FileManager.default.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: false) else {
            return nil
        }
        let folder = caches.appendingPathComponent("opened", isDirectory: true).standardizedFileURL.resolvingSymlinksInPath().path
        let file = url.standardizedFileURL.resolvingSymlinksInPath()
        return file.path.hasPrefix(folder + "/") ? file : nil
    }
}
