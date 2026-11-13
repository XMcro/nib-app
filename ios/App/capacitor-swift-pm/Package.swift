// swift-tools-version:5.3

// Capacitor, built from its own source by scripts/build-capacitor.sh, because
// the published capacitor-swift-pm has no Mac Catalyst slice. It has the same
// name as the published package, so Swift Package Manager uses this copy for
// the app and for every plugin that depends on it.
import PackageDescription

let package = Package(
    name: "capacitor-swift-pm",
    products: [
        .library(name: "Capacitor", targets: ["Capacitor"]),
        .library(name: "Cordova", targets: ["Cordova"])
    ],
    targets: [
        .binaryTarget(name: "Capacitor", path: "Capacitor.xcframework"),
        .binaryTarget(name: "Cordova", path: "Cordova.xcframework")
    ]
)
