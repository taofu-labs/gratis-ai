#!/usr/bin/env bash
# Typecheck the iOS plugin's Swift on Linux (no Xcode): stub UIKit/Capacitor/
# Metal/CryptoKit, patch the few Darwin-only APIs in a scratch copy.
# Needs a Swift toolchain in vendor/swift (swift.org Linux tarball).
# Usage: scripts/swift_typecheck.sh
set -euo pipefail

ROOT="$( cd "$( dirname "$0" )/.." && pwd )"
SRC="${ROOT}/mobile/plugin/ios"
WORK="$( mktemp -d )"
trap 'rm -rf "${WORK}"' EXIT
swiftc() { LD_LIBRARY_PATH="${ROOT}/vendor/swift/compat" "${ROOT}/vendor/swift/usr/bin/swiftc" "$@"; }

mkdir -p "${WORK}/stubs" "${WORK}/mods" "${WORK}/src"
cat > "${WORK}/stubs/UIKit.swift" <<'STUB'
@_exported import Foundation
public struct UIBackgroundTaskIdentifier: Sendable { public static let invalid = UIBackgroundTaskIdentifier() }
@MainActor public final class UIApplication {
    public static let shared = UIApplication()
    public func beginBackgroundTask( withName: String?, expirationHandler: ( @MainActor @Sendable () -> Void )? = nil ) -> UIBackgroundTaskIdentifier { .invalid }
    public func endBackgroundTask( _ id: UIBackgroundTaskIdentifier ) {}
}
STUB
cat > "${WORK}/stubs/CryptoKit.swift" <<'STUB'
import Foundation
public struct SHA256 { public init() {}; public mutating func update( data: some DataProtocol ) {}; public func finalize() -> [ UInt8 ] { [] } }
STUB
cat > "${WORK}/stubs/Metal.swift" <<'STUB'
public enum MTLGPUFamily { case apple7 }
public protocol MTLDevice { func supportsFamily( _ f: MTLGPUFamily ) -> Bool; var name: String { get } }
public func MTLCreateSystemDefaultDevice() -> MTLDevice? { nil }
STUB
cat > "${WORK}/stubs/os.swift" <<'STUB'
public func os_proc_available_memory() -> Int { 0 }
STUB
cat > "${WORK}/stubs/Capacitor.swift" <<'STUB'
import Foundation
public typealias JSObject = [ String: Any ]
public let CAPPluginReturnPromise = "promise"
public struct CAPPluginMethod { public init( name: String, returnType: String ) {} }
public protocol CAPBridgedPlugin { var identifier: String { get }; var jsName: String { get }; var pluginMethods: [ CAPPluginMethod ] { get } }
open class CAPPlugin { public init() {}; open func load() {}; public func notifyListeners( _ name: String, data: [ String: Any ]? ) {} }
public final class CAPPluginCall {
    public func getString( _ k: String ) -> String? { nil }
    public func getDouble( _ k: String ) -> Double? { nil }
    public func getObject( _ k: String ) -> JSObject? { nil }
    public func getArray<T>( _ k: String, _ t: T.Type ) -> [ T ]? { nil }
    public func resolve( _ d: [ String: Any ] = [:] ) {}
    public func reject( _ m: String ) {}
}
public func sysctlbyname( _ n: UnsafePointer<CChar>, _ a: UnsafeMutableRawPointer?, _ b: UnsafeMutablePointer<Int>?, _ c: UnsafeMutableRawPointer?, _ d: Int ) -> Int32 { 0 }
STUB

for module in UIKit CryptoKit Metal os Capacitor; do
    swiftc -parse-as-library -emit-module -module-name "${module}" -emit-module-path "${WORK}/mods/${module}.swiftmodule" "${WORK}/stubs/${module}.swift"
done
cp "${SRC}/LlamaServerShim/gratis_llama_server.h" "${SRC}/LlamaServerShim/module.modulemap" "${WORK}/mods/"

# Linux spellings of Darwin-only bits; no @objc without the ObjC runtime
for file in "${SRC}"/Sources/GratisNativePlugin/*.swift; do
    sed -e 's/@objc(GratisNativePlugin)//; s/@objc func/func/' \
        -e 's/^import Foundation$/import Foundation\n#if canImport(FoundationNetworking)\nimport FoundationNetworking\n#endif/' \
        -e 's/volumeAvailableCapacityForImportantUsage/volumeAvailableCapacity/g' \
        -e 's/socket( AF_INET, SOCK_STREAM, 0 )/socket( AF_INET, Int32( SOCK_STREAM.rawValue ), 0 )/' \
        "${file}" > "${WORK}/src/$( basename "${file}" )"
done

swiftc -typecheck -swift-version 5 -I "${WORK}/mods" -Xcc -fmodule-map-file="${WORK}/mods/module.modulemap" "${WORK}"/src/*.swift
echo "Swift typecheck passed"
