#if !targetEnvironment(macCatalyst)
import AppIntents
import UIKit

/// Shortcuts and Siri. "Add to Nib" writes to the inbox (NibInbox.swift)
/// without opening the app, and so works while Nib is locked, though not on a
/// locked phone; "New Nib note" opens the app on a fresh note. iPhone and iPad: the Mac has no inbox in this
/// version.

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

@available(iOS 16, *)
struct NibShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: AddToNibIntent(), phrases: ["Add to \(.applicationName)"])
        AppShortcut(intent: NewNibNoteIntent(), phrases: ["New note in \(.applicationName)"])
    }
}
#endif
