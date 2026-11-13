import Foundation
import Capacitor
import UserNotifications

/// Reminders on a note (src/lib/reminders.ts): a local notification at the
/// time the writer picks. The note keeps the reminder and takes it to the
/// writer's other devices; each device schedules its own here, so nothing
/// rings from a server. It shows the note's title, as the writer chose it,
/// and nothing of what is written below; while Lock Nib is on, only
/// "A reminder", as the notification shows past the lock.
///
/// Tapping one opens Nib at its note (AppDelegate hands the tap over). A tap
/// that launches Nib arrives before the page is listening, so it is held until
/// it is heard; one that arrives before this plugin has loaded waits in
/// `waiting`.
@objc(NibRemindersPlugin)
public class NibRemindersPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NibRemindersPlugin"
    public let jsName = "NibReminders"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "schedule", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise)
    ]

    /// What of a time a repeating reminder matches, by how it repeats. A month with no such date has none.
    static let parts: [String: Set<Calendar.Component>] = [
        "day": [.hour, .minute, .second],
        "week": [.weekday, .hour, .minute, .second],
        "month": [.day, .hour, .minute, .second],
        "year": [.month, .day, .hour, .minute, .second]
    ]

    /// Every request Nib makes is named this plus the note's id, so `list` never sees anyone else's.
    static let prefix = "nib-reminder-"
    /// One snoozed from its notification is named this plus the note's id: it waits beside the note's own.
    static let snoozePrefix = "nib-snooze-"
    /// What a note's reminder can be put off by, from its notification, without opening Nib.
    static let category = "nib-reminder"
    static let snoozeHour = "snooze-hour"
    static let snoozeMorning = "snooze-morning"

    /// Told to the system at launch: the two buttons a note's reminder carries.
    static func offerSnooze() {
        UNUserNotificationCenter.current().setNotificationCategories([
            UNNotificationCategory(identifier: category, actions: [
                UNNotificationAction(identifier: snoozeHour, title: "Remind me in an hour", options: []),
                UNNotificationAction(identifier: snoozeMorning, title: "Remind me tomorrow", options: [])
            ], intentIdentifiers: [], options: [])
        ])
    }

    /// When a snooze button puts it off to: an hour on, or nine tomorrow morning, as the page's quick choices have it. ("Remind me tomorrow morning" took two lines on an iPhone.) Nil for anything else pressed.
    static func snoozeDate(_ action: String, from now: Date = Date()) -> Date? {
        switch action {
        case snoozeHour:
            return now.addingTimeInterval(3600)
        case snoozeMorning:
            let calendar = Calendar.current
            guard let tomorrow = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: now)) else { return nil }
            return calendar.date(bySettingHour: 9, minute: 0, second: 0, of: tomorrow)
        default:
            return nil
        }
    }

    /// Snoozed: what was shown, again at `date`, with the same buttons. One per note: snoozed again, it moves.
    static func snooze(_ shown: UNNotificationContent, itemId: String, until date: Date, done: @escaping () -> Void) {
        guard let content = shown.mutableCopy() as? UNMutableNotificationContent else { return done() }
        let when = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
        let request = UNNotificationRequest(identifier: snoozePrefix + itemId, content: content, trigger: UNCalendarNotificationTrigger(dateMatching: when, repeats: false))
        UNUserNotificationCenter.current().add(request) { _ in done() }
    }
    private static var waiting: String?
    private static weak var loaded: NibRemindersPlugin?

    /// A reminder was tapped: open its note.
    static func opened(itemId: String) {
        DispatchQueue.main.async {
            if let plugin = loaded {
                plugin.notifyListeners("open", data: ["id": itemId], retainUntilConsumed: true)
            } else {
                waiting = itemId
            }
        }
    }

    override public func load() {
        Self.loaded = self
        if let itemId = Self.waiting {
            Self.waiting = nil
            notifyListeners("open", data: ["id": itemId], retainUntilConsumed: true)
        }
    }

    @objc func schedule(_ call: CAPPluginCall) {
        guard let itemId = call.getString("id"), let at = call.getDouble("at") else {
            return call.reject("A reminder needs a note and a time.")
        }
        let date = Date(timeIntervalSince1970: at / 1000)
        guard date > Date() else { return call.reject("That time has passed.", "past") }
        let center = UNUserNotificationCenter.current()
        let title = call.getString("title") ?? ""
        // One of the page's four ways (src/lib/reminders.ts REPEATS), or it doesn't.
        let again = call.getString("repeat").flatMap { Self.parts[$0] == nil ? nil : $0 }
        let add: (Bool) -> Void = { granted in
            guard granted else { return call.reject("Notifications are off for Nib.", "denied") }
            let content = UNMutableNotificationContent()
            content.title = Self.shown(title)
            content.sound = .default
            // A note's can be snoozed; the daily reminder (src/lib/reminders.ts DAILY) is tomorrow's anyway.
            if !itemId.hasPrefix("daily-") { content.categoryIdentifier = Self.category }
            // The title as it was given, whatever is shown, and how it repeats: the page compares them to the note's (`list`).
            content.userInfo = ["itemId": itemId, "title": title, "repeat": again ?? ""]
            // Once, at that moment; or round again at the same hour of every day, that weekday, that date, or that date of that month.
            let when = Calendar.current.dateComponents(Self.parts[again ?? ""] ?? [.year, .month, .day, .hour, .minute, .second], from: date)
            let request = UNNotificationRequest(
                identifier: Self.prefix + itemId,
                content: content,
                trigger: UNCalendarNotificationTrigger(dateMatching: when, repeats: again != nil)
            )
            // The same id replaces an earlier reminder on the same note: one per note. Set anew, it isn't snoozed any more.
            center.removePendingNotificationRequests(withIdentifiers: [Self.snoozePrefix + itemId])
            center.add(request) { error in
                if let error { call.reject("Couldn’t set the reminder.", nil, error) } else { call.resolve() }
            }
        }
        if call.getBool("ask") ?? true {
            // Asked the first time a reminder is set by hand, never before: until then Nib has nothing to say.
            center.requestAuthorization(options: [.alert, .sound]) { granted, _ in add(granted) }
        } else {
            // One that came with a note from another device: only where Nib is already allowed. Never asked for unprompted.
            center.getNotificationSettings { settings in
                add(settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional)
            }
        }
    }

    @objc func cancel(_ call: CAPPluginCall) {
        // The note's own, and one snoozed from it.
        let names = (call.getArray("ids", String.self) ?? []).flatMap { [Self.prefix + $0, Self.snoozePrefix + $0] }
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: names)
        center.removeDeliveredNotifications(withIdentifiers: names)
        call.resolve()
    }

    /// Reschedules reminders still to come under the same names and times with
    /// a new title: those named, or with `nil`, every one of Nib's (Lock Nib
    /// turned on). Only ever to hide a note's title, so those already shown are
    /// taken down: one can't be changed, and would keep the title in
    /// Notification Center.
    static func retitle(_ names: [String]?, as title: String, done: @escaping () -> Void = {}) {
        let center = UNUserNotificationCenter.current()
        center.getDeliveredNotifications { delivered in
            let shown = delivered.map(\.request.identifier).filter { ($0.hasPrefix(prefix) || $0.hasPrefix(snoozePrefix)) && names?.contains($0) != false }
            center.removeDeliveredNotifications(withIdentifiers: shown)
        }
        center.getPendingNotificationRequests { requests in
            for request in requests where (request.identifier.hasPrefix(prefix) || request.identifier.hasPrefix(snoozePrefix)) && names?.contains(request.identifier) != false {
                guard let content = request.content.mutableCopy() as? UNMutableNotificationContent else { continue }
                content.title = shown(title)
                center.add(UNNotificationRequest(identifier: request.identifier, content: content, trigger: request.trigger))
            }
            done()
        }
    }

    /// What a reminder may say: nothing of the note while Lock Nib is on.
    private static func shown(_ title: String) -> String {
        NibLock.shared.enabled ? "A reminder" : title.isEmpty ? "Nib" : title
    }

    /// The reminders still to come, by note: its own, and one snoozed from it (`snoozed`).
    @objc func list(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getPendingNotificationRequests { requests in
            let reminders = requests.compactMap { request -> [String: Any]? in
                let snoozed = request.identifier.hasPrefix(Self.snoozePrefix)
                guard snoozed || request.identifier.hasPrefix(Self.prefix),
                      let date = (request.trigger as? UNCalendarNotificationTrigger)?.nextTriggerDate() else { return nil }
                return [
                    "id": String(request.identifier.dropFirst((snoozed ? Self.snoozePrefix : Self.prefix).count)),
                    "snoozed": snoozed,
                    "at": date.timeIntervalSince1970 * 1000,
                    "title": request.content.userInfo["title"] as? String ?? "",
                    "repeat": snoozed ? "" : request.content.userInfo["repeat"] as? String ?? ""
                ]
            }
            call.resolve(["reminders": reminders])
        }
    }
}
