import Foundation
import Testing
@testable import OpenClawEasyModeMac

@Suite(.serialized)
@MainActor
struct EasyModeConfigFileTests {
    @Test
    func `seeded root fills empty config and backfills workspace`() async throws {
        let stateDir = try makeEasyModeTempDir()
        defer { try? FileManager.default.removeItem(at: stateDir) }

        try await EasyModeTestIsolation.withEnvValues([
            "OPENCLAW_EASY_MODE_STATE_DIR": stateDir.path,
        ]) {
            let seeded = EasyModeConfigFile.seededRoot(from: [:])
            #expect(seeded.didChange)
            let meta = seeded.root["meta"] as? [String: String]
            #expect(meta?["productMode"] == EasyModeProduct.productMode)
            #expect(meta?["productName"] == EasyModeProduct.displayName)
            let gateway = seeded.root["gateway"] as? [String: String]
            #expect(gateway?["bind"] == "loopback")

            let backfilled = EasyModeConfigFile.seededRoot(from: [
                "agents": [
                    "defaults": [:],
                ],
            ])
            let agents = backfilled.root["agents"] as? [String: Any]
            let defaults = agents?["defaults"] as? [String: String]
            #expect(defaults?["workspace"] == EasyModeProduct.workspaceURL.path)
        }
    }

    @Test
    func `make export bundle includes connector payloads and allowed roots`() async throws {
        let stateDir = try makeEasyModeTempDir()
        defer { try? FileManager.default.removeItem(at: stateDir) }

        try await EasyModeTestIsolation.withEnvValues([
            "OPENCLAW_EASY_MODE_STATE_DIR": stateDir.path,
        ]) {
            let exportedAt = Date(timeIntervalSince1970: 1_700_000_000)
            let bundle = EasyModeConfigFile.makeExportBundle(
                root: [
                    "meta": [
                        "productMode": EasyModeProduct.productMode,
                    ],
                    "channels": [
                        "telegram": [
                            "botToken": "abc123",
                        ],
                        "whatsapp": [
                            "session": "persisted",
                        ],
                    ],
                ],
                allowedRoots: ["/tmp/granted"],
                exportedAt: exportedAt)

            #expect(bundle.version == 1)
            #expect(bundle.productMode == EasyModeProduct.productMode)
            #expect(bundle.workspaceDir == EasyModeProduct.workspaceURL.path)
            #expect(bundle.allowedRootsManifest.allowedRoots == ["/tmp/granted"])
            #expect(bundle.allowedRootsManifest.workspaceDir == EasyModeProduct.workspaceURL.path)
            #expect(bundle.connectors.telegram?["botToken"] == .string("abc123"))
            #expect(bundle.connectors.whatsapp?["session"] == .string("persisted"))
            #expect(bundle.exportedAt == ISO8601DateFormatter().string(from: exportedAt))
        }
    }
}
