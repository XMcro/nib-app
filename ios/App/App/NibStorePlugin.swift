import Foundation
import Capacitor
import StoreKit

/// Nib Plus through the App Store (StoreKit 2). The web side lives in
/// src/lib/plus.ts; this file only speaks to Apple and reports back.
@objc(NibStorePlugin)
public class NibStorePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NibStorePlugin"
    public let jsName = "NibStore"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "products", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "entitlement", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "manage", returnType: CAPPluginReturnPromise)
    ]

    /// Permanent once the products exist in App Store Connect.
    static let productIDs = ["app.nib.plus.monthly", "app.nib.plus.yearly"]

    private var updates: Task<Void, Never>?

    override public func load() {
        // Renewals, refunds, and purchases approved later (Ask to Buy) arrive
        // here rather than from purchase(), so Apple asks for this from launch.
        updates = Task.detached { [weak self] in
            for await result in Transaction.updates {
                if case .verified(let transaction) = result { await transaction.finish() }
                let state = await NibStorePlugin.currentEntitlement()
                self?.notifyListeners("entitlementChanged", data: state)
                self?.learnRenewal()
            }
        }
    }

    deinit { updates?.cancel() }

    @objc func products(_ call: CAPPluginCall) {
        Task {
            do {
                let products = try await Product.products(for: Self.productIDs)
                var described: [[String: Any]] = []
                for product in products.sorted(by: { $0.price < $1.price }) { described.append(await Self.describe(product)) }
                call.resolve(["products": described])
            } catch {
                call.reject("The App Store could not be reached.", nil, error)
            }
        }
    }

    @objc func purchase(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), Self.productIDs.contains(id) else {
            return call.reject("Unknown product.")
        }
        Task {
            do {
                guard let product = try await Product.products(for: [id]).first else {
                    return call.reject("That plan is not available right now.")
                }
                switch try await product.purchase() {
                case .success(let result):
                    guard case .verified(let transaction) = result else {
                        // Nothing is given for it, but it's finished, so StoreKit doesn't hand it back on every launch.
                        if case .unverified(let transaction, _) = result { await transaction.finish() }
                        return call.reject("The App Store could not verify this purchase.")
                    }
                    await transaction.finish()
                    call.resolve(["status": "purchased", "entitlement": await Self.currentEntitlement()])
                    self.learnRenewal()
                case .pending:
                    call.resolve(["status": "pending"])
                case .userCancelled:
                    call.resolve(["status": "cancelled"])
                @unknown default:
                    call.resolve(["status": "cancelled"])
                }
            } catch {
                call.reject(error.localizedDescription, nil, error)
            }
        }
    }

    @objc func entitlement(_ call: CAPPluginCall) {
        Task {
            call.resolve(await Self.currentEntitlement())
            learnRenewal()
        }
    }

    @objc func restore(_ call: CAPPluginCall) {
        Task {
            do {
                try await AppStore.sync()
                call.resolve(await Self.currentEntitlement())
                self.learnRenewal()
            } catch StoreKitError.userCancelled {
                // Dismissing the sign-in is the writer's choice, not a failure.
                call.reject("Cancelled.", "cancelled")
            } catch {
                call.reject(error.localizedDescription, nil, error)
            }
        }
    }

    @objc func manage(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard let scene = self.bridge?.viewController?.view.window?.windowScene else {
                return call.reject("Nib is not on screen.")
            }
            do {
                try await AppStore.showManageSubscriptions(in: scene)
                call.resolve()
            } catch {
                call.reject(error.localizedDescription, nil, error)
            }
        }
    }

    private static func describe(_ product: Product) async -> [String: Any] {
        let unit = product.subscription?.subscriptionPeriod.unit
        var described: [String: Any] = [
            "id": product.id,
            "displayName": product.displayName,
            "displayPrice": product.displayPrice,
            "price": NSDecimalNumber(decimal: product.price).doubleValue,
            // So a yearly price can be put a month at a time, in the same money.
            "currency": product.priceFormatStyle.currencyCode,
            "period": unit == .year ? "year" : "month"
        ]
        // Only offered to someone who has never had a trial in this group;
        // Apple decides, and says so here.
        if let offer = product.subscription?.introductoryOffer,
           offer.paymentMode == .freeTrial,
           await product.subscription?.isEligibleForIntroOffer == true {
            let days = [Product.SubscriptionPeriod.Unit.day: 1, .week: 7, .month: 30, .year: 365][offer.period.unit] ?? 0
            described["trialDays"] = days * offer.period.value
        }
        return described
    }

    /// Nib Plus as this device has it, if it has: the App Store's signed, unrevoked transaction.
    private static func current() async -> VerificationResult<Transaction>? {
        for await result in Transaction.currentEntitlements {
            guard case .verified(let transaction) = result,
                  productIDs.contains(transaction.productID),
                  transaction.revocationDate == nil else { continue }
            return result
        }
        return nil
    }

    /// Read from StoreKit's own verified, on-device record, so it works offline
    /// and answers at once. Whether it renews isn't in that record: it's as
    /// the App Store last said (`learnRenewal`), and left out till it has.
    static func currentEntitlement() async -> [String: Any] {
        guard let result = await current(), case .verified(let transaction) = result else { return ["active": false] }
        // The signed transaction goes to the sync server, which checks
        // Apple's signature itself rather than taking this app's word.
        var state: [String: Any] = ["active": true, "productId": transaction.productID, "jws": result.jwsRepresentation]
        if let expires = transaction.expirationDate {
            state["expiresAt"] = expires.timeIntervalSince1970 * 1000
        }
        if let renews = await renewals.said(of: transaction.originalID) {
            state["willRenew"] = renews
        }
        return state
    }

    /// Whether Nib Plus renews, which only the App Store can say, and over
    /// the network: asked once the page has its answer, not before it, and
    /// told to the page (`entitlementChanged`) when it's first known or has
    /// changed. The day's coins wait to know whether Plus is on
    /// (src/lib/useUnprompted.ts), and with this asked first they waited on
    /// the App Store too, however long it took.
    private func learnRenewal() {
        Task { [weak self] in
            guard let result = await Self.current(), case .verified(let transaction) = result,
                  let product = try? await Product.products(for: [transaction.productID]).first,
                  let statuses = try? await product.subscription?.status,
                  let status = statuses.first(where: {
                      if case .verified(let current) = $0.transaction { return current.originalID == transaction.originalID }
                      return false
                  }),
                  case .verified(let renewal) = status.renewalInfo,
                  await Self.renewals.say(renewal.willAutoRenew, of: transaction.originalID) else { return }
            self?.notifyListeners("entitlementChanged", data: await Self.currentEntitlement())
        }
    }

    private static let renewals = Renewals()
}

/// Whether each subscription renews, as the App Store last said, by its first transaction.
private actor Renewals {
    private var known: [UInt64: Bool] = [:]

    func said(of subscription: UInt64) -> Bool? { known[subscription] }

    /// Kept: whether it's news.
    func say(_ renews: Bool, of subscription: UInt64) -> Bool {
        let news = known[subscription] != renews
        known[subscription] = renews
        return news
    }
}
