import SwiftUI
import WidgetKit

/// The daily goal as a ring, and its run of days in a row (Nib Plus): on the
/// Home Screen, and on the Lock Screen as a circle or a line. Each reads the
/// snapshot the app leaves as it leaves the front (NibSnapshot.swift), and
/// has an entry for each of the next two midnights, so today's words go back
/// to none, and a run that wasn't kept up ends, without Nib being opened.
/// There's no snapshot without Plus: then each says it's with Plus, and a tap
/// opens the Plus screen (nib://plus). Tapped otherwise, it opens Nib.

struct Day: TimelineEntry {
    let date: Date
    let snapshot: NibSnapshot.Snapshot?
}

struct Today: TimelineProvider {
    /// What the widget gallery shows.
    static let sample = NibSnapshot.Snapshot(day: NibSnapshot.day(of: .now), words: 312, goal: 500, streakDay: NibSnapshot.day(of: .now), streak: 4, books: [], notes: [], locked: false)

    func placeholder(in context: Context) -> Day { Day(date: .now, snapshot: Self.sample) }

    func getSnapshot(in context: Context, completion: @escaping (Day) -> Void) {
        completion(Day(date: .now, snapshot: context.isPreview ? Self.sample : NibSnapshot.read()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<Day>) -> Void) {
        let snapshot = NibSnapshot.read()
        let today = Calendar.current.startOfDay(for: .now)
        let midnights = [1, 2].compactMap { Calendar.current.date(byAdding: .day, value: $0, to: today) }
        // And the moment Nib Plus ends, if that comes first: from then on there's nothing to show (NibSnapshot `until`).
        let ends = snapshot?.ends.flatMap { end in midnights.last.map { end < $0 } == true ? end : nil }
        let moments = (midnights + (ends.map { [$0] } ?? [])).sorted()
        completion(Timeline(entries: [Day(date: .now, snapshot: snapshot)] + moments.map { moment in Day(date: moment, snapshot: ends.map { moment >= $0 } == true ? nil : snapshot) }, policy: .atEnd))
    }
}

/// Without Plus: what the widget is, and that it's with Plus.
struct WithPlus: View {
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
        case .accessoryInline:
            Text("\(title) · Nib Plus")
        default:
            VStack(alignment: .leading, spacing: 6) {
                Image(systemName: symbol).font(.title2)
                Spacer()
                Text(title).font(.headline)
                Text("With Nib Plus").font(.caption).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .modifier(Background())
        }
    }
}

struct GoalView: View {
    let day: Day
    @Environment(\.widgetFamily) private var family

    var body: some View {
        if let snapshot = day.snapshot {
            let words = snapshot.words(on: day.date)
            let goal = snapshot.goal
            let done = goal > 0 ? min(1, Double(words) / Double(goal)) : 0
            switch family {
            case .accessoryCircular:
                if goal > 0 {
                    Gauge(value: done) {
                        Text("Words")
                    } currentValueLabel: {
                        Text(words.formatted(.number.notation(.compactName)))
                    }
                    .gaugeStyle(.accessoryCircularCapacity)
                } else {
                    ZStack {
                        AccessoryWidgetBackground()
                        Text(words.formatted(.number.notation(.compactName))).font(.headline)
                    }
                }
            case .accessoryInline:
                Text(goal > 0 ? "\(words.formatted()) of \(goal.formatted()) words today" : "\(words.formatted()) words today")
            default:
                VStack(spacing: 8) {
                    ZStack {
                        Circle().stroke(.quaternary, lineWidth: 9)
                        Circle()
                            .trim(from: 0, to: done)
                            .stroke(.primary, style: StrokeStyle(lineWidth: 9, lineCap: .round))
                            .rotationEffect(.degrees(-90))
                        VStack(spacing: 0) {
                            Text(words.formatted()).font(.title3.bold()).monospacedDigit().minimumScaleFactor(0.5).lineLimit(1)
                            Text(goal > 0 ? "of \(goal.formatted())" : "words").font(.caption2).foregroundStyle(.secondary)
                        }
                        .padding(.horizontal, 12)
                    }
                    Text(goal == 0 ? "No daily goal set" : words >= goal ? "Today’s goal met" : "Words today")
                        .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .modifier(Background())
            }
        } else {
            WithPlus(title: "Daily goal", symbol: "target").widgetURL(URL(string: "nib://plus"))
        }
    }
}

struct StreakView: View {
    let day: Day
    @Environment(\.widgetFamily) private var family

    var body: some View {
        if let snapshot = day.snapshot {
            let streak = snapshot.streak(on: day.date)
            let days = streak == 1 ? "day in a row" : "days in a row"
            switch family {
            case .accessoryCircular:
                ZStack {
                    AccessoryWidgetBackground()
                    VStack(spacing: 0) {
                        Text(streak.formatted()).font(.title2.bold()).monospacedDigit().minimumScaleFactor(0.5)
                        Text(streak == 1 ? "day" : "days").font(.caption2)
                    }
                }
            case .accessoryInline:
                Label("\(streak.formatted()) \(days)", systemImage: "flame")
            default:
                let words = snapshot.words(on: day.date)
                VStack(alignment: .leading, spacing: 2) {
                    Image(systemName: "flame").font(.title2)
                    Spacer()
                    Text(streak.formatted()).font(.largeTitle.bold()).monospacedDigit().minimumScaleFactor(0.5).lineLimit(1)
                    Text(days).font(.headline)
                    Text(snapshot.goal == 0 ? "No daily goal set" : words >= snapshot.goal ? "Today’s goal met" : "\((snapshot.goal - words).formatted()) words to go today")
                        .font(.caption).foregroundStyle(.secondary).lineLimit(1).minimumScaleFactor(0.8)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                .modifier(Background())
            }
        } else {
            WithPlus(title: "Streak", symbol: "flame").widgetURL(URL(string: "nib://plus"))
        }
    }
}

struct GoalWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "app.nib.goal", provider: Today()) { day in
            GoalView(day: day)
        }
        .configurationDisplayName("Daily goal")
        .description("Today’s words, as a ring around your daily goal. With Nib Plus.")
        .supportedFamilies([.systemSmall, .accessoryCircular, .accessoryInline])
    }
}

struct StreakWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "app.nib.streak", provider: Today()) { day in
            StreakView(day: day)
        }
        .configurationDisplayName("Streak")
        .description("The days in a row you’ve met your daily goal. With Nib Plus.")
        .supportedFamilies([.systemSmall, .accessoryCircular, .accessoryInline])
    }
}
