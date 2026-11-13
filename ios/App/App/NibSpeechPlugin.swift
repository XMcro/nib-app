import AVFoundation
import Capacitor
import Foundation

/// Read aloud's voice where the web view has none: the Mac's has no
/// speechSynthesis, while iPhone's and iPad's do and use it
/// (src/lib/readAloud.ts). The system's voice, a sentence at a time, on the
/// device. `speak` answers once the sentence is over: finished, or cut short
/// by `stop`.
@objc(NibSpeechPlugin)
public class NibSpeechPlugin: CAPPlugin, CAPBridgedPlugin, AVSpeechSynthesizerDelegate {
    public let identifier = "NibSpeechPlugin"
    public let jsName = "NibSpeech"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    private let synthesizer = AVSpeechSynthesizer()
    /// Each sentence being spoken, and the call waiting for it.
    private var waiting: [ObjectIdentifier: CAPPluginCall] = [:]

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

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        waiting.removeValue(forKey: ObjectIdentifier(utterance))?.resolve(["finished": true])
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        waiting.removeValue(forKey: ObjectIdentifier(utterance))?.resolve(["finished": false])
    }
}
