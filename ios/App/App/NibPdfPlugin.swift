import CoreText
import Foundation
import Capacitor
import UIKit
import WebKit

/// Prints a page of HTML to a paginated PDF, the way the system's own Print
/// does: an offscreen web view lays it out, and a print renderer cuts it into
/// pages. The file goes to Caches/exports, where the share sheet picks it up,
/// and the page deletes it once it has (src/lib/exportFile.ts). Given a
/// `header`, it's a standard manuscript (src/lib/manuscript.ts): an inch of
/// margin all round, and that running head on each page after the first,
/// with the page's number, the first chapter's page 1.
///
/// `book` prints a book's inside for print on demand (src/lib/printBook.ts):
/// pages of its trim size with mirrored margins, each section on its own
/// pages, opening on the side it asks for, then running heads and numbers.
///
/// `screenplay` draws a screenplay laid out already (src/lib/scriptPages.ts):
/// each line where it's placed on a US Letter page, in Courier 12.
@objc(NibPdfPlugin)
public class NibPdfPlugin: CAPPlugin, CAPBridgedPlugin, WKNavigationDelegate {
    public let identifier = "NibPdfPlugin"
    public let jsName = "NibPdf"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "render", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "book", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "screenplay", returnType: CAPPluginReturnPromise)
    ]

    /// Each web view is held until its page has loaded; nothing else keeps it alive.
    private var jobs: [ObjectIdentifier: (view: WKWebView, call: CAPPluginCall, name: String, header: String?)] = [:]
    /// Each book being printed, under the web view laying out its section now. The book holds that view.
    private var books: [ObjectIdentifier: Book] = [:]

    @objc func render(_ call: CAPPluginCall) {
        guard let html = call.getString("html"), let name = Self.fileName(call) else {
            call.reject("Expected html and a file name.")
            return
        }
        let header = call.getString("header")
        DispatchQueue.main.async {
            let paper = Self.paper()
            let view = WKWebView(frame: CGRect(origin: .zero, size: paper.size), configuration: Self.configuration())
            view.navigationDelegate = self
            self.jobs[ObjectIdentifier(view)] = (view, call, name, header)
            // No base URL: the page is self-contained, and must not reach anything.
            view.loadHTMLString(html, baseURL: nil)
        }
    }

    /// A book's inside (src/lib/printBook.ts), in points: `width` and `height` its trim, its margins `inside` at the spine and
    /// `outside`, `top` and `bottom`. `style` is every section's stylesheet. Each section is `markup`, and the `side` it opens on,
    /// `right` or `left`, after a blank page if it must; one that's `front` has no head or number. Page 1 is the first page of
    /// the first that isn't. `left` and `right` are the running heads on those pages, drawn in `font` (base64, any CoreText reads).
    @objc func book(_ call: CAPPluginCall) {
        let given = call.getArray("sections") ?? []
        let sections = given.compactMap { $0 as? [String: Any] }.compactMap { one -> Book.Section? in
            guard let markup = one["markup"] as? String, let side = one["side"] as? String, side == "right" || side == "left" else { return nil }
            return Book.Section(markup: markup, right: side == "right", front: one["front"] as? Bool ?? false)
        }
        guard let name = Self.fileName(call), let style = call.getString("style"), !sections.isEmpty, sections.count == given.count,
              let width = call.getDouble("width"), let height = call.getDouble("height"),
              let inside = call.getDouble("inside"), let outside = call.getDouble("outside"),
              let top = call.getDouble("top"), let bottom = call.getDouble("bottom"),
              (144...1440).contains(width), (144...1440).contains(height), min(inside, outside, top, bottom) >= 0,
              inside + outside <= width - 72, top + bottom <= height - 72 else {
            call.reject("Expected a book: its size, margins, style and sections, and a file name.")
            return
        }
        let heads = call.getString("left").flatMap { left in call.getString("right").map { (left: left, right: $0) } }
        let face = call.getString("font").flatMap { Data(base64Encoded: $0) }
            .flatMap { (CTFontManagerCreateFontDescriptorsFromData($0 as CFData) as? [CTFontDescriptor])?.first }
        DispatchQueue.main.async {
            let paper = CGRect(x: 0, y: 0, width: width, height: height)
            let text = CGRect(x: inside, y: top, width: width - inside - outside, height: height - top - bottom)
            guard let book = Book(call: call, name: name, paper: paper, text: text, shift: outside - inside, style: style,
                                  sections: sections, heads: heads, face: face) else {
                call.reject("Couldn’t make the PDF.")
                return
            }
            self.load(book)
        }
    }

    /// A screenplay's pages, each a list of lines: `x` and `y` in points from the page's top left, and `runs` of `text`, each
    /// `bold`, `italic` or `underline` or not. Drawn as they are, in Courier 12, black, on US Letter: the grid is the page's.
    @objc func screenplay(_ call: CAPPluginCall) {
        let given = call.getArray("pages") ?? []
        let paper = CGRect(x: 0, y: 0, width: 612, height: 792)
        let pages = given.compactMap { $0 as? [[String: Any]] }.map { page in
            page.compactMap { line -> (point: CGPoint, runs: [[String: Any]])? in
                guard let x = line["x"] as? Double, let y = line["y"] as? Double, let runs = line["runs"] as? [[String: Any]],
                      (0...paper.width).contains(x), (0...paper.height).contains(y), runs.count <= 100 else { return nil }
                return (CGPoint(x: x, y: y), runs)
            }
        }
        guard let name = Self.fileName(call), !pages.isEmpty, pages.count == given.count, pages.count <= 2000, pages.allSatisfy({ $0.count <= 200 }) else {
            call.reject("Expected a screenplay's pages and a file name.")
            return
        }
        func courier(bold: Bool, italic: Bool) -> UIFont {
            let name = bold && italic ? "Courier-BoldOblique" : bold ? "Courier-Bold" : italic ? "Courier-Oblique" : "Courier"
            return UIFont(name: name, size: 12) ?? .monospacedSystemFont(ofSize: 12, weight: bold ? .bold : .regular)
        }
        DispatchQueue.main.async {
            let data = NSMutableData()
            UIGraphicsBeginPDFContextToData(data, paper, nil)
            for page in pages {
                UIGraphicsBeginPDFPage()
                for line in page {
                    var at = line.point
                    for run in line.runs {
                        guard let text = run["text"] as? String, !text.isEmpty, text.count <= 400 else { continue }
                        var attributes: [NSAttributedString.Key: Any] = [.font: courier(bold: run["bold"] as? Bool == true, italic: run["italic"] as? Bool == true), .foregroundColor: UIColor.black]
                        if run["underline"] as? Bool == true { attributes[.underlineStyle] = NSUnderlineStyle.single.rawValue }
                        let drawn = NSAttributedString(string: text, attributes: attributes)
                        drawn.draw(at: at)
                        at.x += drawn.size().width
                    }
                }
            }
            UIGraphicsEndPDFContext()
            Self.save(data as Data, name: name, call: call)
        }
    }

    /// The book's next section, in a web view of its own.
    private func load(_ book: Book) {
        let view = WKWebView(frame: book.paper, configuration: Self.configuration())
        view.navigationDelegate = self
        book.view = view
        books[ObjectIdentifier(view)] = book
        // No base URL, as render's.
        view.loadHTMLString("<!doctype html><html><head><meta charset=\"utf-8\"><style>\(book.style)</style></head><body>\(book.sections[book.next].markup)</body></html>", baseURL: nil)
    }

    /// A section has been laid out: its pages, after a blank one if it must open on the other side; then the next section, or the file.
    private func lay(_ book: Book, from view: WKWebView) {
        let section = book.sections[book.next]
        // The first page is a right-hand one.
        if (book.pages % 2 == 0) != section.right { book.page(head: nil, number: nil, content: nil) }
        if !section.front && book.first == nil { book.first = book.pages }
        let renderer = Sheets(paper: book.paper, text: book.text)
        renderer.addPrintFormatter(view.viewPrintFormatter(), startingAtPageAt: 0)
        renderer.prepare(forDrawingPages: NSRange(location: 0, length: renderer.numberOfPages))
        for index in 0..<renderer.numberOfPages {
            let number = section.front ? nil : book.first.map { book.pages - $0 + 1 }
            // None on a section's first page, nor in the front.
            let head = section.front || index == 0 ? nil : book.pages % 2 == 1 ? book.heads?.left : book.heads?.right
            book.page(head: head, number: number) { renderer.drawPage(at: index, in: book.paper) }
        }
        book.next += 1
        if book.next < book.sections.count {
            load(book)
        } else {
            // A printed book has pages in pairs, back and front: a last one that's blank, if it must.
            if book.pages % 2 == 1 { book.page(head: nil, number: nil, content: nil) }
            book.pdf.closePDF()
            Self.save(book.data as Data, name: book.name, call: book.call)
        }
    }

    /// A book that won't finish: its file is never written.
    private func fail(_ webView: WKWebView, _ error: Error?) -> Bool {
        guard let book = books.removeValue(forKey: ObjectIdentifier(webView)) else { return false }
        book.pdf.closePDF()
        book.call.reject("Couldn’t lay out the PDF.", nil, error)
        return true
    }

    /// The page it was given, and nowhere from there: not by a refresh written into it, nor in a frame.
    public func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let given = navigationAction.targetFrame?.isMainFrame == true && navigationAction.request.url?.absoluteString == "about:blank"
        decisionHandler(given ? .allow : .cancel)
    }

    public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if let book = books.removeValue(forKey: ObjectIdentifier(webView)) { return lay(book, from: webView) }
        guard let job = jobs.removeValue(forKey: ObjectIdentifier(webView)) else { return }
        let paper = Self.paper()
        let renderer = Pages(paper: paper, header: job.header)
        renderer.addPrintFormatter(webView.viewPrintFormatter(), startingAtPageAt: 0)

        let data = NSMutableData()
        UIGraphicsBeginPDFContextToData(data, paper, nil)
        renderer.prepare(forDrawingPages: NSRange(location: 0, length: renderer.numberOfPages))
        for page in 0..<renderer.numberOfPages {
            UIGraphicsBeginPDFPage()
            renderer.drawPage(at: page, in: UIGraphicsGetPDFContextBounds())
        }
        UIGraphicsEndPDFContext()
        Self.save(data as Data, name: job.name, call: job.call)
    }

    /// Into Caches/exports, under its own name, and its place handed back.
    private static func save(_ data: Data, name: String, call: CAPPluginCall) {
        do {
            let directory = try FileManager.default.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
                .appendingPathComponent("exports", isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let file = directory.appendingPathComponent(name)
            try data.write(to: file, options: .atomic)
            call.resolve(["path": file.absoluteString])
        } catch {
            call.reject("Couldn’t write the PDF.", nil, error)
        }
    }

    public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if fail(webView, error) { return }
        jobs.removeValue(forKey: ObjectIdentifier(webView))?.call.reject("Couldn’t lay out the PDF.", nil, error)
    }

    public func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if fail(webView, error) { return }
        jobs.removeValue(forKey: ObjectIdentifier(webView))?.call.reject("Couldn’t lay out the PDF.", nil, error)
    }

    /// The page's process crashed, or was ended for memory: it will never finish loading.
    public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        if fail(webView, nil) { return }
        jobs.removeValue(forKey: ObjectIdentifier(webView))?.call.reject("Couldn’t lay out the PDF.")
    }

    /// A file's name and nothing more: no folders, and nothing hidden.
    private static func fileName(_ call: CAPPluginCall) -> String? {
        guard let given = call.getString("name"), case let name = (given as NSString).lastPathComponent,
              !name.isEmpty, !name.hasPrefix("."), !name.contains("/") else { return nil }
        return name
    }

    /// Laid out and nothing more: no script runs in it, and nothing it's given outlasts it (the red-team
    /// review of 2026-11-17). The page is a document's own text, made into HTML by Nib, with no script in it.
    private static func configuration() -> WKWebViewConfiguration {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false
        return configuration
    }

    /// US Letter where people print on it, A4 everywhere else.
    private static func paper() -> CGRect {
        let region: String?
        if #available(iOS 16, *) { region = Locale.current.region?.identifier } else { region = Locale.current.regionCode }
        let letter = ["US", "CA", "MX", "PH", "CL", "CO", "VE", "PR"].contains(region ?? "")
        return CGRect(x: 0, y: 0, width: letter ? 612 : 595.2, height: letter ? 792 : 841.8)
    }
}

private final class Pages: UIPrintPageRenderer {
    private let paper: CGRect
    private let header: String?

    init(paper: CGRect, header: String?) {
        self.paper = paper
        self.header = header
    }

    override var paperRect: CGRect { paper }
    /// Three-quarters of an inch all round, or for a manuscript an inch.
    override var printableRect: CGRect { paper.insetBy(dx: header == nil ? 54 : 72, dy: header == nil ? 54 : 72) }

    /// The page, then its running head and number, half an inch down at the right, in the text's Times New Roman. None on the first page.
    /// Drawn here, not as the renderer's own header: that one is placed from the page's edge, and the text below it isn't made shorter for it.
    override func drawPage(at pageIndex: Int, in printableRect: CGRect) {
        super.drawPage(at: pageIndex, in: printableRect)
        guard let header, pageIndex > 0 else { return }
        let line = NSMutableParagraphStyle()
        line.alignment = .right
        // A long title gives way in the middle, never the page number.
        line.lineBreakMode = .byTruncatingMiddle
        let font = UIFont(name: "TimesNewRomanPSMT", size: 12) ?? .systemFont(ofSize: 12)
        let place = CGRect(x: paper.minX + 72, y: paper.minY + 36, width: paper.width - 144, height: 24)
        (header + String(pageIndex)).draw(in: place, withAttributes: [.font: font, .paragraphStyle: line, .foregroundColor: UIColor.black])
    }
}

/// A book being printed (NibPdfPlugin `book`): drawn page by page, as each section is laid out, into one PDF.
private final class Book {
    struct Section {
        let markup: String
        let right: Bool
        let front: Bool
    }

    let call: CAPPluginCall
    let name: String
    let paper: CGRect
    /// Where the text goes on a right-hand page. A left-hand page's is moved over by `shift`, so the inside margin is at the spine.
    let text: CGRect
    let shift: CGFloat
    let style: String
    let sections: [Section]
    let heads: (left: String, right: String)?
    let head: UIFont
    let number: UIFont
    let data = NSMutableData()
    let pdf: CGContext
    /// Laying out `sections[next]`.
    var view: WKWebView?
    var next = 0
    /// Pages drawn so far, blank ones too: the first is a right-hand page.
    var pages = 0
    /// Where page 1 is: the first page of the first section that isn't `front`.
    var first: Int?

    init?(call: CAPPluginCall, name: String, paper: CGRect, text: CGRect, shift: CGFloat, style: String, sections: [Section],
          heads: (left: String, right: String)?, face: CTFontDescriptor?) {
        var box = paper
        guard let consumer = CGDataConsumer(data: data as CFMutableData), let pdf = CGContext(consumer: consumer, mediaBox: &box, nil) else { return nil }
        self.call = call
        self.name = name
        self.paper = paper
        self.text = text
        self.shift = shift
        self.style = style
        self.sections = sections
        self.heads = heads
        self.pdf = pdf
        // The book's own face, or a serif every device has.
        func font(_ size: CGFloat) -> UIFont { face.map { CTFontCreateWithFontDescriptor($0, size, nil) as UIFont } ?? UIFont(name: "Georgia", size: size) ?? .systemFont(ofSize: size) }
        head = font(8)
        number = font(9)
    }

    /// The next page: what `content` draws, laid out for a right-hand page, then its running head above the text and its number below,
    /// each in the middle. A left-hand page has it all moved over.
    func page(head: String?, number: Int?, content: (() -> Void)?) {
        pdf.beginPDFPage(nil)
        pdf.saveGState()
        // UIKit's way up, as the print formatter and the strings below expect.
        pdf.translateBy(x: 0, y: paper.height)
        pdf.scaleBy(x: 1, y: -1)
        UIGraphicsPushContext(pdf)
        let left = pages % 2 == 1
        if let content {
            pdf.saveGState()
            if left { pdf.translateBy(x: shift, y: 0) }
            content()
            pdf.restoreGState()
        }
        let block = left ? text.offsetBy(dx: shift, dy: 0) : text
        let middle = NSMutableParagraphStyle()
        middle.alignment = .center
        // A long title gives way in the middle.
        middle.lineBreakMode = .byTruncatingMiddle
        if let head, !head.isEmpty {
            let height = self.head.lineHeight
            head.localizedUppercase.draw(in: CGRect(x: block.minX, y: block.minY - 18 - height, width: block.width, height: height),
                                         withAttributes: [.font: self.head, .kern: 1.2, .paragraphStyle: middle, .foregroundColor: UIColor.black])
        }
        if let number {
            String(number).draw(in: CGRect(x: block.minX, y: block.maxY + 18, width: block.width, height: self.number.lineHeight),
                                withAttributes: [.font: self.number, .paragraphStyle: middle, .foregroundColor: UIColor.black])
        }
        UIGraphicsPopContext()
        pdf.restoreGState()
        pdf.endPDFPage()
        pages += 1
    }
}

/// A book's section cut into pages of its trim, its text where a right-hand page has it. Nothing else: the book draws its heads and numbers.
private final class Sheets: UIPrintPageRenderer {
    private let paper: CGRect
    private let text: CGRect

    init(paper: CGRect, text: CGRect) {
        self.paper = paper
        self.text = text
    }

    override var paperRect: CGRect { paper }
    override var printableRect: CGRect { text }
}
