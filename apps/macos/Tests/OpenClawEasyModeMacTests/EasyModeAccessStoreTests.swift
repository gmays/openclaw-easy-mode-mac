import Foundation
import Testing
@testable import OpenClawEasyModeMac

@Suite(.serialized)
@MainActor
struct EasyModeAccessStoreTests {
    final class BookmarkRecorder {
        var started: [String] = []
        var stopped: [String] = []
        var replacements: [Data: EasyModeAccessStore.BookmarkResolution] = [:]
        var makeBookmarkImpl: ((URL) throws -> Data)?

        func bookmarking() -> EasyModeAccessStore.Bookmarking {
            EasyModeAccessStore.Bookmarking(
                startAccessing: { url in
                    self.started.append(url.path)
                    return true
                },
                stopAccessing: { url in
                    self.stopped.append(url.path)
                },
                makeBookmark: { url in
                    if let makeBookmarkImpl = self.makeBookmarkImpl {
                        return try makeBookmarkImpl(url)
                    }
                    return Data(url.path.utf8)
                },
                resolveBookmark: { data in
                    if let replacement = self.replacements[data] {
                        return replacement
                    }
                    return EasyModeAccessStore.BookmarkResolution(
                        url: URL(fileURLWithPath: String(decoding: data, as: UTF8.self), isDirectory: true),
                        isStale: false)
                })
        }
    }

    @Test
    func `regrant replaces previous scoped access and updates manifest`() async throws {
        let stateDir = try makeEasyModeTempDir()
        defer { try? FileManager.default.removeItem(at: stateDir) }

        try await EasyModeTestIsolation.withEnvValues([
            "OPENCLAW_EASY_MODE_STATE_DIR": stateDir.path,
        ]) {
            let folder = stateDir.appendingPathComponent("granted", isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)

            let recorder = BookmarkRecorder()
            let store = EasyModeAccessStore(bookmarking: recorder.bookmarking())

            try store.addGrant(url: folder)
            try store.addGrant(url: folder)

            #expect(store.grants.count == 1)
            #expect(store.allowedRootPaths() == [folder.path])
            #expect(recorder.started == [folder.path, folder.path])
            #expect(recorder.stopped == [folder.path])

            let manifestData = try Data(contentsOf: EasyModeProduct.allowedRootsManifestURL)
            let manifest = try JSONDecoder().decode(EasyModeAccessStore.RuntimeManifest.self, from: manifestData)
            #expect(manifest.workspaceDir == EasyModeProduct.workspaceURL.path)
            #expect(manifest.allowedRoots == [folder.path])

            let savedData = try Data(contentsOf: EasyModeProduct.bookmarkStoreURL)
            let savedGrants = try JSONDecoder().decode([EasyModeAccessStore.Grant].self, from: savedData)
            #expect(savedGrants.count == 1)
            #expect(savedGrants.first?.path == folder.path)
        }
    }

    @Test
    func `restores stale bookmark to moved path on launch`() async throws {
        let stateDir = try makeEasyModeTempDir()
        defer { try? FileManager.default.removeItem(at: stateDir) }

        try await EasyModeTestIsolation.withEnvValues([
            "OPENCLAW_EASY_MODE_STATE_DIR": stateDir.path,
        ]) {
            try EasyModeProduct.ensureDirectories()
            let oldPath = stateDir.appendingPathComponent("old-folder", isDirectory: true)
            let newPath = stateDir.appendingPathComponent("new-folder", isDirectory: true)
            let bookmark = Data(oldPath.path.utf8)
            let persisted = [
                EasyModeAccessStore.Grant(
                    id: UUID(),
                    path: oldPath.path,
                    bookmarkDataBase64: bookmark.base64EncodedString()),
            ]
            try JSONEncoder().encode(persisted).write(to: EasyModeProduct.bookmarkStoreURL, options: [.atomic])

            let recorder = BookmarkRecorder()
            recorder.replacements[bookmark] = EasyModeAccessStore.BookmarkResolution(
                url: newPath,
                isStale: true)
            recorder.makeBookmarkImpl = { url in
                Data(url.path.utf8)
            }

            let store = EasyModeAccessStore(bookmarking: recorder.bookmarking())

            #expect(store.grants.count == 1)
            #expect(store.grants.first?.path == newPath.path)
            #expect(store.allowedRootPaths() == [newPath.path])
            #expect(recorder.started == [newPath.path])
        }
    }
}
