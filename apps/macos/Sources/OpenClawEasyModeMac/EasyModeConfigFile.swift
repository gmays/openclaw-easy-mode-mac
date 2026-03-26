import Foundation

enum EasyModeConfigFile {
    private static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return encoder
    }()

    struct ExportBundle: Codable {
        let version: Int
        let productMode: String
        let exportedAt: String
        let workspaceDir: String
        let settings: [String: EasyModeJSONValue]
        let allowedRootsManifest: AllowedRootsManifestPayload
        let connectors: ConnectorPayload
    }

    struct AllowedRootsManifestPayload: Codable {
        let workspaceDir: String
        let allowedRoots: [String]
    }

    struct ConnectorPayload: Codable {
        let telegram: [String: EasyModeJSONValue]?
        let whatsapp: [String: EasyModeJSONValue]?
    }

    static func seededRoot(from existingRoot: [String: Any]) -> (root: [String: Any], didChange: Bool) {
        var root = existingRoot
        if root.isEmpty {
            root["meta"] = [
                "productMode": EasyModeProduct.productMode,
                "productName": EasyModeProduct.displayName,
            ]
            root["gateway"] = [
                "bind": "loopback",
            ]
            root["agents"] = [
                "defaults": [
                    "workspace": EasyModeProduct.workspaceURL.path,
                ],
            ]
            return (root, true)
        }

        var didChange = false
        if root["meta"] == nil {
            root["meta"] = [
                "productMode": EasyModeProduct.productMode,
                "productName": EasyModeProduct.displayName,
            ]
            didChange = true
        }
        if root["gateway"] == nil {
            root["gateway"] = ["bind": "loopback"]
            didChange = true
        }
        let agents = root["agents"] as? [String: Any] ?? [:]
        let defaults = agents["defaults"] as? [String: Any] ?? [:]
        if (defaults["workspace"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false {
            var nextDefaults = defaults
            nextDefaults["workspace"] = EasyModeProduct.workspaceURL.path
            var nextAgents = agents
            nextAgents["defaults"] = nextDefaults
            root["agents"] = nextAgents
            didChange = true
        }

        return (root, didChange)
    }

    static func makeExportBundle(
        root: [String: Any],
        allowedRoots: [String],
        exportedAt: Date = Date(),
    ) -> ExportBundle {
        let channels = root["channels"] as? [String: Any] ?? [:]
        let settings = (EasyModeJSONValue.fromFoundation(root).flatMap {
            if case let .object(value) = $0 {
                return value
            }
            return nil
        }) ?? [:]
        let telegram = channels["telegram"].flatMap(EasyModeJSONValue.fromFoundation).flatMap { value in
            if case let .object(object) = value {
                return object
            }
            return nil
        }
        let whatsapp = channels["whatsapp"].flatMap(EasyModeJSONValue.fromFoundation).flatMap { value in
            if case let .object(object) = value {
                return object
            }
            return nil
        }
        return ExportBundle(
            version: 1,
            productMode: EasyModeProduct.productMode,
            exportedAt: ISO8601DateFormatter().string(from: exportedAt),
            workspaceDir: EasyModeProduct.workspaceURL.path,
            settings: settings,
            allowedRootsManifest: AllowedRootsManifestPayload(
                workspaceDir: EasyModeProduct.workspaceURL.path,
                allowedRoots: allowedRoots),
            connectors: ConnectorPayload(telegram: telegram, whatsapp: whatsapp))
    }

    static func loadRoot() -> [String: Any] {
        let url = EasyModeProduct.configURL
        guard let data = try? Data(contentsOf: url),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            return [:]
        }
        return root
    }

    static func saveRoot(_ root: [String: Any]) throws {
        try EasyModeProduct.ensureDirectories()
        let data = try JSONSerialization.data(withJSONObject: root, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: EasyModeProduct.configURL, options: [.atomic])
    }

    static func ensureSeedConfig() throws {
        let seeded = self.seededRoot(from: self.loadRoot())
        let root = seeded.root
        let didChange = seeded.didChange
        if didChange {
            try self.saveRoot(root)
        }
    }

    static func telegramBotToken() -> String {
        let root = self.loadRoot()
        let channels = root["channels"] as? [String: Any]
        let telegram = channels?["telegram"] as? [String: Any]
        return (telegram?["botToken"] as? String) ?? ""
    }

    static func setTelegramBotToken(_ token: String) throws {
        var root = self.loadRoot()
        var channels = root["channels"] as? [String: Any] ?? [:]
        var telegram = channels["telegram"] as? [String: Any] ?? [:]
        let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            telegram.removeValue(forKey: "botToken")
        } else {
            telegram["botToken"] = trimmed
        }
        if telegram.isEmpty {
            channels.removeValue(forKey: "telegram")
        } else {
            channels["telegram"] = telegram
        }
        if channels.isEmpty {
            root.removeValue(forKey: "channels")
        } else {
            root["channels"] = channels
        }
        try self.saveRoot(root)
    }

    static func exportBundle(allowedRoots: [String]) -> ExportBundle {
        self.makeExportBundle(root: self.loadRoot(), allowedRoots: allowedRoots)
    }

    static func writeExportBundle(_ bundle: ExportBundle, to url: URL) throws {
        let data = try self.encoder.encode(bundle)
        try data.write(to: url, options: [.atomic])
    }
}
