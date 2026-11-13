import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.nib.ios',
  appName: 'Nib',
  webDir: 'dist',
  // Not the default 'debug': that still logged every plugin result in a Release
  // build — a dismissed share sheet surfaced as console.error — and results can
  // carry the writer's file names. Nib's own errors still reach the console.
  loggingBehavior: 'none',
  // Reminders handle their own notifications (AppDelegate, NibRemindersPlugin):
  // left on, Capacitor takes the delegate and taps on a reminder go nowhere.
  ios: { handleApplicationNotifications: false },
}

export default config
