import SwiftUI
import WidgetKit

/// Two Home Screen widgets, "New note" and "New page", and "New note" on the
/// Lock Screen. A small widget is one tap target, so each does one thing.
/// Each opens Nib by link (nib://new-note, nib://new-page); none shows any
/// writing.

struct Moment: TimelineEntry {
    let date: Date
}

/// Nothing changes, so one entry that never needs replacing.
struct Static: TimelineProvider {
    func placeholder(in context: Context) -> Moment { Moment(date: .now) }
    func getSnapshot(in context: Context, completion: @escaping (Moment) -> Void) { completion(Moment(date: .now)) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<Moment>) -> Void) {
        completion(Timeline(entries: [Moment(date: .now)], policy: .never))
    }
}

struct NewView: View {
    let title: String
    let symbol: String
    @Environment(\.widgetFamily) private var family

    var body: some View {
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                Image(systemName: symbol).font(.title3)
            }
            .widgetAccentable()
        default:
            VStack(alignment: .leading, spacing: 6) {
                Image(systemName: symbol).font(.title2)
                Spacer()
                Text(title).font(.headline)
                Text("Nib").font(.caption).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .modifier(Background())
        }
    }
}

/// iOS 17 asks widgets to name their background; iOS 16 has no such call.
struct Background: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 17, *) {
            content.containerBackground(.background, for: .widget)
        } else {
            content.padding()
        }
    }
}

struct NewNoteWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "app.nib.new-note", provider: Static()) { _ in
            NewView(title: "New note", symbol: "square.and.pencil").widgetURL(URL(string: "nib://new-note"))
        }
        .configurationDisplayName("New note")
        .description("Opens Nib on a new note.")
        .supportedFamilies([.systemSmall, .accessoryCircular])
    }
}

struct NewPageWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "app.nib.new-page", provider: Static()) { _ in
            NewView(title: "New page", symbol: "doc.text").widgetURL(URL(string: "nib://new-page"))
        }
        .configurationDisplayName("New page")
        .description("Opens Nib on a new page.")
        .supportedFamilies([.systemSmall])
    }
}

@main
struct NibWidgets: WidgetBundle {
    var body: some Widget {
        NewNoteWidget()
        NewPageWidget()
    }
}
