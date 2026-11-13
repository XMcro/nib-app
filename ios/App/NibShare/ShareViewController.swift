import ImageIO
import UIKit
import UniformTypeIdentifiers

/// "Nib" in the share sheet: words, a link, pictures and other files. A small
/// sheet to say what it is, and where it goes: a note of its own, or the end
/// of one of the few the app left it (NibInbox `targets`). Save writes it to
/// the inbox (NibInbox.swift), which the app empties next time it opens. It
/// never reads the library, so it works while Nib is locked.
///
/// A picture goes into the note as a picture. Any other file is an
/// attachment, which is part of Nib Plus: the sheet goes by what the app last
/// said of Plus (NibInbox `plus`), and says so of a file it can't take.
///
/// From Safari the page itself comes too, read by Page.js: "Keep" chooses how
/// much of its text is saved with the link, for the app to read into the
/// document. What's selected, for anyone; the article, the part on screen or
/// the whole page, with Plus.
///
/// Nib's own sheet, not the system's compose sheet
/// (SLComposeServiceViewController): on iOS 27 that one is handed a "Save to"
/// row and doesn't draw it.
final class ShareViewController: UINavigationController {
    override func viewDidLoad() {
        super.viewDidLoad()
        setViewControllers([ShareForm()], animated: false)
    }
}

private final class ShareForm: UIViewController, UITextViewDelegate {
    static let newNote = "New note"

    private let targets = NibInbox.targets()
    /// The note or page to add to; nil for a note of its own.
    private var into: NibInbox.Target?
    private var sharedURL: String?
    /// The pictures and files shared, each read into a file of the sheet's own; and how many are still being read.
    private var files: [SharedFile] = []
    private var reading = 0
    /// What Page.js read of the page in Safari, by part (NibInbox `parts`), each as HTML; none from anywhere else.
    private var parts: [String: String] = [:]
    /// The part to keep with the link; nil for the link alone.
    private var keep: String?

    private let text = UITextView()
    private let link = UILabel()
    private let fileList = UIStackView()
    private let keepButton = ShareForm.menuButton(named: "Keep")
    private lazy var keepRow = row("Keep", keepButton)

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Nib"
        view.backgroundColor = .systemBackground
        navigationItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .cancel, target: self, action: #selector(cancel))
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "Save", style: .done, target: self, action: #selector(save))

        text.font = .preferredFont(forTextStyle: .body)
        text.adjustsFontForContentSizeCategory = true
        text.backgroundColor = .clear
        text.textContainerInset = UIEdgeInsets(top: 12, left: 12, bottom: 12, right: 12)
        text.accessibilityLabel = "Add a note"
        text.delegate = self
        // The words take what room the rows under them leave, and never none: left to the stack to choose,
        // an empty row was stretched in their place, and they weren't drawn.
        text.setContentHuggingPriority(.init(1), for: .vertical)
        text.setContentCompressionResistancePriority(.init(1), for: .vertical)
        text.heightAnchor.constraint(greaterThanOrEqualToConstant: 72).isActive = true

        link.font = .preferredFont(forTextStyle: .footnote)
        link.adjustsFontForContentSizeCategory = true
        link.textColor = .secondaryLabel
        link.lineBreakMode = .byTruncatingMiddle
        link.isHidden = true

        fileList.axis = .vertical
        fileList.spacing = 2

        let rows = UIStackView(arrangedSubviews: [text, padded(fileList), padded(link), keepRow])
        keepRow.isHidden = true
        rows.axis = .vertical
        // "Save to", where there's a note to add to: none while Lock Nib is on, or before Nib has been opened.
        if !targets.isEmpty {
            let line = UIView()
            line.backgroundColor = .separator
            line.heightAnchor.constraint(equalToConstant: 1 / UIScreen.main.scale).isActive = true
            rows.addArrangedSubview(line)
            rows.addArrangedSubview(saveToRow())
        }
        rows.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(rows)
        NSLayoutConstraint.activate([
            rows.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            rows.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
            rows.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
            rows.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor)
        ])

        load()
        validate()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        text.becomeFirstResponder()
    }

    func textViewDidChange(_ textView: UITextView) { validate() }

    /// Something to save: words, a link, or a file that can be taken; and nothing still being read.
    private func validate() {
        let words = !text.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        navigationItem.rightBarButtonItem?.isEnabled = reading == 0 && (words || sharedURL != nil || files.contains { $0.refused == nil })
    }

    @objc private func save() {
        do {
            try NibInbox.add(text: text.text ?? "", url: sharedURL, into: into?.id, files: files.filter { $0.refused == nil }.map { (at: $0.at, name: $0.name, type: $0.type) }, page: keep.flatMap { parts[$0] }, part: keep)
            SharedFile.clear()
            extensionContext?.completeRequest(returningItems: [])
        } catch {
            extensionContext?.cancelRequest(withError: error)
        }
    }

    @objc private func cancel() {
        SharedFile.clear()
        extensionContext?.cancelRequest(withError: NSError(domain: NSCocoaErrorDomain, code: NSUserCancelledError))
    }

    /// One read, or not: said in the list, and Save looked at again.
    private func took(_ file: SharedFile?) {
        reading -= 1
        if let file { files.append(file) }
        fileList.arrangedSubviews.forEach { $0.removeFromSuperview() }
        for file in files {
            let line = UILabel()
            line.font = .preferredFont(forTextStyle: .footnote)
            line.adjustsFontForContentSizeCategory = true
            line.textColor = .secondaryLabel
            line.numberOfLines = 0
            line.text = file.refused.map { "\(file.name): \($0)" } ?? "\(file.name) · \(ByteCountFormatter.string(fromByteCount: Int64(file.size), countStyle: .file))"
            fileList.addArrangedSubview(line)
        }
        validate()
    }

    /// What each part of a page is called in "Keep", in the order they're offered; and the one anyone may keep.
    private static let named = [("selection", "Selection"), ("article", "Article"), ("visible", "Part on screen"), ("whole", "Whole page")]
    private static let free = "selection"

    /// "Keep", there once Safari has handed a page over: the link alone, or with it a part of the page there is.
    /// What's selected is kept unless said otherwise; the rest are asked for, and with Plus.
    private func offerParts() {
        keep = parts[Self.free] == nil ? nil : Self.free
        let choose: (String?, String) -> UIAction = { [weak self] part, title in
            let locked = part != nil && part != Self.free && !NibInbox.plus
            return UIAction(title: title, subtitle: locked ? "Nib Plus" : nil, attributes: locked ? [.disabled] : [], state: part == self?.keep ? .on : .off) { _ in self?.keep = part }
        }
        keepButton.menu = UIMenu(children: [choose(nil, "Link only")] + Self.named.filter { parts[$0.0] != nil }.map { choose($0.0, $0.1) })
        keepRow.isHidden = parts.isEmpty
    }

    /// What Page.js read of the page in Safari: its title for the words, where none came, its address, and its parts.
    private func took(page read: [String: Any]) {
        if text.text.isEmpty, let title = read["title"] as? String { text.text = title }
        if sharedURL == nil, let url = NibInbox.validURL(read["url"] as? String) {
            sharedURL = url
            link.text = url
            link.isHidden = false
        }
        // As Page.js names them: the whole body is `html`.
        for (part, key) in [("selection", "selection"), ("article", "article"), ("visible", "visible"), ("whole", "html")] {
            if let html = read[key] as? String, !html.isEmpty, html.utf16.count <= NibInbox.maxPage, sharedURL != nil { parts[part] = html }
        }
        offerParts()
        validate()
    }

    /// "Save to", and a button that says which and opens the list: a note of its own first, then the notes and pages the app left to add to.
    private func saveToRow() -> UIView {
        let choose: (NibInbox.Target?) -> UIAction = { [weak self] target in
            UIAction(title: target?.title ?? Self.newNote, subtitle: target.map { $0.kind == "page" ? "Page" : "Note" }, state: target == nil ? .on : .off) { _ in self?.into = target }
        }
        let button = Self.menuButton(named: "Save to")
        button.menu = UIMenu(children: [choose(nil)] + targets.map { choose($0) })
        return row("Save to", button)
    }

    /// A button that opens a list, reads as what was chosen in it, and has the list tick it.
    private static func menuButton(named name: String) -> UIButton {
        var look = UIButton.Configuration.plain()
        look.titleLineBreakMode = .byTruncatingTail
        look.contentInsets = NSDirectionalEdgeInsets(top: 10, leading: 0, bottom: 10, trailing: 0)
        let button = UIButton(configuration: look)
        button.showsMenuAsPrimaryAction = true
        button.changesSelectionAsPrimaryAction = true
        button.contentHorizontalAlignment = .trailing
        button.accessibilityLabel = name
        return button
    }

    /// What a choice is called, and the button to make it with.
    private func row(_ name: String, _ button: UIButton) -> UIView {
        let label = UILabel()
        label.text = name
        label.font = .preferredFont(forTextStyle: .body)
        label.adjustsFontForContentSizeCategory = true
        label.setContentHuggingPriority(.required, for: .horizontal)
        let row = UIStackView(arrangedSubviews: [label, button])
        row.axis = .horizontal
        row.spacing = 12
        return padded(row)
    }

    private func padded(_ inside: UIView) -> UIView {
        let box = UIStackView(arrangedSubviews: [inside])
        box.isLayoutMarginsRelativeArrangement = true
        box.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16)
        box.setContentHuggingPriority(.required, for: .vertical)
        return box
    }

    /// What was shared: its words (a page's title, a selection, plain text), and the first web link among it, if any.
    private func load() {
        let items = extensionContext?.inputItems as? [NSExtensionItem] ?? []
        text.text = items.compactMap { $0.attributedContentText?.string }.first { !$0.isEmpty } ?? ""
        let providers = items.flatMap { $0.attachments ?? [] }

        if text.text.isEmpty, let words = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) }) {
            words.loadItem(forTypeIdentifier: UTType.plainText.identifier) { [weak self] item, _ in
                guard let shared = item as? String else { return }
                DispatchQueue.main.async {
                    guard let self, self.text.text.isEmpty else { return }
                    self.text.text = shared
                    self.validate()
                }
            }
        }

        if let safari = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.propertyList.identifier) }) {
            safari.loadItem(forTypeIdentifier: UTType.propertyList.identifier) { [weak self] item, _ in
                guard let read = (item as? NSDictionary)?[NSExtensionJavaScriptPreprocessingResultsKey] as? [String: Any] else { return }
                DispatchQueue.main.async { self?.took(page: read) }
            }
        }

        for (provider, kind) in providers.compactMap({ provider in SharedFile.kind(of: provider).map { (provider, $0) } }).prefix(NibInbox.maxFiles) {
            reading += 1
            provider.loadFileRepresentation(forTypeIdentifier: kind.type.identifier) { [weak self] url, _ in
                // The file handed over goes when this returns: kept as the sheet's own first.
                let file = url.flatMap { SharedFile.keep($0, named: provider.suggestedName, as: kind.type, picture: kind.picture) }
                DispatchQueue.main.async { self?.took(file) }
            }
        }

        guard let provider = providers.first(where: { SharedFile.kind(of: $0) == nil && $0.hasItemConformingToTypeIdentifier(UTType.url.identifier) }) else { return }
        provider.loadItem(forTypeIdentifier: UTType.url.identifier) { [weak self] item, _ in
            guard let url = item as? URL, ["http", "https"].contains(url.scheme?.lowercased() ?? "") else { return }
            DispatchQueue.main.async {
                self?.sharedURL = url.absoluteString
                self?.link.text = url.absoluteString
                self?.link.isHidden = false
                self?.validate()
            }
        }
    }
}

/// A picture or another file that was shared, read into a file of the sheet's own.
private struct SharedFile {
    let at: URL
    let name: String
    /// A media type, as "application/pdf".
    let type: String
    let size: Int
    /// Why it can't be taken, as the sheet says it; nil if it can.
    let refused: String?

    /// The kinds of picture Nib keeps in a note (src/lib/image.ts): any other is made a JPEG here.
    private static let kept: [UTType] = [.jpeg, .png, .gif, .webP]
    private static let folder = FileManager.default.temporaryDirectory.appendingPathComponent("nib-share", isDirectory: true)

    static func clear() { try? FileManager.default.removeItem(at: folder) }

    /// What a shared item is to be read as, if it's a picture or a file: not words, and not a link to the web.
    static func kind(of provider: NSItemProvider) -> (type: UTType, picture: Bool)? {
        let types = provider.registeredTypeIdentifiers.compactMap { UTType($0) }
        // What Safari's page script hands over is the page, read elsewhere, not a file.
        if types.contains(where: { $0.conforms(to: .propertyList) }) { return nil }
        if let image = types.first(where: { $0.conforms(to: .image) }) {
            return (kept.first { one in types.contains { $0.conforms(to: one) } } ?? image, true)
        }
        // Handed over as a file, or something that's neither words nor a link.
        guard types.contains(where: { $0.conforms(to: .fileURL) }) || !types.contains(where: { $0.conforms(to: .url) || $0.conforms(to: .text) }) else { return nil }
        return (types.first { $0.conforms(to: .data) && !$0.conforms(to: .url) } ?? .data, false)
    }

    /// Copies what was handed over, under a number, and says what it is. Nil if it can't be read.
    static func keep(_ handed: URL, named: String?, as type: UTType, picture: Bool) -> SharedFile? {
        let files = FileManager.default
        try? files.createDirectory(at: folder, withIntermediateDirectories: true)
        let at = folder.appendingPathComponent(UUID().uuidString)
        // A picture of a kind Nib doesn't keep (an iPhone's HEIC) becomes a JPEG, no bigger than a screen needs many times over.
        let type = picture && !kept.contains(where: { type.conforms(to: $0) }) ? UTType.jpeg : type
        if type == .jpeg, !(UTType(filenameExtension: handed.pathExtension)?.conforms(to: .jpeg) ?? false) {
            guard let source = CGImageSourceCreateWithURL(handed as CFURL, nil),
                  let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: 4096] as CFDictionary),
                  let out = CGImageDestinationCreateWithURL(at as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
            CGImageDestinationAddImage(out, image, [kCGImageDestinationLossyCompressionQuality: 0.9] as CFDictionary)
            guard CGImageDestinationFinalize(out) else { return nil }
        } else {
            guard (try? files.copyItem(at: handed, to: at)) != nil else { return nil }
        }
        guard let size = (try? files.attributesOfItem(atPath: at.path))?[.size] as? Int, size > 0 else { return nil }

        // Called what it was, with the ending its kind has.
        let ending = type.preferredFilenameExtension ?? handed.pathExtension
        let given = (named ?? handed.deletingPathExtension().lastPathComponent)
        let base = UTType(filenameExtension: (given as NSString).pathExtension) == nil ? given : (given as NSString).deletingPathExtension
        let name = ending.isEmpty ? base : "\(base).\(ending)"

        let refused: String? = size > NibInbox.maxFile ? "over 25 MB, the most Nib keeps of one file"
            : !picture && !NibInbox.plus ? "attaching files is part of Nib Plus"
            : nil
        return SharedFile(at: at, name: name, type: type.preferredMIMEType ?? "application/octet-stream", size: size, refused: refused)
    }
}
