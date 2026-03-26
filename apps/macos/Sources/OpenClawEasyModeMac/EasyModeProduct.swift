import Foundation

enum EasyModeProduct {
    private static let stateDirOverrideEnv = "OPENCLAW_EASY_MODE_STATE_DIR"
    private static let appSupportDirOverrideEnv = "OPENCLAW_EASY_MODE_APP_SUPPORT_DIR"

    static let displayName = "OpenClaw Easy Mode (Mac)"
    static let productMode = "easy-mode-mac"
    static let exportFileName = "OpenClaw-Easy-Mode-Export.json"

    static var appSupportURL: URL {
        if let override = self.overrideURL(for: self.appSupportDirOverrideEnv) {
            return override
        }
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support", isDirectory: true)
        return base.appendingPathComponent("OpenClawEasyModeMac", isDirectory: true)
    }

    static var stateDirURL: URL {
        if let override = self.overrideURL(for: self.stateDirOverrideEnv) {
            return override
        }
        self.appSupportURL.appendingPathComponent("State", isDirectory: true)
    }

    static var workspaceURL: URL {
        self.stateDirURL.appendingPathComponent("workspace", isDirectory: true)
    }

    static var configURL: URL {
        self.stateDirURL.appendingPathComponent("openclaw.json")
    }

    static var allowedRootsManifestURL: URL {
        self.stateDirURL.appendingPathComponent("allowed-roots.manifest.json")
    }

    static var bookmarkStoreURL: URL {
        self.stateDirURL.appendingPathComponent("allowed-roots.bookmarks.json")
    }

    static func ensureDirectories() throws {
        try FileManager.default.createDirectory(at: self.workspaceURL, withIntermediateDirectories: true)
    }

    private static func overrideURL(for envName: String) -> URL? {
        let raw = ProcessInfo.processInfo.environment[envName]?.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let raw, !raw.isEmpty else {
            return nil
        }
        return URL(fileURLWithPath: raw, isDirectory: true)
    }
}
