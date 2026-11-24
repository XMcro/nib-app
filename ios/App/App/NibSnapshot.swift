import Foundation

/// What the widgets and Shortcuts read (src/lib/widgets.ts, Nib Plus): a file
/// the app leaves in the App Group each time it leaves the front, since they
/// can't read the library. Today's words with the day they were on, the
/// daily goal and its run of days, the books, and the pinned and recent notes
/// with their first lines. None while there's no Plus.
///
/// While Lock Nib is on it holds no books or notes (NibInboxPlugin.swift),
/// only the day's numbers.
///
/// Part of the app and the widget extension. Absent on the Mac, which has no
/// App Group in this version.
enum NibSnapshot {
    struct Book: Codable {
        /// The folder's whole name, as nib://book/ takes it.
        let folder: String
        let title: String
        let words: Int
        let goal: Int?
        /// `YYYY-MM-DD`.
        let deadline: String?
    }

    struct Note: Codable {
        let id: String
        /// "note" or "page".
        let kind: String
        let title: String
        /// The lines after its title.
        let lines: String
        let pinned: Bool
        let readOnly: Bool
    }

    struct Snapshot: Codable {
        /// The day `words` were written on, `YYYY-MM-DD` in the writer's time zone.
        let day: String
        let words: Int
        /// The daily goal; 0 is none.
        let goal: Int
        /// The last day the daily goal was met, and how many days in a row that made (src/lib/goal.ts).
        let streakDay: String
        let streak: Int
        let books: [Book]
        let notes: [Note]
        /// Lock Nib was on: no books or notes.
        let locked: Bool
        /// When Nib Plus ends as far as the app knew, in milliseconds since 1970, if it knew: past it, this is no
        /// snapshot (`read`). The widgets and Shortcuts are Nib Plus, and the app can't take the file away while it's
        /// shut: without this a pinned note stayed on the Home Screen for as long as Nib wasn't opened again.
        var until: Double? = nil
        var ends: Date? { until.map { Date(timeIntervalSince1970: $0 / 1000) } }

        /// The words written on the day `date` is in: none once the day they were written on is over.
        func words(on date: Date) -> Int { day == NibSnapshot.day(of: date) ? words : 0 }

        /// The run of days the daily goal was met, as it stands on `date`: it
        /// lasts until the end of the day after it was last met (src/lib/goal.ts).
        func streak(on date: Date) -> Int {
            let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: date) ?? date
            return streakDay == NibSnapshot.day(of: date) || streakDay == NibSnapshot.day(of: yesterday) ? streak : 0
        }

        /// The same, with nothing of the library: what's kept while Lock Nib is on.
        var withheld: Snapshot {
            Snapshot(day: day, words: words, goal: goal, streakDay: streakDay, streak: streak, books: [], notes: [], locked: true, until: until)
        }

        /// No more than the widgets show.
        var trimmed: Snapshot {
            Snapshot(
                day: day, words: max(0, words), goal: max(0, goal), streakDay: streakDay, streak: max(0, streak),
                books: books.prefix(20).map { Book(folder: String($0.folder.prefix(600)), title: String($0.title.prefix(120)), words: max(0, $0.words), goal: $0.goal, deadline: $0.deadline) },
                // An id as nib://open/ takes it (src/lib/inbox.ts linkAction).
                notes: notes.prefix(20).filter { $0.id.range(of: "^[A-Za-z0-9_-]{1,100}$", options: .regularExpression) != nil }
                    .map { Note(id: $0.id, kind: $0.kind, title: String($0.title.prefix(120)), lines: String($0.lines.prefix(280)), pinned: $0.pinned, readOnly: $0.readOnly) },
                locked: locked, until: until
            )
        }
    }

    /// `YYYY-MM-DD` in the writer's time zone, as src/lib/time.ts `localDay` writes it.
    static func day(of date: Date) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    private static var file: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.app.nib.ios")?.appendingPathComponent("Widgets.json")
    }

    /// In place of what was there. None leaves no file at all.
    static func write(_ snapshot: Snapshot?) {
        guard let file else { return }
        guard let snapshot, let data = try? JSONEncoder().encode(snapshot.trimmed) else {
            try? FileManager.default.removeItem(at: file)
            return
        }
        try? data.write(to: file, options: .atomic)
    }

    /// What's kept, as it stands at `date`: none once Nib Plus has ended (`until`).
    static func read(at date: Date = .now) -> Snapshot? {
        guard let file, let data = try? Data(contentsOf: file), let snapshot = try? JSONDecoder().decode(Snapshot.self, from: data) else { return nil }
        if let ends = snapshot.ends, date >= ends { return nil }
        return snapshot
    }
}
