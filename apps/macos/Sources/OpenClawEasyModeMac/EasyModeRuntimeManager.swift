import AppKit
import Darwin
import Foundation
import Observation
import UniformTypeIdentifiers

@MainActor
@Observable
final class EasyModeRuntimeManager {
    struct RuntimeCommand: Equatable {
        let executable: URL
        let arguments: [String]
        let environment: [String: String]
    }

    enum Status: Equatable {
        case stopped
        case starting
        case running(port: Int)
        case failed(String)

        var label: String {
            switch self {
            case .stopped:
                return "Stopped"
            case .starting:
                return "Starting..."
            case let .running(port):
                return "Running on 127.0.0.1:\(port)"
            case let .failed(reason):
                return "Failed: \(reason)"
            }
        }
    }

    private(set) var status: Status = .stopped
    private(set) var authStatus = "Not signed in"
    private(set) var lastError: String?
    private(set) var whatsappMessage: String?
    private(set) var whatsappQrDataUrl: String?
    private(set) var telegramToken: String = EasyModeConfigFile.telegramBotToken()
    private(set) var gatewayLog = ""

    private var gatewayProcess: Process?
    private var gatewayStdoutTask: Task<Void, Never>?
    private var currentPort: Int?
    private var authToken: String?
    private var launchGeneration = 0

    var isRunning: Bool {
        if case .running = self.status {
            return true
        }
        return false
    }

    func start(accessStore: EasyModeAccessStore) async {
        if self.isRunning || self.status == .starting {
            return
        }
        let launchGeneration = self.nextLaunchGeneration()
        do {
            self.status = .starting
            self.gatewayLog = ""
            try EasyModeProduct.ensureDirectories()
            try EasyModeConfigFile.ensureSeedConfig()
            try self.writeAllowedRootsManifest(accessStore: accessStore)

            let port = try Self.reserveLoopbackPort()
            let token = UUID().uuidString
            let endpointURL = URL(string: "ws://127.0.0.1:\(port)")!
            let process = try self.makeGatewayProcess(
                port: port,
                token: token,
                launchGeneration: launchGeneration)
            try process.run()

            self.gatewayProcess = process
            self.currentPort = port
            self.authToken = token
            self.captureGatewayOutput(process: process)
            await EasyModeGatewayConnection.shared.setEndpoint(url: endpointURL, token: token)
            guard self.isLaunchGenerationCurrent(launchGeneration) else {
                process.terminate()
                return
            }
            guard await Self.waitForGatewayReady(
                isProcessRunning: { process.isRunning },
                shouldContinue: {
                    await MainActor.run {
                        self.isLaunchGenerationCurrent(launchGeneration)
                    }
                },
                healthCheck: {
                    try await EasyModeGatewayConnection.probeHealth(
                        url: endpointURL,
                        token: token,
                        timeoutMs: 1_500)
                }
            ) else {
                guard self.isLaunchGenerationCurrent(launchGeneration) else {
                    process.terminate()
                    return
                }
                process.terminate()
                throw NSError(
                    domain: "EasyModeRuntime",
                    code: 3,
                    userInfo: [NSLocalizedDescriptionKey: "Gateway did not become ready in time."])
            }
            guard self.isCurrentLaunch(launchGeneration, process: process) else {
                process.terminate()
                return
            }
            self.status = .running(port: port)
            self.lastError = nil
        } catch {
            guard self.isCurrentLaunch(launchGeneration) else {
                return
            }
            self.status = .failed(error.localizedDescription)
            self.lastError = error.localizedDescription
        }
    }

    func stop() async {
        self.nextLaunchGeneration()
        self.gatewayStdoutTask?.cancel()
        self.gatewayStdoutTask = nil
        self.gatewayProcess?.terminate()
        self.gatewayProcess = nil
        self.currentPort = nil
        self.authToken = nil
        await EasyModeGatewayConnection.shared.clear()
        self.status = .stopped
    }

    func restart(accessStore: EasyModeAccessStore) async {
        await self.stop()
        await self.start(accessStore: accessStore)
    }

    func reloadTelegramToken() {
        self.telegramToken = EasyModeConfigFile.telegramBotToken()
    }

    func saveTelegramToken(_ token: String) -> Bool {
        do {
            try EasyModeConfigFile.setTelegramBotToken(token)
            self.telegramToken = EasyModeConfigFile.telegramBotToken()
            self.lastError = nil
            return true
        } catch {
            self.lastError = error.localizedDescription
            return false
        }
    }

    func signInWithCodex() async {
        self.authStatus = "Opening ChatGPT/Codex sign-in..."
        do {
            let output = try await self.runBundledCommand([
                "models",
                "auth",
                "--provider",
                "openai-codex",
                "--set-default",
            ])
            self.authStatus = output.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ? "ChatGPT/Codex sign-in completed."
                : output.trimmingCharacters(in: .whitespacesAndNewlines)
            self.lastError = nil
        } catch {
            self.authStatus = "Sign-in failed"
            self.lastError = error.localizedDescription
        }
    }

    func startWhatsAppLogin(force: Bool) async {
        do {
            let result = try await EasyModeGatewayConnection.shared.startWhatsAppLogin(force: force)
            self.whatsappMessage = result.message
            self.whatsappQrDataUrl = result.qrDataUrl
            self.lastError = nil
            if result.qrDataUrl != nil {
                Task {
                    await self.waitForWhatsAppLogin()
                }
            }
        } catch {
            self.lastError = error.localizedDescription
        }
    }

    func waitForWhatsAppLogin() async {
        do {
            let result = try await EasyModeGatewayConnection.shared.waitWhatsAppLogin()
            self.whatsappMessage = result.message
            if result.connected {
                self.whatsappQrDataUrl = nil
            }
            self.lastError = nil
        } catch {
            self.lastError = error.localizedDescription
        }
    }

    func logout(channel: String) async {
        do {
            try await EasyModeGatewayConnection.shared.logout(channel: channel)
            if channel == "whatsapp" {
                self.whatsappMessage = "Logged out."
                self.whatsappQrDataUrl = nil
            } else if channel == "telegram" {
                try EasyModeConfigFile.setTelegramBotToken("")
                self.telegramToken = ""
            }
            self.lastError = nil
        } catch {
            self.lastError = error.localizedDescription
        }
    }

    func exportBundle(accessStore: EasyModeAccessStore) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = EasyModeProduct.exportFileName
        panel.allowedContentTypes = [.json]
        guard panel.runModal() == .OK, let url = panel.url else {
            return
        }
        do {
            let bundle = accessStore.exportBundle()
            try EasyModeConfigFile.writeExportBundle(bundle, to: url)
            self.lastError = nil
        } catch {
            self.lastError = error.localizedDescription
        }
    }

    private func writeAllowedRootsManifest(accessStore: EasyModeAccessStore) throws {
        try accessStore.refreshRuntimeManifest()
    }

    private func nextLaunchGeneration() -> Int {
        self.launchGeneration += 1
        return self.launchGeneration
    }

    private func isLaunchGenerationCurrent(_ launchGeneration: Int) -> Bool {
        self.launchGeneration == launchGeneration
    }

    private func isCurrentLaunch(_ launchGeneration: Int, process: Process? = nil) -> Bool {
        guard self.isLaunchGenerationCurrent(launchGeneration) else {
            return false
        }
        guard let process else {
            return true
        }
        return self.gatewayProcess === process
    }

    private func makeGatewayProcess(port: Int, token: String, launchGeneration: Int) throws -> Process {
        let process = Process()
        let command = try self.gatewayCommand(port: port, token: token)
        process.executableURL = command.executable
        process.arguments = command.arguments
        process.environment = command.environment
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        process.terminationHandler = { [weak self] process in
            Task { @MainActor in
                guard let self, self.isCurrentLaunch(launchGeneration, process: process) else { return }
                self.gatewayStdoutTask?.cancel()
                self.gatewayStdoutTask = nil
                self.gatewayProcess = nil
                self.currentPort = nil
                self.authToken = nil
                await EasyModeGatewayConnection.shared.clear()
                if case .stopped = self.status {
                    return
                }
                if process.terminationStatus == 0 {
                    self.status = .stopped
                    return
                }
                self.status = .failed("Gateway exited with status \(process.terminationStatus).")
                self.lastError = "Gateway exited with status \(process.terminationStatus)."
            }
        }
        return process
    }

    private func captureGatewayOutput(process: Process) {
        guard let pipe = process.standardOutput as? Pipe else {
            return
        }
        self.gatewayStdoutTask = Task {
            for await data in pipe.fileHandleForReading.bytes.lines {
                self.gatewayLog += data + "\n"
            }
        }
    }

    private func runBundledCommand(_ arguments: [String]) async throws -> String {
        let command = try self.runtimeCommand(arguments: arguments)
        return try await Task.detached(priority: .utility) {
            let process = Process()
            process.executableURL = command.executable
            process.arguments = command.arguments
            process.environment = command.environment
            let pipe = Pipe()
            process.standardOutput = pipe
            process.standardError = pipe
            try process.run()
            process.waitUntilExit()
            let data = try pipe.fileHandleForReading.readToEnd() ?? Data()
            let output = String(decoding: data, as: UTF8.self)
            if process.terminationStatus != 0 {
                throw NSError(
                    domain: "EasyModeCommand",
                    code: Int(process.terminationStatus),
                    userInfo: [NSLocalizedDescriptionKey: output.isEmpty ? "Command failed." : output])
            }
            return output
        }.value
    }

    private func gatewayCommand(port: Int, token: String) throws -> (
        executable: URL,
        arguments: [String],
        environment: [String: String]
    ) {
        let command = try self.runtimeCommand(arguments: [
            "gateway",
            "run",
            "--port",
            String(port),
            "--bind",
            "loopback",
            "--auth",
            "token",
            "--token",
            token,
            "--allow-unconfigured",
        ])
        return (command.executable, command.arguments, command.environment)
    }

    func runtimeCommand(arguments: [String]) throws -> RuntimeCommand {
        try Self.runtimeCommand(
            arguments: arguments,
            processEnvironment: ProcessInfo.processInfo.environment,
            resourceURL: Bundle.main.resourceURL,
            currentDirectoryURL: URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true))
    }

    static func runtimeCommand(
        arguments: [String],
        processEnvironment: [String: String],
        resourceURL: URL?,
        currentDirectoryURL: URL,
    ) throws -> RuntimeCommand {
        let entrypoint = try self.resolveRuntimeEntrypoint(
            resourceURL: resourceURL,
            currentDirectoryURL: currentDirectoryURL)
        let env = self.runtimeEnvironment(processEnvironment: processEnvironment)
        let executable: URL
        var commandArguments: [String]

        if let bundledNode = self.resolveBundledNode(resourceURL: resourceURL) {
            executable = bundledNode
            commandArguments = [entrypoint.path]
        } else {
            executable = URL(fileURLWithPath: "/usr/bin/env")
            commandArguments = ["node", entrypoint.path]
        }

        commandArguments.append(contentsOf: arguments)
        return RuntimeCommand(executable: executable, arguments: commandArguments, environment: env)
    }

    static func runtimeEnvironment(processEnvironment: [String: String]) -> [String: String] {
        var env = processEnvironment
        env["OPENCLAW_PRODUCT_MODE"] = EasyModeProduct.productMode
        env["OPENCLAW_STATE_DIR"] = EasyModeProduct.stateDirURL.path
        env["OPENCLAW_CONFIG_PATH"] = EasyModeProduct.configURL.path
        env["OPENCLAW_ALLOWED_ROOTS_FILE"] = EasyModeProduct.allowedRootsManifestURL.path
        return env
    }

    static func resolveBundledNode(resourceURL: URL?) -> URL? {
        let candidate = resourceURL?
            .appendingPathComponent("runtime", isDirectory: true)
            .appendingPathComponent("node", isDirectory: false)
        guard let candidate else {
            return nil
        }
        return FileManager.default.isExecutableFile(atPath: candidate.path) ? candidate : nil
    }

    static func resolveRuntimeEntrypoint(
        resourceURL: URL?,
        currentDirectoryURL: URL,
    ) throws -> URL {
        if let resourceURL {
            let bundledRoot = resourceURL.appendingPathComponent("openclaw-runtime", isDirectory: true)
            if let entry = Self.resolveRuntimeEntrypoint(in: bundledRoot) {
                return entry
            }
        }

        for candidate in Self.searchRoots(startingAt: currentDirectoryURL) {
            if let entry = Self.resolveRuntimeEntrypoint(in: candidate) {
                return entry
            }
        }

        throw NSError(
            domain: "EasyModeRuntime",
            code: 2,
            userInfo: [NSLocalizedDescriptionKey: "Bundled OpenClaw runtime is missing."])
    }

    private static func resolveRuntimeEntrypoint(in root: URL) -> URL? {
        let candidates = [
            root.appendingPathComponent("dist/index.js"),
            root.appendingPathComponent("dist/index.mjs"),
            root.appendingPathComponent("openclaw.mjs"),
            root.appendingPathComponent("bin/openclaw.js"),
        ]
        for candidate in candidates where FileManager.default.fileExists(atPath: candidate.path) {
            return candidate
        }
        return nil
    }

    private static func searchRoots(startingAt start: URL) -> [URL] {
        var results: [URL] = []
        var current = start
        for _ in 0..<8 {
            results.append(current)
            let parent = current.deletingLastPathComponent()
            if parent == current {
                break
            }
            current = parent
        }
        return results
    }

    static func waitForGatewayReady(
        timeout: TimeInterval = 6,
        sleepNanoseconds: UInt64 = 300_000_000,
        isProcessRunning: @escaping () -> Bool,
        shouldContinue: @escaping () async -> Bool = { true },
        healthCheck: @escaping () async throws -> Bool,
    ) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if !(await shouldContinue()) {
                return false
            }
            if !isProcessRunning() {
                return false
            }
            do {
                if try await healthCheck() {
                    return true
                }
            } catch {
            }
            try? await Task.sleep(nanoseconds: sleepNanoseconds)
        }
        return false
    }

    private static func reserveLoopbackPort() throws -> Int {
        let socketFd = socket(AF_INET, SOCK_STREAM, 0)
        guard socketFd >= 0 else {
            throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
        }
        defer { close(socketFd) }

        var value: Int32 = 1
        _ = withUnsafePointer(to: &value) {
            setsockopt(socketFd, SOL_SOCKET, SO_REUSEADDR, $0, socklen_t(MemoryLayout<Int32>.size))
        }

        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
        address.sin_port = in_port_t(0)

        let bindResult = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                bind(socketFd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard bindResult == 0 else {
            throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
        }

        var resultAddress = sockaddr_in()
        var resultLength = socklen_t(MemoryLayout<sockaddr_in>.size)
        let nameResult = withUnsafeMutablePointer(to: &resultAddress) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                getsockname(socketFd, $0, &resultLength)
            }
        }
        guard nameResult == 0 else {
            throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
        }
        return Int(UInt16(bigEndian: resultAddress.sin_port))
    }
}
