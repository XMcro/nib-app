// Tries a find pattern on the document's text (src/editor/patternCheck.ts), off
// the thread the writing is on, where a pattern that never ends can be stopped.
// As the search does: every match, block by block.
self.onmessage = ({ data: { source, texts } }) => {
  self.postMessage('started')
  const pattern = new RegExp(source, 'dgiu')
  for (const text of texts) {
    pattern.lastIndex = 0
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      if (match[0] === '') {
        self.postMessage('empty')
        return
      }
    }
  }
  self.postMessage('fine')
}
