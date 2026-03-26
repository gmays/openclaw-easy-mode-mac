import Foundation

actor EasyModeTestIsolationLock {
    static let shared = EasyModeTestIsolationLock()

    private var locked = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    func acquire() async {
        if !self.locked {
            self.locked = true
            return
        }
        await withCheckedContinuation { continuation in
            self.waiters.append(continuation)
        }
    }

    func release() {
        if self.waiters.isEmpty {
            self.locked = false
            return
        }
        self.waiters.removeFirst().resume()
    }
}

@MainActor
enum EasyModeTestIsolation {
    static func withEnvValues<T>(
        _ values: [String: String?],
        _ body: () async throws -> T
    ) async rethrows -> T {
        await EasyModeTestIsolationLock.shared.acquire()
        var previousValues: [String: String?] = [:]
        for (key, value) in values {
            previousValues[key] = getenv(key).map { String(cString: $0) }
            if let value {
                setenv(key, value, 1)
            } else {
                unsetenv(key)
            }
        }

        do {
            let result = try await body()
            restoreEnv(previousValues)
            await EasyModeTestIsolationLock.shared.release()
            return result
        } catch {
            restoreEnv(previousValues)
            await EasyModeTestIsolationLock.shared.release()
            throw error
        }
    }

    private static func restoreEnv(_ values: [String: String?]) {
        for (key, value) in values {
            if let value {
                setenv(key, value, 1)
            } else {
                unsetenv(key)
            }
        }
    }
}

func makeEasyModeTempDir() throws -> URL {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("openclaw-easy-mode-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
}

func makeExecutableForEasyModeTests(at path: URL) throws {
    try FileManager.default.createDirectory(
        at: path.deletingLastPathComponent(),
        withIntermediateDirectories: true)
    FileManager.default.createFile(atPath: path.path, contents: Data("#!/bin/sh\nexit 0\n".utf8))
    try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: path.path)
}
