import AppIntents
import SwiftUI
import WidgetKit

/// A book's progress, and a pinned note (Nib Plus), each on the Home Screen,
/// small or medium. Which book or note is chosen with Edit Widget, from those
/// in the snapshot (NibEntities.swift); until one is, or once the one chosen
/// is gone, the first: the book written in last, the note pinned last. iOS 17
/// and later: choosing needs it, and a widget bundle can't offer iOS 16 one
/// in its place. A tap opens the book in Nib (nib://book/) or the note
/// (nib://open/).
///
/// Their words are kept from a locked phone's Lock Screen and StandBy
/// (`privacySensitive`), and there are none while Lock Nib is on: the snapshot
/// has no books or notes then.

struct Pick: TimelineEntry {
    let date: Date
    let snapshot: NibSnapshot.Snapshot?
    /// The book's folder or the note's id chosen in Edit Widget, if one was.
    let chosen: String?
}

/// What the widget gallery shows.
private let sample = NibSnapshot.Snapshot(
    day: "", words: 0, goal: 0, streakDay: "", streak: 0,
    books: [NibSnapshot.Book(folder: "", title: "The Lighthouse Keeper", words: 41_200, goal: 80_000, deadline: nil)],
    notes: [NibSnapshot.Note(id: "", kind: "note", title: "The Lighthouse Keeper", lines: "Every evening at six, Mara climbed the ninety-one steps with a tin of oil and a notebook.\nThe light did not need her.", pinned: true, readOnly: false)],
    locked: false
)

@available(iOS 17, *)
struct ChooseBook: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Choose a book"
    static var description = IntentDescription("The book this widget shows.")
    @Parameter(title: "Book") var book: NibBook?
}

@available(iOS 17, *)
struct ChooseNote: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Choose a note"
    static var description = IntentDescription("The note this widget shows.")
    @Parameter(title: "Note") var note: NibNote?
}

@available(iOS 17, *)
struct ChosenBook: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> Pick { Pick(date: .now, snapshot: sample, chosen: nil) }
    func snapshot(for configuration: ChooseBook, in context: Context) async -> Pick {
        Pick(date: .now, snapshot: context.isPreview ? sample : NibSnapshot.read(), chosen: configuration.book?.id)
    }
    func timeline(for configuration: ChooseBook, in context: Context) async -> Timeline<Pick> {
        let snapshot = NibSnapshot.read()
        // Looked at again when Nib Plus ends, to show nothing of the library from then (NibSnapshot `until`).
        return Timeline(entries: [Pick(date: .now, snapshot: snapshot, chosen: configuration.book?.id)], policy: snapshot?.ends.map { .after($0) } ?? .never)
    }
}

@available(iOS 17, *)
struct ChosenNote: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> Pick { Pick(date: .now, snapshot: sample, chosen: nil) }
    func snapshot(for configuration: ChooseNote, in context: Context) async -> Pick {
        Pick(date: .now, snapshot: context.isPreview ? sample : NibSnapshot.read(), chosen: configuration.note?.id)
    }
    func timeline(for configuration: ChooseNote, in context: Context) async -> Timeline<Pick> {
        let snapshot = NibSnapshot.read()
        return Timeline(entries: [Pick(date: .now, snapshot: snapshot, chosen: configuration.note?.id)], policy: snapshot?.ends.map { .after($0) } ?? .never)
    }
}

/// When there's nothing of the library to show: why, and what a tap does.
struct Nothing: View {
    let symbol: String
    let title: String
    let saying: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: symbol).font(.title2)
            Spacer()
            Text(title).font(.headline)
            Text(saying).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .modifier(Background())
    }
}

/// A book's folder as nib://book/ takes it: every character but letters and digits encoded.
private func bookLink(_ folder: String) -> URL? {
    let plain = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.~")
    return folder.addingPercentEncoding(withAllowedCharacters: plain).flatMap { URL(string: "nib://book/\($0)") }
}

struct BookView: View {
    let pick: Pick
    @Environment(\.widgetFamily) private var family

    var body: some View {
        if let snapshot = pick.snapshot {
            if let book = snapshot.books.first(where: { $0.folder == pick.chosen }) ?? snapshot.books.first {
                let done = book.goal.map { min(1, Double(book.words) / Double(max(1, $0))) }
                VStack(alignment: .leading, spacing: 4) {
                    Image(systemName: "book.closed").font(.title3)
                    Spacer()
                    Text(book.title).font(.headline).lineLimit(family == .systemSmall ? 2 : 1).privacySensitive()
                    if let goal = book.goal, let done {
                        Text("\(book.words.formatted()) of \(goal.formatted()) words").font(.caption).foregroundStyle(.secondary).lineLimit(1).minimumScaleFactor(0.8)
                        ProgressView(value: done).tint(.primary)
                        if family != .systemSmall {
                            Text(book.words >= goal ? "Goal met" : "\((goal - book.words).formatted()) to go\(deadline(book.deadline))")
                                .font(.caption2).foregroundStyle(.secondary)
                        }
                    } else {
                        Text("\(book.words.formatted()) words").font(.caption).foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                .modifier(Background())
                .widgetURL(bookLink(book.folder))
            } else if snapshot.locked {
                Nothing(symbol: "lock", title: "Book", saying: "Lock Nib is on")
            } else {
                Nothing(symbol: "book.closed", title: "Book", saying: "A folder of pages in Nib")
            }
        } else {
            WithPlus(title: "Book", symbol: "book.closed").widgetURL(URL(string: "nib://plus"))
        }
    }

    /// " by Mar 1", with the year only when it isn't this one.
    private func deadline(_ day: String?) -> String {
        guard let day else { return "" }
        let read = DateFormatter()
        read.locale = Locale(identifier: "en_US_POSIX")
        read.dateFormat = "yyyy-MM-dd"
        guard let date = read.date(from: day) else { return "" }
        let sameYear = Calendar.current.isDate(date, equalTo: .now, toGranularity: .year)
        return " by " + date.formatted(sameYear ? .dateTime.month(.abbreviated).day() : .dateTime.month(.abbreviated).day().year())
    }
}

struct NoteView: View {
    let pick: Pick
    @Environment(\.widgetFamily) private var family

    var body: some View {
        if let snapshot = pick.snapshot {
            if let note = snapshot.notes.first(where: { $0.id == pick.chosen }) ?? snapshot.notes.first {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(note.title).font(.headline).lineLimit(2)
                        Spacer(minLength: 0)
                        if note.pinned { Image(systemName: "pin").font(.caption).foregroundStyle(.secondary) }
                    }
                    Text(note.lines).font(.caption).foregroundStyle(.secondary).lineLimit(family == .systemSmall ? 5 : 4)
                    Spacer(minLength: 0)
                }
                .privacySensitive()
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .modifier(Background())
                .widgetURL(URL(string: "nib://open/\(note.id)"))
            } else if snapshot.locked {
                Nothing(symbol: "lock", title: "Note", saying: "Lock Nib is on")
            } else {
                Nothing(symbol: "pin", title: "Note", saying: "Pin a note in Nib")
            }
        } else {
            WithPlus(title: "Pinned note", symbol: "pin").widgetURL(URL(string: "nib://plus"))
        }
    }
}

private let bookDescription = "A book’s words, against its goal if it has one. With Nib Plus."
private let noteDescription = "A pinned note’s title and first lines, or those of another note you choose. With Nib Plus."

@available(iOS 17, *)
struct BookWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "app.nib.book", intent: ChooseBook.self, provider: ChosenBook()) { pick in
            BookView(pick: pick)
        }
        .configurationDisplayName("Book")
        .description(bookDescription)
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

@available(iOS 17, *)
struct NoteWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "app.nib.note", intent: ChooseNote.self, provider: ChosenNote()) { pick in
            NoteView(pick: pick)
        }
        .configurationDisplayName("Pinned note")
        .description(noteDescription)
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
