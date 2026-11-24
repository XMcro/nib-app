#if !targetEnvironment(macCatalyst)
import AppIntents

/// The books and the notes the widgets and Shortcuts can be pointed at:
/// those in the snapshot the app leaves (NibSnapshot.swift), so the books
/// written in last, and the pinned notes then the ten edited last. None while
/// Lock Nib is on, and none without Plus. Part of the app and the widget
/// extension; iPhone and iPad only, as the snapshot is.

@available(iOS 16, *)
struct NibBook: AppEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Book"
    static var defaultQuery = NibBookQuery()

    /// The folder's whole name.
    let id: String
    let title: String

    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(title)") }
}

@available(iOS 16, *)
struct NibBookQuery: EntityQuery {
    private var all: [NibBook] { (NibSnapshot.read()?.books ?? []).map { NibBook(id: $0.folder, title: $0.title) } }
    func entities(for identifiers: [String]) async throws -> [NibBook] { all.filter { identifiers.contains($0.id) } }
    func suggestedEntities() async throws -> [NibBook] { all }
}

@available(iOS 16, *)
struct NibNote: AppEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Note"
    static var defaultQuery = NibNoteQuery()

    let id: String
    let title: String
    let pinned: Bool

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(title)", image: pinned ? .init(systemName: "pin") : nil)
    }
}

@available(iOS 16, *)
struct NibNoteQuery: EntityQuery {
    private var all: [NibNote] { (NibSnapshot.read()?.notes ?? []).map { NibNote(id: $0.id, title: $0.title, pinned: $0.pinned) } }
    /// One no longer in the snapshot, or any while Lock Nib is on, is still
    /// found, untitled: a shortcut saved with it keeps working, and the app
    /// decides what becomes of it (a note gone takes the text as one of its own).
    func entities(for identifiers: [String]) async throws -> [NibNote] {
        let known = all
        return identifiers.compactMap { id in
            known.first { $0.id == id } ?? (id.range(of: "^[A-Za-z0-9_-]{1,100}$", options: .regularExpression) != nil ? NibNote(id: id, title: "A note", pinned: false) : nil)
        }
    }
    func suggestedEntities() async throws -> [NibNote] { all }
}

/// What Append to a note offers: the same, less those that can't be added to.
@available(iOS 16, *)
struct NibNotesToAddTo: DynamicOptionsProvider {
    func results() async throws -> [NibNote] {
        (NibSnapshot.read()?.notes ?? []).filter { !$0.readOnly }.map { NibNote(id: $0.id, title: $0.title, pinned: $0.pinned) }
    }
}
#endif
