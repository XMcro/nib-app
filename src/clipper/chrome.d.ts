/**
 * The few of the browsers' extension APIs the clipper uses, as Chrome, Edge
 * and Firefox all have them in Manifest V3 (promises, under `chrome`). Written
 * out here rather than taken from a package of types for all of them.
 */
declare namespace chrome {
  namespace runtime {
    const id: string
    type Sender = { id?: string; tab?: { id?: number } }
    function sendMessage(message: unknown): Promise<unknown>
    const onMessage: { addListener(listener: (message: unknown, sender: Sender, respond: (answer: unknown) => void) => boolean | void): void }
  }
  namespace storage {
    const local: { get(key: string): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void>; remove(key: string): Promise<void> }
  }
  namespace tabs {
    type Tab = { id?: number; title?: string; url?: string }
    function query(asked: { active: boolean; currentWindow: boolean }): Promise<Tab[]>
  }
  namespace scripting {
    function executeScript<T>(injected: { target: { tabId: number }; files?: string[]; func?: () => T }): Promise<{ result?: T }[]>
  }
}
