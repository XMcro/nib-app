#if !targetEnvironment(macCatalyst)
import AppIntents
import UIKit

/// Shortcuts and Siri. "Add to Nib" writes to the inbox (NibInbox.swift)
/// without opening the app, and so works while Nib is locked, though not on a
/// locked phone; "New Nib note" opens the app on a fresh note. With Nib Plus:
/// "Append to a Nib note", to the inbox too, for a pinned or recent note;
/// "Start a Nib sprint", which opens Nib; and "Today's words in Nib", read
/// from what the app leaves the widgets (NibSnapshot.swift). iPhone and iPad:
/// the Mac has no inbox in this version.

@available(iOS 16, *)
struct AddToNibIntent: AppIntent {
    static var title: LocalizedStringResource = "Add to Nib"
    static var description = IntentDescription("Saves text to Nib as a new note, without opening it.")
    // Not from a locked phone, by whoever is holding it.
    static var authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

    @Parameter(title: "Text")
    var text: String

    func perform() async throws -> some IntentResult & ProvidesDialog {
        try NibInbox.add(text: text)
        return .result(dialog: "Added to Nib.")
    }
}

@available(iOS 16, *)
struct NewNibNoteIntent: AppIntent {
    static var title: LocalizedStringResource = "New Nib note"
    static var description = IntentDescription("Opens Nib on a new note.")
    static var openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        // The same link the widget uses, so the page handles both one way.
        if let url = URL(string: "nib://new-note") { await UIApplication.shared.open(url) }
        return .result()
    }
}

/// Without the snapshot, which the app leaves only with Plus.
@available(iOS 16, *)
enum NibPlusNeeded: Error, CustomLocalizedStringResourceConvertible {
    case plus
    var localizedStringResource: LocalizedStringResource { "This is part of Nib Plus. If you have it, open Nib once, then try again." }
}

@available(iOS 16, *)
struct AppendToNibNoteIntent: AppIntent {
    static var title: LocalizedStringResource = "Append to a Nib note"
    static var description = IntentDescription("Adds text to the end of a pinned or recent note, the next time Nib opens. With Nib Plus.")
    static var authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

    @Parameter(title: "Note", optionsProvider: NibNotesToAddTo())
    var note: NibNote

    @Parameter(title: "Text")
    var text: String

    static var parameterSummary: some ParameterSummary { Summary("Append \(\.$text) to \(\.$note)") }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard NibSnapshot.read() != nil else { throw NibPlusNeeded.plus }
        try NibInbox.add(text: text, into: note.id)
        return .result(dialog: "It’ll be added to “\(note.title)” when Nib next opens.")
    }
}

@available(iOS 16, *)
enum NibSprintLength: Int, AppEnum {
    case fifteen = 15, twentyFive = 25, fortyFive = 45
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Sprint length"
    static var caseDisplayRepresentations: [NibSprintLength: DisplayRepresentation] = [.fifteen: "15 minutes", .twentyFive: "25 minutes", .fortyFive: "45 minutes"]
}

@available(iOS 16, *)
struct StartNibSprintIntent: AppIntent {
    static var title: LocalizedStringResource = "Start a Nib sprint"
    static var description = IntentDescription("Opens Nib and starts a writing sprint. With Nib Plus.")
    static var openAppWhenRun = true

    @Parameter(title: "Length", default: .twentyFive)
    var length: NibSprintLength

    @MainActor
    func perform() async throws -> some IntentResult {
        // The app says whether there's Plus for it (src/lib/useLaunchServices.ts).
        if let url = URL(string: "nib://sprint/\(length.rawValue)") { await UIApplication.shared.open(url) }
        return .result()
    }
}

@available(iOS 16, *)
struct NibTodaysWordsIntent: AppIntent {
    static var title: LocalizedStringResource = "Today’s words in Nib"
    static var description = IntentDescription("How many words you’ve written today, as Nib last saw them when you left it. With Nib Plus.")

    func perform() async throws -> some IntentResult & ReturnsValue<Int> & ProvidesDialog {
        guard let snapshot = NibSnapshot.read() else { throw NibPlusNeeded.plus }
        let words = snapshot.words(on: .now)
        let said = snapshot.goal > 0 ? "\(words.formatted()) of \(snapshot.goal.formatted()) words today." : "\(words.formatted()) words today."
        return .result(value: words, dialog: "\(said)")
    }
}

@available(iOS 16, *)
struct NibShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: AddToNibIntent(), phrases: ["Add to \(.applicationName)"])
        AppShortcut(intent: NewNibNoteIntent(), phrases: ["New note in \(.applicationName)"])
        AppShortcut(intent: AppendToNibNoteIntent(), phrases: ["Append to a note in \(.applicationName)"])
        AppShortcut(intent: StartNibSprintIntent(), phrases: ["Start a sprint in \(.applicationName)"])
        AppShortcut(intent: NibTodaysWordsIntent(), phrases: ["Today’s words in \(.applicationName)", "How many words today in \(.applicationName)"])
    }
}
#endif
