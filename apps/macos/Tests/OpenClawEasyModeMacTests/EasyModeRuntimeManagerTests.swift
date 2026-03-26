import Foundation
import Testing
@testable import OpenClawEasyModeMac

@Suite(.serialized)
@MainActor
struct EasyModeRuntimeManagerTests {
    @Test
    func `runtime environment injects easy mode state paths`() async throws {
        let stateDir = try makeEasyModeTempDir()
        defer { try? FileManager.default.removeItem(at: stateDir) }

        try await EasyModeTestIsolation.withEnvValues([
            "OPENCLAW_EASY_MODE_STATE_DIR": stateDir.path,
        ]) {
            let env = EasyModeRuntimeManager.runtimeEnvironment(processEnvironment: [
                "PATH": "/usr/bin",
            ])

            #expect(env["PATH"] == "/usr/bin")
            #expect(env["OPENCLAW_PRODUCT_MODE"] == EasyModeProduct.productMode)
            #expect(env["OPENCLAW_STATE_DIR"] == EasyModeProduct.stateDirURL.path)
            #expect(env["OPENCLAW_CONFIG_PATH"] == EasyModeProduct.configURL.path)
            #expect(env["OPENCLAW_ALLOWED_ROOTS_FILE"] == EasyModeProduct.allowedRootsManifestURL.path)
        }
    }

    @Test
    func `runtime command prefers bundled node and runtime entrypoint`() async throws {
        let stateDir = try makeEasyModeTempDir()
        defer { try? FileManager.default.removeItem(at: stateDir) }

        try await EasyModeTestIsolation.withEnvValues([
            "OPENCLAW_EASY_MODE_STATE_DIR": stateDir.path,
        ]) {
            let resourceURL = stateDir.appendingPathComponent("Resources", isDirectory: true)
            try makeExecutableForEasyModeTests(
                at: resourceURL.appendingPathComponent("runtime/node"))
            let entrypoint = resourceURL
                .appendingPathComponent("openclaw-runtime/dist/index.js")
            try FileManager.default.createDirectory(
                at: entrypoint.deletingLastPathComponent(),
                withIntermediateDirectories: true)
            try Data("console.log('ok')\n".utf8).write(to: entrypoint, options: [.atomic])

            let command = try EasyModeRuntimeManager.runtimeCommand(
                arguments: ["gateway", "run"],
                processEnvironment: [:],
                resourceURL: resourceURL,
                currentDirectoryURL: stateDir)

            #expect(command.executable.path == resourceURL.appendingPathComponent("runtime/node").path)
            #expect(command.arguments == [entrypoint.path, "gateway", "run"])
        }
    }

    @Test
    func `runtime command falls back to env node from cwd search roots`() async throws {
        let stateDir = try makeEasyModeTempDir()
        defer { try? FileManager.default.removeItem(at: stateDir) }

        try await EasyModeTestIsolation.withEnvValues([
            "OPENCLAW_EASY_MODE_STATE_DIR": stateDir.path,
        ]) {
            let repoRoot = stateDir.appendingPathComponent("repo", isDirectory: true)
            let workingDir = repoRoot.appendingPathComponent("apps/macos", isDirectory: true)
            let entrypoint = repoRoot.appendingPathComponent("dist/index.mjs")
            try FileManager.default.createDirectory(
                at: entrypoint.deletingLastPathComponent(),
                withIntermediateDirectories: true)
            try FileManager.default.createDirectory(at: workingDir, withIntermediateDirectories: true)
            try Data("console.log('ok')\n".utf8).write(to: entrypoint, options: [.atomic])

            let command = try EasyModeRuntimeManager.runtimeCommand(
                arguments: ["models", "auth"],
                processEnvironment: [:],
                resourceURL: nil,
                currentDirectoryURL: workingDir)

            #expect(command.executable.path == "/usr/bin/env")
            #expect(command.arguments == ["node", entrypoint.path, "models", "auth"])
        }
    }

    @Test
    func `wait for gateway ready retries until health succeeds`() async {
        let attempts = LockedCounter()
        let ready = await EasyModeRuntimeManager.waitForGatewayReady(
            timeout: 0.2,
            sleepNanoseconds: 1_000_000,
            isProcessRunning: { true },
            healthCheck: {
                let next = await attempts.incrementAndGet()
                return next >= 3
            })

        #expect(ready)
        #expect(await attempts.value == 3)
    }

    @Test
    func `wait for gateway ready fails when process exits early`() async {
        let ready = await EasyModeRuntimeManager.waitForGatewayReady(
            timeout: 0.2,
            sleepNanoseconds: 1_000_000,
            isProcessRunning: { false },
            healthCheck: { true })

        #expect(!ready)
    }
}

actor LockedCounter {
    private(set) var value = 0

    func incrementAndGet() -> Int {
        self.value += 1
        return self.value
    }
}
