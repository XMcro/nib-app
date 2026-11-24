import Foundation
import Capacitor
import UIKit
import UniformTypeIdentifiers

/// The writer's backup folder (src/lib/backupFolder.ts): one they chose in the
/// system's picker, on iCloud Drive, Dropbox, a drive or this device, kept as a
/// bookmark on this device alone, so Nib can write to it again on its next day
/// without asking. Nib writes, reads and removes only files under it, by paths
/// it gives, through file coordination, as the folder's own app (iCloud Drive,
/// Dropbox) expects of every app that writes there.
@objc(NibFolderPlugin)
public class NibFolderPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "NibFolderPlugin"
    public let jsName = "NibFolder"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "choose", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "folder", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "forget", returnType: CAPPluginReturnPromise)
    ]

    private static let key = "app.nib.backup-folder"
    /// The picker's call, while it's up: on the main thread.
    private var choosing: CAPPluginCall?
    /// Everything done in the folder, one thing at a time, off the main thread: iCloud Drive can keep a write waiting.
    private let queue = DispatchQueue(label: "app.nib.backup-folder")

    // A sandboxed Mac app keeps its way into a folder across launches only by a bookmark with a security scope.
    #if targetEnvironment(macCatalyst)
    private static let creating: URL.BookmarkCreationOptions = .withSecurityScope
    private static let resolving: URL.BookmarkResolutionOptions = .withSecurityScope
    #else
    private static let creating: URL.BookmarkCreationOptions = []
    private static let resolving: URL.BookmarkResolutionOptions = []
    #endif

    /// The system's folder picker. The folder chosen is kept, in place of any before. Answers its name, or nothing if none was chosen.
    @objc func choose(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.choosing == nil, let shown = self.bridge?.viewController else { return call.reject("Already choosing.") }
            self.choosing = call
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder])
            picker.delegate = self
            picker.allowsMultipleSelection = false
            shown.present(picker, animated: true)
        }
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let call = choosing else { return }
        choosing = nil
        guard let url = urls.first else { return call.resolve([:]) }
        let open = url.startAccessingSecurityScopedResource()
        defer { if open { url.stopAccessingSecurityScopedResource() } }
        do {
            let bookmark = try url.bookmarkData(options: Self.creating, includingResourceValuesForKeys: nil, relativeTo: nil)
            UserDefaults.standard.set(bookmark, forKey: Self.key)
            call.resolve(["name": url.lastPathComponent])
        } catch {
            call.reject("Couldn’t keep that folder.", nil, error)
        }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        choosing?.resolve([:])
        choosing = nil
    }

    /// The folder kept, by its name: nothing if there's none, `lost` if it can't be found (moved off, deleted, a drive taken away).
    @objc func folder(_ call: CAPPluginCall) {
        queue.async {
            guard UserDefaults.standard.data(forKey: Self.key) != nil else { return call.resolve([:]) }
            guard let folder = Self.resolve() else { return call.resolve(["lost": true]) }
            let open = folder.startAccessingSecurityScopedResource()
            defer { if open { folder.stopAccessingSecurityScopedResource() } }
            guard (try? folder.checkResourceIsReachable()) == true else { return call.resolve(["lost": true]) }
            call.resolve(["name": folder.lastPathComponent])
        }
    }

    @objc func forget(_ call: CAPPluginCall) {
        UserDefaults.standard.removeObject(forKey: Self.key)
        call.resolve()
    }

    /// A text file under the folder, by its path there: nothing if there's none.
    @objc func read(_ call: CAPPluginCall) {
        guard let path = call.getString("path"), let parts = Self.parts(path) else { return call.reject("That isn’t a file Nib keeps.") }
        within(call) { folder in
            var text: String?
            var reading: Error?
            var failure: NSError?
            NSFileCoordinator().coordinate(readingItemAt: Self.at(folder, parts), options: [], error: &failure) { url in
                do {
                    text = try String(contentsOf: url, encoding: .utf8)
                } catch let error as CocoaError where error.code == .fileReadNoSuchFile {
                    // None there.
                } catch {
                    reading = error
                }
            }
            if let error = failure ?? reading { throw error }
            call.resolve(text.map { ["data": $0] } ?? [:])
        }
    }

    /// `files` ({ path, data }, text) written under the folder, their folders made, then each of `remove` removed if it's there.
    /// One marked `fresh` is written only if nothing is at its path: those that weren't are answered as `taken`, as
    /// someone else's file is never written over.
    @objc func write(_ call: CAPPluginCall) {
        var files: [(path: String, parts: [String], data: String, fresh: Bool)] = []
        for file in call.getArray("files", JSObject.self) ?? [] {
            guard let path = file["path"] as? String, let parts = Self.parts(path), let data = file["data"] as? String else {
                return call.reject("That isn’t a file Nib keeps.")
            }
            files.append((path, parts, data, file["fresh"] as? Bool ?? false))
        }
        var removing: [[String]] = []
        for path in call.getArray("remove", String.self) ?? [] {
            guard let parts = Self.parts(path) else { return call.reject("That isn’t a file Nib keeps.") }
            removing.append(parts)
        }
        within(call) { folder in
            let coordinator = NSFileCoordinator()
            var taken: [String] = []
            for (path, parts, data, fresh) in files {
                let file = Self.at(folder, parts)
                if fresh && FileManager.default.fileExists(atPath: file.path) {
                    taken.append(path)
                    continue
                }
                try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
                var writing: Error?
                var failure: NSError?
                coordinator.coordinate(writingItemAt: file, options: .forReplacing, error: &failure) { url in
                    do { try Data(data.utf8).write(to: url, options: .atomic) } catch { writing = error }
                }
                if let error = failure ?? writing { throw error }
            }
            for parts in removing {
                var removing: Error?
                var failure: NSError?
                coordinator.coordinate(writingItemAt: Self.at(folder, parts), options: .forDeleting, error: &failure) { url in
                    do {
                        // Only ever a file: Nib writes files, and `removeItem` on a folder takes all that's in it.
                        guard (try? url.resourceValues(forKeys: [.isRegularFileKey]))?.isRegularFile == true else { return }
                        try FileManager.default.removeItem(at: url)
                    } catch let error as CocoaError where error.code == .fileNoSuchFile {
                        // Gone already.
                    } catch {
                        removing = error
                    }
                }
                if let error = failure ?? removing { throw error }
            }
            call.resolve(["taken": taken])
        }
    }

    /// `work` on the folder kept, with the way into it open, on `queue`. Rejected `none` with no folder, `lost` when it
    /// can't be found, and `refused` when it wouldn't take what was asked.
    private func within(_ call: CAPPluginCall, _ work: @escaping (URL) throws -> Void) {
        queue.async {
            guard UserDefaults.standard.data(forKey: Self.key) != nil else { return call.reject("No folder is chosen.", "none") }
            guard let folder = Self.resolve() else { return call.reject("That folder can’t be found.", "lost") }
            let open = folder.startAccessingSecurityScopedResource()
            defer { if open { folder.stopAccessingSecurityScopedResource() } }
            guard (try? folder.checkResourceIsReachable()) == true else { return call.reject("That folder can’t be found.", "lost") }
            do {
                try work(folder)
            } catch {
                call.reject("That folder wouldn’t take it.", "refused", error)
            }
        }
    }

    /// The folder kept, its bookmark made again when the system says it has gone stale (as after the folder moved).
    private static func resolve() -> URL? {
        guard let bookmark = UserDefaults.standard.data(forKey: key) else { return nil }
        var stale = false
        guard let url = try? URL(resolvingBookmarkData: bookmark, options: resolving, relativeTo: nil, bookmarkDataIsStale: &stale) else { return nil }
        if stale {
            let open = url.startAccessingSecurityScopedResource()
            defer { if open { url.stopAccessingSecurityScopedResource() } }
            if let renewed = try? url.bookmarkData(options: creating, includingResourceValuesForKeys: nil, relativeTo: nil) {
                UserDefaults.standard.set(renewed, forKey: key)
            }
        }
        return url
    }

    /// A path under the folder, as its parts: none empty, none hidden, so neither `.` nor `..`, and not too deep.
    private static func parts(_ path: String) -> [String]? {
        let parts = path.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        guard !parts.isEmpty, parts.count <= 16, parts.allSatisfy({ !$0.isEmpty && !$0.hasPrefix(".") && $0.utf8.count <= 255 }) else { return nil }
        return parts
    }

    private static func at(_ folder: URL, _ parts: [String]) -> URL {
        parts.reduce(folder) { $0.appendingPathComponent($1) }
    }
}
