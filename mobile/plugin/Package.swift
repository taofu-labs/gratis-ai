// swift-tools-version: 5.9
import PackageDescription

// iOS half of the GratisNative plugin (the Android half lives in the app,
// mobile/android/.../GratisNativePlugin.java). LlamaServer.xcframework is
// built by scripts/build_ios_llama_server.sh.
let package = Package(
    name: "GratisNative",
    platforms: [ .iOS( .v16 ) ],
    products: [
        .library( name: "GratisNative", targets: [ "GratisNativePlugin" ] ),
    ],
    dependencies: [
        .package( url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.5.3" ),
    ],
    targets: [
        .binaryTarget( name: "LlamaServer", path: "ios/LlamaServer.xcframework" ),
        .target(
            name: "GratisNativePlugin",
            dependencies: [
                .product( name: "Capacitor", package: "capacitor-swift-pm" ),
                .product( name: "Cordova", package: "capacitor-swift-pm" ),
                "LlamaServer",
            ],
            path: "ios/Sources/GratisNativePlugin",
            linkerSettings: [
                .linkedFramework( "Metal" ),
                .linkedFramework( "MetalKit" ),
                .linkedFramework( "Accelerate" ),
                .linkedFramework( "Foundation" ),
                .linkedLibrary( "c++" ),
            ]
        ),
    ]
)
