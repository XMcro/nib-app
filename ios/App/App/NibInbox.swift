import Foundation

/// Quick capture's inbox: one JSON file per capture in the App Group container,
/// shared by the app, the share extension and Shortcuts. They only ever add
/// here, and never read the library, so they work while Nib is locked. The app
/// saves each capture as a note and only then deletes its file
/// (NibInboxPlugin.swift), so a crash between the two never loses one.
///
/// The share sheet can add to a note there already. It can't read the library
/// to offer one, so the app leaves it the few it may (`Targets.json`, beside
/// the inbox): their ids, titles and kinds, and nothing of what's in them.
///
/// Pictures and other files shared with a capture wait in a folder beside its
/// JSON (`<id>.files`), under numbers, with their names in the JSON. The JSON
/// is written last, so the app never reads a capture whose files aren't all
/// there, and both go together once it's saved.
///
/// Part of the app, the share extension and the widget extension.
enum NibInbox {
    static let group = "group.app.nib.ios"

    struct Capture: Codable {
        let id: String
        let text: String
        let url: String?
        /// Milliseconds since 1970, as JavaScript counts them.
        let createdAt: Double
        /// The note or page it's to be added to, one of `targets()`. Absent for a note of its own.
        var into: String?
        /// The pictures and files shared with it, in the order they came.
        var files: [Shared]?
        /// Part of a web page as Safari handed it over (NibShare/Page.js), for the app to read into the document. HTML, and never shown as it is.
        var page: String?
        /// Which part `page` is, one of `parts`: the app keeps a selection for anyone, and the rest with Nib Plus.
        var part: String?
    }

    /// As much of a page as is kept: the same as Page.js hands over at most.
    static let maxPage = 600_000
    /// The parts of a page the sheet can keep: what's selected, the article, the part on screen, all of it.
    static let parts = ["selection", "article", "visible", "whole"]

    /// A file shared with a capture: what it was called and what it is. Where it waits is `files(of:)`.
    struct Shared: Codable {
        let name: String
        /// A media type, as "image/jpeg".
        let type: String
        let size: Int
    }

    /// As many as one capture carries, and as big as one may be (src/lib/fileRef.ts `MAX_FILE`).
    static let maxFiles = 10
    static let maxFile = 25 * 1024 * 1024

    /// A note or a page the share sheet may offer to add to.
    struct Target: Codable {
        let id: String
        let title: String
        /// "note" or "page".
        let kind: String
    }

    static let maxTargets = 10

    enum Failure: Error { case unavailable, empty }

    /// Whether Nib Plus is on, as the app last said: the share sheet, which can't ask the App Store, goes by it
    /// for what it may take (a file that isn't a picture is an attachment, which is Plus).
    static var plus: Bool {
        get { UserDefaults(suiteName: group)?.bool(forKey: "plus") ?? false }
        set { UserDefaults(suiteName: group)?.set(newValue, forKey: "plus") }
    }

    private static func filesFolder(_ id: String) -> URL? { folder?.appendingPathComponent("\(id).files", isDirectory: true) }

    /// A capture's files that are there to be had: each as it's to be shown, and where it waits.
    static func files(of capture: Capture) -> [(shared: Shared, at: URL)] {
        guard validId(capture.id), let kept = filesFolder(capture.id) else { return [] }
        return (capture.files ?? []).prefix(maxFiles).enumerated().compactMap { index, shared in
            let at = kept.appendingPathComponent(String(index))
            guard let one = valid(shared), FileManager.default.fileExists(atPath: at.path) else { return nil }
            return (one, at)
        }
    }

    /// A name of one line and no folders, and a media type that is one.
    private static let typePattern = try! NSRegularExpression(pattern: "^[a-z0-9][a-z0-9!#$&^_.+-]{0,62}/[a-z0-9][a-z0-9!#$&^_.+-]{0,62}$", options: .caseInsensitive)
    private static func valid(_ shared: Shared) -> Shared? {
        let name = String((shared.name.components(separatedBy: CharacterSet(charactersIn: "/\\")).last ?? "").components(separatedBy: .controlCharacters).joined().prefix(255))
        guard !name.isEmpty, shared.size > 0, shared.size <= maxFile,
              typePattern.firstMatch(in: shared.type, range: NSRange(shared.type.startIndex..., in: shared.type)) != nil else { return nil }
        return Shared(name: name, type: shared.type, size: shared.size)
    }

    /// Absent on the Mac, which has no App Group in this version.
    static var folder: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)?
            .appendingPathComponent("Inbox", isDirectory: true)
    }

    /// A capture's file name is its id, so nothing else may be one.
    private static let idPattern = try! NSRegularExpression(pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")

    static func validId(_ id: String) -> Bool {
        idPattern.firstMatch(in: id, range: NSRange(id.startIndex..., in: id)) != nil
    }

    /// Only links Nib would make itself.
    static func validURL(_ url: String?) -> String? {
        guard let url, url.count <= 2048, let parsed = URL(string: url), ["http", "https"].contains(parsed.scheme?.lowercased() ?? "") else { return nil }
        return url
    }

    /// Adds one capture. Written to a temporary file and renamed, so the app
    /// never reads half of one.
    /// `files`: each where it is now, to be copied in, with its name and media type.
    @discardableResult
    static func add(text: String, url: String? = nil, into: String? = nil, files: [(at: URL, name: String, type: String)] = [], page: String? = nil, part: String? = nil) throws -> Capture {
        let text = String(text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(100_000))
        let url = validURL(url)
        guard !text.isEmpty || url != nil || !files.isEmpty else { throw Failure.empty }
        guard let folder else { throw Failure.unavailable }
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let id = UUID().uuidString.lowercased()
        var shared: [Shared] = []
        if !files.isEmpty, let kept = filesFolder(id) {
            do {
                try FileManager.default.createDirectory(at: kept, withIntermediateDirectories: true)
                for file in files.prefix(maxFiles) {
                    let size = (try FileManager.default.attributesOfItem(atPath: file.at.path)[.size] as? Int) ?? 0
                    guard let one = valid(Shared(name: file.name, type: file.type, size: size)) else { continue }
                    try FileManager.default.copyItem(at: file.at, to: kept.appendingPathComponent(String(shared.count)))
                    shared.append(one)
                }
            } catch {
                // Half of them is none of them: nothing names what was copied, so it goes.
                try? FileManager.default.removeItem(at: kept)
                throw error
            }
        }
        // A page goes with its address, and as a part there is, or not at all: it's that page's words.
        let part = part.flatMap { parts.contains($0) ? $0 : nil }
        let page = page.flatMap { url != nil && part != nil && !$0.isEmpty && $0.utf16.count <= maxPage ? $0 : nil }
        let capture = Capture(id: id, text: text, url: url, createdAt: (Date().timeIntervalSince1970 * 1000).rounded(), into: into.flatMap { validId($0) ? $0 : nil }, files: shared.isEmpty ? nil : shared, page: page, part: page == nil ? nil : part)
        try JSONEncoder().encode(capture).write(to: folder.appendingPathComponent("\(capture.id).json"), options: .atomic)
        return capture
    }

    /// Everything waiting, oldest first. A file that cannot be read is left
    /// where it is rather than deleted: it is someone's writing.
    static func list() -> [Capture] {
        guard let folder, let names = try? FileManager.default.contentsOfDirectory(atPath: folder.path) else { return [] }
        return names
            .filter { $0.hasSuffix(".json") }
            .compactMap { name -> Capture? in
                guard let data = try? Data(contentsOf: folder.appendingPathComponent(name)),
                      let capture = try? JSONDecoder().decode(Capture.self, from: data),
                      validId(capture.id), name == "\(capture.id).json" else { return nil }
                return Capture(id: capture.id, text: capture.text, url: validURL(capture.url), createdAt: capture.createdAt, into: capture.into.flatMap { validId($0) ? $0 : nil }, files: capture.files, page: capture.page.flatMap { $0.utf16.count <= maxPage ? $0 : nil }, part: capture.part.flatMap { parts.contains($0) ? $0 : nil })
            }
            .sorted { $0.createdAt < $1.createdAt }
    }

    private static var targetsFile: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)?.appendingPathComponent("Targets.json")
    }

    /// Only what the share sheet shows: an id, a title of a line, a kind.
    private static func valid(_ targets: [Target]) -> [Target] {
        targets
            .filter { validId($0.id) && ["note", "page"].contains($0.kind) }
            .map { Target(id: $0.id, title: String($0.title.replacingOccurrences(of: "\n", with: " ").prefix(120)), kind: $0.kind) }
            .filter { !$0.title.trimmingCharacters(in: .whitespaces).isEmpty }
            .prefix(maxTargets)
            .map { $0 }
    }

    /// What the share sheet may offer, in place of what it had. None leaves no file at all.
    static func setTargets(_ targets: [Target]) {
        guard let file = targetsFile else { return }
        let kept = valid(targets)
        guard !kept.isEmpty, let data = try? JSONEncoder().encode(kept) else {
            try? FileManager.default.removeItem(at: file)
            return
        }
        try? data.write(to: file, options: .atomic)
    }

    static func targets() -> [Target] {
        guard let file = targetsFile, let data = try? Data(contentsOf: file), let read = try? JSONDecoder().decode([Target].self, from: data) else { return [] }
        return valid(read)
    }

    /// Deletes captures the app has saved.
    static func remove(_ ids: [String]) {
        guard let folder else { return }
        for id in ids where validId(id) {
            try? FileManager.default.removeItem(at: folder.appendingPathComponent("\(id).json"))
            if let files = filesFolder(id) { try? FileManager.default.removeItem(at: files) }
        }
    }
}
