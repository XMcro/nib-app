import Foundation
import Capacitor
import UIKit

/// Saves a file where the writer chooses, on the Mac: the Mac's own Save
/// dialog, and then Nib writes the file there itself. Exports there are saved,
/// not shared (see `share` in src/lib/download.ts).
///
/// It was UIKit's export picker, which shows the same dialog but copies the
/// file itself and says only when that worked. On a Mac whose Desktop is in
/// iCloud Drive, macOS refused that copy some 18 seconds after Save and the
/// picker said nothing, so Nib waited behind it for ever with every click lost
/// (seen 2026-11-12). Written here, off the main thread, a refusal comes back
/// as one ("refused", lib/download `SaveRefused`), and Nib is never left
/// waiting.
@objc(NibSavePlugin)
public class NibSavePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NibSavePlugin"
    public let jsName = "NibSave"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise)
    ]

    /// One Save dialog at a time.
    private var saving = false

    @objc func save(_ call: CAPPluginCall) {
        guard let uri = call.getString("uri"), let url = URL(string: uri), url.isFileURL, Self.isExport(url) else {
            call.reject("Expected an export.")
            return
        }
        #if targetEnvironment(macCatalyst)
        DispatchQueue.main.async {
            guard !self.saving else { return call.reject("Already saving.") }
            self.saving = true
            let shown = SavePanel.ask(name: url.lastPathComponent) { place in
                guard let place else {
                    self.saving = false
                    return call.resolve(["saved": false])
                }
                DispatchQueue.global(qos: .userInitiated).async {
                    let failure = Self.write(url, to: place)
                    DispatchQueue.main.async {
                        self.saving = false
                        if let failure {
                            call.reject("Couldn’t save there: \(failure.localizedDescription)", "refused")
                        } else {
                            call.resolve(["saved": true])
                        }
                    }
                }
            }
            if !shown {
                self.saving = false
                call.reject("Couldn’t show the Save dialog.")
            }
        }
        #else
        // On an iPhone or iPad a file goes to the share sheet instead.
        call.reject("Only the Mac saves this way.")
        #endif
    }

    /// Only an export, in its folder in Caches (src/lib/exportFile.ts): nothing
    /// else on the device is the page's to hand over.
    private static func isExport(_ url: URL) -> Bool {
        guard let caches = try? FileManager.default.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: false) else {
            return false
        }
        let folder = caches.appendingPathComponent("exports", isDirectory: true).standardizedFileURL.resolvingSymlinksInPath().path
        return url.standardizedFileURL.resolvingSymlinksInPath().path.hasPrefix(folder + "/")
    }

    /// Writes the export where the writer chose, through a file coordinator, as
    /// iCloud Drive's folders ask. Over a file of that name: the dialog has
    /// already asked whether to replace it. The error, if it wouldn't go.
    private static func write(_ export: URL, to place: URL) -> Error? {
        let scoped = place.startAccessingSecurityScopedResource()
        defer { if scoped { place.stopAccessingSecurityScopedResource() } }
        var coordinating: NSError?
        var writing: Error?
        NSFileCoordinator().coordinate(writingItemAt: place, options: .forReplacing, error: &coordinating) { target in
            do { try Data(contentsOf: export).write(to: target) } catch { writing = error }
        }
        return coordinating ?? writing
    }
}

#if targetEnvironment(macCatalyst)
/// AppKit's Save dialog, which a Mac Catalyst app can reach only by name, at
/// run time. On Nib's window as a sheet, or on its own if none is in front.
/// `done` has the place chosen, or nil when the writer cancels. False if the
/// dialog couldn't be made.
enum SavePanel {
    private typealias Answered = @convention(block) (Int) -> Void
    /// NSModalResponseOK: Save was pressed.
    private static let saved = 1

    static func ask(name: String, done: @escaping (URL?) -> Void) -> Bool {
        guard let kind = NSClassFromString("NSSavePanel") as? NSObject.Type else { return false }
        let panel = kind.init()
        panel.setValue(name, forKey: "nameFieldStringValue")
        panel.setValue(true, forKey: "canCreateDirectories")
        let answered: Answered = { response in done(response == saved ? panel.value(forKey: "URL") as? URL : nil) }
        let app = NSClassFromString("NSApplication")?.value(forKey: "sharedApplication") as? NSObject
        if let window = app?.value(forKey: "keyWindow") as? NSObject {
            let begin = NSSelectorFromString("beginSheetModalForWindow:completionHandler:")
            typealias Begin = @convention(c) (NSObject, Selector, NSObject, Answered) -> Void
            unsafeBitCast(panel.method(for: begin), to: Begin.self)(panel, begin, window, answered)
        } else {
            let begin = NSSelectorFromString("beginWithCompletionHandler:")
            typealias Begin = @convention(c) (NSObject, Selector, Answered) -> Void
            unsafeBitCast(panel.method(for: begin), to: Begin.self)(panel, begin, answered)
        }
        return true
    }
}
#endif
