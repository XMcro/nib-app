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
@objc(NibPdfPlugin)
public class NibPdfPlugin: CAPPlugin, CAPBridgedPlugin, WKNavigationDelegate {
    public let identifier = "NibPdfPlugin"
    public let jsName = "NibPdf"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "render", returnType: CAPPluginReturnPromise)
    ]

    /// Each web view is held until its page has loaded; nothing else keeps it alive.
    private var jobs: [ObjectIdentifier: (view: WKWebView, call: CAPPluginCall, name: String, header: String?)] = [:]

    @objc func render(_ call: CAPPluginCall) {
        // A file's name and nothing more: no folders, and nothing hidden.
        guard let html = call.getString("html"), let given = call.getString("name"),
              case let name = (given as NSString).lastPathComponent, !name.isEmpty, !name.hasPrefix("."), !name.contains("/") else {
            call.reject("Expected html and a file name.")
            return
        }
        let header = call.getString("header")
        DispatchQueue.main.async {
            let paper = Self.paper()
            // Laid out and nothing more: no script runs in it, and nothing it's given outlasts it (the red-team
            // review of 2026-11-17). The page is a document's own text, made into HTML by Nib, with no script in it.
            let configuration = WKWebViewConfiguration()
            configuration.websiteDataStore = .nonPersistent()
            configuration.defaultWebpagePreferences.allowsContentJavaScript = false
            let view = WKWebView(frame: CGRect(origin: .zero, size: paper.size), configuration: configuration)
            view.navigationDelegate = self
            self.jobs[ObjectIdentifier(view)] = (view, call, name, header)
            // No base URL: the page is self-contained, and must not reach anything.
            view.loadHTMLString(html, baseURL: nil)
        }
    }

    /// The page it was given, and nowhere from there: not by a refresh written into it, nor in a frame.
    public func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let given = navigationAction.targetFrame?.isMainFrame == true && navigationAction.request.url?.absoluteString == "about:blank"
        decisionHandler(given ? .allow : .cancel)
    }

    public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
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

        do {
            let directory = try FileManager.default.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
                .appendingPathComponent("exports", isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let file = directory.appendingPathComponent(job.name)
            try data.write(to: file, options: .atomic)
            job.call.resolve(["path": file.absoluteString])
        } catch {
            job.call.reject("Couldn’t write the PDF.", nil, error)
        }
    }

    public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        jobs.removeValue(forKey: ObjectIdentifier(webView))?.call.reject("Couldn’t lay out the PDF.", nil, error)
    }

    public func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        jobs.removeValue(forKey: ObjectIdentifier(webView))?.call.reject("Couldn’t lay out the PDF.", nil, error)
    }

    /// The page's process crashed, or was ended for memory: it will never finish loading.
    public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        jobs.removeValue(forKey: ObjectIdentifier(webView))?.call.reject("Couldn’t lay out the PDF.")
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
