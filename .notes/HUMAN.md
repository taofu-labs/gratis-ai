# Human Actions

## Apple Developer agreement blocks notarization (2026-08-22)

The v0.42.0 macOS build packaged and signed successfully, then Apple's notary service returned HTTP
403: a required agreement is missing or expired for the Developer team. Accept the current agreement
in the Apple Developer/App Store Connect account before the next Electron release. Repository code
cannot bypass this. The release workflow now keeps all artifacts in draft until every platform build,
including notarization, succeeds.
