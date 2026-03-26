import AppKit
import Foundation
import Observation

@MainActor
@Observable
final class EasyModeAccessStore {
    struct Grant: Codable, Identifiable, Hashable {
        let id: UUID
        let path: String
        let bookmarkDataBase64: String
    }

    struct RuntimeManifest: Codable {
        let version: Int
        let productMode: String
        let workspaceDir: String
        let allowedRoots: [String]
    }

    private(set) var grants: [Grant] = []
    private(set) var lastError: String?
    private var activeUrls: [UUID: URL] = [:]

    init() {
        self.load()
        self.startAccessingResolvedGrants()
        try? self.writeRuntimeManifest()
    }

    func addFolderGrant() {
        let panel = NSOpenPanel()
        panel.prompt = "Grant Access"
        panel.message = "OpenClaw Easy Mode can only access folders you pick here."
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK, let url = panel.url else {
            return
        }
        do {
            try self.addGrant(url: url)
            self.lastError = nil
        } catch {
            self.lastError = error.localizedDescription
        }
    }

    func removeGrant(_ grant: Grant) {
        if let url = self.activeUrls.removeValue(forKey: grant.id) {
            url.stopAccessingSecurityScopedResource()
        }
        self.grants.removeAll { $0.id == grant.id }
        self.persist()
        try? self.writeRuntimeManifest()
    }

    func allowedRootPaths() -> [String] {
        let resolved = self.grants.compactMap { grant in
            self.activeUrls[grant.id]?.path.nonEmpty ?? grant.path.nonEmpty
        }
        return Array(NSOrderedSet(array: resolved)) as? [String] ?? resolved
    }

    func exportBundle() -> EasyModeConfigFile.ExportBundle {
        EasyModeConfigFile.exportBundle(allowedRoots: self.allowedRootPaths())
    }

    func refreshRuntimeManifest() throws {
        try self.writeRuntimeManifest()
    }

    private func addGrant(url: URL) throws {
        let accessStarted = url.startAccessingSecurityScopedResource()
        defer {
            if !accessStarted {
                url.stopAccessingSecurityScopedResource()
            }
        }
        let bookmark = try url.bookmarkData(
            options: [.withSecurityScope],
            includingResourceValuesForKeys: nil,
            relativeTo: nil)
        let grant = Grant(
            id: UUID(),
            path: url.path,
            bookmarkDataBase64: bookmark.base64EncodedString())
        self.activeUrls[grant.id] = url
        self.grants.removeAll { $0.path == url.path }
        self.grants.append(grant)
        self.grants.sort { $0.path.localizedCaseInsensitiveCompare($1.path) == .orderedAscending }
        self.persist()
        try self.writeRuntimeManifest()
    }

    private func load() {
        guard let data = try? Data(contentsOf: EasyModeProduct.bookmarkStoreURL) else {
            self.grants = []
            return
        }
        do {
            self.grants = try JSONDecoder().decode([Grant].self, from: data)
        } catch {
            self.grants = []
            self.lastError = error.localizedDescription
        }
    }

    private func persist() {
        do {
            try EasyModeProduct.ensureDirectories()
            let data = try JSONEncoder().encode(self.grants)
            try data.write(to: EasyModeProduct.bookmarkStoreURL, options: [.atomic])
        } catch {
            self.lastError = error.localizedDescription
        }
    }

    private func startAccessingResolvedGrants() {
        var resolved: [Grant] = []
        for grant in self.grants {
            guard let data = Data(base64Encoded: grant.bookmarkDataBase64) else {
                continue
            }
            var stale = false
            do {
                let url = try URL(
                    resolvingBookmarkData: data,
                    options: [.withSecurityScope],
                    relativeTo: nil,
                    bookmarkDataIsStale: &stale)
                _ = url.startAccessingSecurityScopedResource()
                self.activeUrls[grant.id] = url
                resolved.append(
                    Grant(
                        id: grant.id,
                        path: url.path,
                        bookmarkDataBase64: stale ? try url.bookmarkData(options: [.withSecurityScope], includingResourceValuesForKeys: nil, relativeTo: nil).base64EncodedString() : grant.bookmarkDataBase64))
            } catch {
                self.lastError = error.localizedDescription
            }
        }
        self.grants = resolved
        self.persist()
    }

    private func writeRuntimeManifest() throws {
        try EasyModeProduct.ensureDirectories()
        let payload = RuntimeManifest(
            version: 1,
            productMode: EasyModeProduct.productMode,
            workspaceDir: EasyModeProduct.workspaceURL.path,
            allowedRoots: self.allowedRootPaths())
        let data = try JSONEncoder().encode(payload)
        try data.write(to: EasyModeProduct.allowedRootsManifestURL, options: [.atomic])
    }
}

private extension String {
    var nonEmpty: String? {
        let trimmed = self.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
