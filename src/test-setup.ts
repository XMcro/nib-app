// jsdom implements no layout, so scrolling APIs the components legitimately
// use are simply absent. Stub them rather than guarding real code against a
// browser API that always exists outside the test environment.
if (typeof Element !== 'undefined') {
  Element.prototype.scrollIntoView ??= () => {}
}

// Same reasoning for matchMedia, which the theme effect calls on mount.
if (typeof window !== 'undefined') {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
}
