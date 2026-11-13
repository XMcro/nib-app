// What Safari runs in a page being shared to Nib (NSExtensionJavaScriptPreprocessingFile, Info.plist), so the
// share sheet can offer to keep some of it: its title and its address, and as HTML what's selected, the article,
// the part on screen and the whole body, each to be read into a document by the app (src/lib/importApps.ts
// `withWebPage`). Nothing is sent anywhere: Safari hands this to the sheet.
//
// Each is a copy without what isn't its text (scripts, styles, forms, players, pictures, and what the page itself
// marks as hidden), with each link's address made whole. What a page only folds away or hides by its styling is
// kept in the whole page and the article: on a phone that is most of a long article, and losing it unsaid is worse
// than a menu too many. The part on screen is what's drawn there, and nothing folded. A part too long to keep is
// handed over as nothing.
var NibPage = function () {}

/** As many characters of a part's HTML as are handed over (NibInbox.maxPage is the same): a longer one goes as nothing. */
NibPage.LIMIT = 600000
/** What is never read: what runs, what draws, what's filled in, and what the page itself marks as not there. */
NibPage.DROPPED = 'script, style, noscript, template, iframe, svg, canvas, video, audio, object, embed, form, input, button, select, textarea, dialog, img, picture, source, [hidden]:not([hidden="until-found"]), [aria-hidden="true"]'
/** And in an article, what stands beside it. */
NibPage.BESIDE = 'nav, aside, [role="navigation"], [role="complementary"]'

/** A copy of part of the page, its links made whole and what isn't read dropped, as HTML: nothing if there are no words in it, or too many. */
NibPage.cleaned = function (copy, beside) {
  var links = copy.querySelectorAll('a[href]')
  for (var i = 0; i < links.length; i++) links[i].setAttribute('href', links[i].href)
  var dropped = copy.querySelectorAll(beside ? NibPage.DROPPED + ', ' + NibPage.BESIDE : NibPage.DROPPED)
  for (var j = 0; j < dropped.length; j++) dropped[j].remove()
  var html = copy.innerHTML
  return !copy.textContent.trim() || html.length > NibPage.LIMIT ? '' : html
}

/** What's selected in the page, if anything is. Items of one list keep their list. */
NibPage.selection = function (document) {
  var chosen = document.getSelection()
  var held = document.createElement('div')
  for (var i = 0; i < chosen.rangeCount; i++) {
    var range = chosen.getRangeAt(i)
    var within = range.commonAncestorContainer
    var list = within.nodeType === 1 && /^(UL|OL)$/.test(within.tagName) ? held.appendChild(document.createElement(within.tagName)) : held
    list.appendChild(range.cloneContents())
  }
  return NibPage.cleaned(held)
}

/**
 * What a page calls the parts that stand beside its writing, in their class
 * or id: a notice, the comments, what to read next. And what it calls the
 * writing itself, which such a name alongside doesn't take away.
 */
NibPage.ASIDE = /banner|notice|comment|promo|cookie|consent|sidebar|footer|popup|modal|social|share|related|newsletter|subscribe|sponsor|advert/i
NibPage.WRITING = /article|body|content|main/i
NibPage.aside = function (element) {
  var named = element.className + ' ' + element.id
  return NibPage.ASIDE.test(named) && !NibPage.WRITING.test(named)
}

/**
 * The article, as near as can be told. Every paragraph of any length counts
 * toward all that holds it, but for one in a part named as standing beside
 * the writing. If the page names an article that holds a third of them, that
 * is it, whole, its heading with it. Otherwise it's found from the page down:
 * into whichever part holds more than half of them all, for as long as one
 * does. So an article in many sections is kept with all of them, and a
 * notice or the comments beside it are left out.
 */
NibPage.article = function (document) {
  var held = new Map()
  var all = 0
  var paragraphs = document.body.querySelectorAll('p')
  for (var i = 0; i < paragraphs.length; i++) {
    var length = paragraphs[i].textContent.trim().length
    var holders = []
    // Up to the page itself, which is no part of it whatever it's called: a page with a notice showing often says so in its own class.
    for (var holder = paragraphs[i].parentElement; holder !== document.body && !NibPage.aside(holder); holder = holder.parentElement) holders.push(holder)
    // Stopped short of the page: it's in a part beside the writing.
    if (length < 25 || holder !== document.body) continue
    all += length
    for (var h = 0; h < holders.length; h++) held.set(holders[h], (held.get(holders[h]) || 0) + length)
  }
  var most = function (among) {
    var best = null
    for (var j = 0; j < among.length; j++) if ((held.get(among[j]) || 0) > (held.get(best) || 0)) best = among[j]
    return best
  }
  if (!all) return ''
  var article = most(document.body.querySelectorAll('article'))
  if (!article || held.get(article) * 3 < all) {
    article = document.body
    for (var part = most(article.children); part && held.get(part) * 2 > all; part = most(article.children)) article = part
  }
  var copy = article.cloneNode(true)
  var within = copy.querySelectorAll('[class], [id]')
  for (var k = 0; k < within.length; k++) if (NibPage.aside(within[k])) within[k].remove()
  return NibPage.cleaned(copy, true)
}

/** Whether an element holds words of its own, and not only other elements: a paragraph, a heading, an item. */
NibPage.prose = function (element) {
  for (var node = element.firstChild; node; node = node.nextSibling) if (node.nodeType === 3 && node.nodeValue.trim()) return true
  return false
}

/**
 * The part of the page on screen. What holds words of its own is kept whole
 * if any of it is on screen, and left out if none is; what only holds other
 * things is kept for whatever of them is. By where each thing is drawn, not
 * by what holds it: a page's parts are often drawn outside their holders.
 * On screen is having a box with some of it there, up and down and side to
 * side (a menu waits off to one side), within whatever cuts it off (a part
 * folded to no height), and not being hidden, or folded shut where Safari
 * can say (`checkVisibility`, from iOS 17.4).
 */
NibPage.visible = function (document) {
  var view = document.defaultView
  var copy = document.body.cloneNode(true)
  // Whether any of `real` below itself is on screen, which is within `edges`; and, unless it's `whole`, its twin left with only what is.
  var sift = function (real, twin, whole, edges) {
    var any = false
    // From the last, so one taken out doesn't move those still to come.
    for (var i = real.children.length - 1; i >= 0; i--) {
      var child = real.children[i]
      var box = child.getBoundingClientRect()
      var seen = { top: Math.max(box.top, edges.top), bottom: Math.min(box.bottom, edges.bottom), left: Math.max(box.left, edges.left), right: Math.min(box.right, edges.right) }
      // Some of it, and not none: what has no size has none of it anywhere.
      var here = seen.bottom > seen.top && seen.right > seen.left
      if (here && child.checkVisibility) here = child.checkVisibility({ visibilityProperty: true })
      var prose = whole || NibPage.prose(child)
      // What it cuts off at its own edges (a part folded to no height), what it holds is cut off by too.
      var within = view.getComputedStyle(child).overflow === 'visible' ? edges : seen
      if ((here && prose) || sift(child, whole ? null : twin.children[i], prose, within) || here) any = true
      else if (!whole) twin.children[i].remove()
    }
    return any
  }
  sift(document.body, copy, false, { top: 0, bottom: view.innerHeight, left: 0, right: view.innerWidth })
  return NibPage.cleaned(copy)
}

/** One part, or nothing: a page that one way of reading fails on is still read the others. */
NibPage.part = function (read, document) {
  try {
    return read(document)
  } catch {
    return ''
  }
}

NibPage.read = function (document) {
  return {
    title: document.title,
    url: document.URL,
    html: NibPage.part(function () { return NibPage.cleaned(document.body.cloneNode(true)) }),
    selection: NibPage.part(NibPage.selection, document),
    article: NibPage.part(NibPage.article, document),
    visible: NibPage.part(NibPage.visible, document),
  }
}

NibPage.prototype = {
  run: function (given) {
    given.completionFunction(NibPage.read(document))
  },
}

// oxlint-disable-next-line no-unused-vars
var ExtensionPreprocessingJS = new NibPage()
