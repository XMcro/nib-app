import AVFoundation
import Capacitor
import Foundation

/// Read aloud's voice where the web view has none: the Mac's has no
/// speechSynthesis, while iPhone's and iPad's do and use it
/// (src/lib/readAloud.ts). The system's voice, a sentence at a time, on the
/// device. `speak` answers once the sentence is over: finished, or cut short
/// by `stop`.
///
/// And Nib Plus's audio of a document or a book (src/lib/readAloud.ts): the
/// same voice written to a file instead of spoken, an .m4a in Caches/exports,
/// where the share sheet and the Mac's Save dialog take it from. `record`
/// answers with its place once it's all written, telling "recording" how far
/// it has got on the way; `stopRecording` ends it with nothing kept.
@objc(NibSpeechPlugin)
public class NibSpeechPlugin: CAPPlugin, CAPBridgedPlugin, AVSpeechSynthesizerDelegate {
    public let identifier = "NibSpeechPlugin"
    public let jsName = "NibSpeech"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "record", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopRecording", returnType: CAPPluginReturnPromise)
    ]

    private let synthesizer = AVSpeechSynthesizer()
    /// Each sentence being spoken, and the call waiting for it.
    private var waiting: [ObjectIdentifier: CAPPluginCall] = [:]

    /// What a recording says: a sentence, or a pause in seconds.
    private enum Piece {
        case say(String)
        case pause(Double)
    }

    /// A recording under way: what's left to say, the file it goes into, and the call waiting for it.
    private final class Recording {
        let call: CAPPluginCall
        let url: URL
        let pieces: [Piece]
        let rate: Float
        var next = 0
        var file: AVAudioFile?
        var converter: AVAudioConverter?
        var told = Date.distantPast
        var stopped = false

        init(call: CAPPluginCall, url: URL, pieces: [Piece], rate: Float) {
            self.call = call
            self.url = url
            self.pieces = pieces
            self.rate = rate
        }
    }

    /// Its own voice, so Read aloud can go on with the other. Everything to do with a recording happens on `queue`.
    private let recorder = AVSpeechSynthesizer()
    private let queue = DispatchQueue(label: "app.nib.speech.recording")
    private var recording: Recording?

    public override func load() {
        synthesizer.delegate = self
    }

    @objc func speak(_ call: CAPPluginCall) {
        guard let text = call.getString("text") else { return call.reject("Expected text.") }
        // As the web's speech does: 1 is the voice's own pace.
        let rate = Float(call.getDouble("rate") ?? 1) * AVSpeechUtteranceDefaultSpeechRate
        DispatchQueue.main.async {
            let utterance = AVSpeechUtterance(string: text)
            utterance.rate = min(max(rate, AVSpeechUtteranceMinimumSpeechRate), AVSpeechUtteranceMaximumSpeechRate)
            self.waiting[ObjectIdentifier(utterance)] = call
            self.synthesizer.speak(utterance)
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.synthesizer.stopSpeaking(at: .immediate)
            call.resolve()
        }
    }

    /// `name` an .m4a, `pieces` each { say } or { pause }, `rate` as `speak`'s.
    @objc func record(_ call: CAPPluginCall) {
        guard let given = call.getString("name"), case let name = (given as NSString).lastPathComponent,
              name.hasSuffix(".m4a"), !name.hasPrefix("."), !name.contains("/"),
              let list = call.getArray("pieces", JSObject.self) else {
            return call.reject("Expected something to record.")
        }
        let pieces: [Piece] = list.compactMap { piece in
            if let text = piece["say"] as? String, text.contains(where: { $0.isLetter || $0.isNumber }) { return .say(text) }
            if let seconds = piece["pause"] as? Double, seconds > 0, seconds <= 10 { return .pause(seconds) }
            return nil
        }
        guard pieces.contains(where: { if case .say = $0 { return true } else { return false } }) else {
            return call.reject("Expected something to record.")
        }
        let rate = Float(call.getDouble("rate") ?? 1) * AVSpeechUtteranceDefaultSpeechRate
        queue.async {
            guard self.recording == nil else { return call.reject("Already recording.", "busy") }
            do {
                let folder = try FileManager.default.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
                    .appendingPathComponent("exports", isDirectory: true)
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                let url = folder.appendingPathComponent(name)
                try? FileManager.default.removeItem(at: url)
                let clamped = min(max(rate, AVSpeechUtteranceMinimumSpeechRate), AVSpeechUtteranceMaximumSpeechRate)
                self.recording = Recording(call: call, url: url, pieces: pieces, rate: clamped)
                Self.keepAwake(true)
                self.sayNext()
            } catch {
                call.reject("Couldn’t make the audio.", nil, error)
            }
        }
    }

    @objc func stopRecording(_ call: CAPPluginCall) {
        queue.async {
            if let recording = self.recording {
                recording.stopped = true
                self.recorder.stopSpeaking(at: .immediate)
                self.finish(recording)
            }
            call.resolve()
        }
    }

    /// On `queue`: the pauses up to the next sentence written, and that sentence spoken into the file; or, with
    /// nothing left, the file done.
    private func sayNext() {
        guard let recording, !recording.stopped else { return }
        if Date().timeIntervalSince(recording.told) > 0.5 {
            recording.told = Date()
            notifyListeners("recording", data: ["done": recording.next, "of": recording.pieces.count])
        }
        while recording.next < recording.pieces.count {
            let piece = recording.pieces[recording.next]
            recording.next += 1
            switch piece {
            case .pause(let seconds):
                do { try silence(seconds, in: recording) } catch { return finish(recording, failure: error) }
            case .say(let text):
                let utterance = AVSpeechUtterance(string: text)
                utterance.rate = recording.rate
                recorder.write(utterance) { [weak self] buffer in
                    guard let self, let buffer = buffer as? AVAudioPCMBuffer else { return }
                    self.queue.async {
                        guard self.recording === recording, !recording.stopped else { return }
                        // An empty buffer: the sentence is over.
                        if buffer.frameLength == 0 { return self.sayNext() }
                        do { try self.append(buffer, to: recording) } catch { self.finish(recording, failure: error) }
                    }
                }
                return
            }
        }
        finish(recording)
    }

    /// Into the file, made with the first sentence's sound: AAC, as speech needs it.
    private func append(_ buffer: AVAudioPCMBuffer, to recording: Recording) throws {
        if recording.file == nil {
            let format = buffer.format
            let settings: [String: Any] = [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: format.sampleRate,
                AVNumberOfChannelsKey: format.channelCount,
                AVEncoderBitRateKey: 48_000
            ]
            recording.file = try AVAudioFile(forWriting: recording.url, settings: settings, commonFormat: format.commonFormat, interleaved: format.isInterleaved)
        }
        guard let file = recording.file else { return }
        if buffer.format == file.processingFormat { return try file.write(from: buffer) }
        // Sound unlike the first's, as a sentence in another voice could have: made like it.
        if recording.converter?.inputFormat != buffer.format { recording.converter = AVAudioConverter(from: buffer.format, to: file.processingFormat) }
        guard let converter = recording.converter else { return }
        let frames = AVAudioFrameCount(Double(buffer.frameLength) * file.processingFormat.sampleRate / buffer.format.sampleRate) + 1
        guard let made = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: frames) else { return }
        var given = false
        var failure: NSError?
        converter.convert(to: made, error: &failure) { _, status in
            if given {
                status.pointee = .noDataNow
                return nil
            }
            given = true
            status.pointee = .haveData
            return buffer
        }
        if let failure { throw failure }
        try file.write(from: made)
    }

    /// A pause, as silence. None before the first sentence: there's no file yet, and nothing to pause after.
    private func silence(_ seconds: Double, in recording: Recording) throws {
        guard let file = recording.file else { return }
        let frames = AVAudioFrameCount(seconds * file.processingFormat.sampleRate)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: frames) else { return }
        buffer.frameLength = frames
        // Zeroed: a new buffer's memory isn't.
        let format = buffer.format
        let samples = Int(frames) * (format.isInterleaved ? Int(format.channelCount) : 1)
        for channel in 0..<(format.isInterleaved ? 1 : Int(format.channelCount)) {
            if let data = buffer.floatChannelData?[channel] {
                data.update(repeating: 0, count: samples)
            } else if let data = buffer.int16ChannelData?[channel] {
                data.update(repeating: 0, count: samples)
            } else if let data = buffer.int32ChannelData?[channel] {
                data.update(repeating: 0, count: samples)
            }
        }
        try file.write(from: buffer)
    }

    /// On `queue`: the file closed and handed back, or, stopped or failed, deleted.
    private func finish(_ recording: Recording, failure: Error? = nil) {
        guard self.recording === recording else { return }
        self.recording = nil
        Self.keepAwake(false)
        // Closes it.
        recording.file = nil
        recording.converter = nil
        if recording.stopped || failure != nil || !FileManager.default.fileExists(atPath: recording.url.path) {
            try? FileManager.default.removeItem(at: recording.url)
            if recording.stopped { return recording.call.reject("Stopped.", "stopped") }
            return recording.call.reject("Couldn’t make the audio.", nil, failure)
        }
        notifyListeners("recording", data: ["done": recording.pieces.count, "of": recording.pieces.count])
        recording.call.resolve(["path": recording.url.absoluteString])
    }

    /// The screen kept on while a recording is made: a book takes minutes, and a device that locked itself would
    /// stop making it.
    private static func keepAwake(_ awake: Bool) {
        DispatchQueue.main.async { UIApplication.shared.isIdleTimerDisabled = awake }
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        waiting.removeValue(forKey: ObjectIdentifier(utterance))?.resolve(["finished": true])
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        waiting.removeValue(forKey: ObjectIdentifier(utterance))?.resolve(["finished": false])
    }
}
