import Foundation
import OpenClawChatUI
import OpenClawKit
import OpenClawProtocol

actor EasyModeGatewayConnection {
    static let shared = EasyModeGatewayConnection()

    private var client: GatewayChannelActor?
    private var configuredURL: URL?
    private var configuredToken: String?
    private var lastSnapshot: HelloOk?
    private var subscribers: [UUID: AsyncStream<GatewayPush>.Continuation] = [:]
    private let decoder = JSONDecoder()

    func setEndpoint(url: URL, token: String) async {
        if self.configuredURL == url, self.configuredToken == token, self.client != nil {
            return
        }
        if let client = self.client {
            await client.shutdown()
        }
        self.client = GatewayChannelActor(
            url: url,
            token: token,
            password: nil,
            session: nil,
            pushHandler: { [weak self] push in
                await self?.handle(push: push)
            })
        self.configuredURL = url
        self.configuredToken = token
        self.lastSnapshot = nil
    }

    func clear() async {
        if let client = self.client {
            await client.shutdown()
        }
        self.client = nil
        self.configuredURL = nil
        self.configuredToken = nil
        self.lastSnapshot = nil
    }

    func request(method: String, params: [String: AnyCodable]? = nil, timeoutMs: Double? = nil) async throws -> Data {
        guard let client = self.client else {
            throw NSError(domain: "EasyModeGateway", code: 1, userInfo: [NSLocalizedDescriptionKey: "Gateway is not running."])
        }
        return try await client.request(method: method, params: params, timeoutMs: timeoutMs)
    }

    func requestDecoded<T: Decodable>(
        method: String,
        params: [String: AnyCodable]? = nil,
        timeoutMs: Double? = nil,
    ) async throws -> T {
        let data = try await self.request(method: method, params: params, timeoutMs: timeoutMs)
        return try self.decoder.decode(T.self, from: data)
    }

    func subscribe() -> AsyncStream<GatewayPush> {
        let id = UUID()
        let snapshot = self.lastSnapshot
        return AsyncStream { continuation in
            if let snapshot {
                continuation.yield(.snapshot(snapshot))
            }
            self.subscribers[id] = continuation
            continuation.onTermination = { @Sendable _ in
                Task {
                    await self.removeSubscriber(id)
                }
            }
        }
    }

    func mainSessionKey() async -> String {
        if let snapshot = self.lastSnapshot {
            let raw = snapshot.snapshot.sessiondefaults?["mainSessionKey"]?.value as? String
            let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if !trimmed.isEmpty {
                return trimmed
            }
        }
        return "main"
    }

    func healthOK(timeoutMs: Int = 5_000) async throws -> Bool {
        let data = try await self.request(method: "health", timeoutMs: Double(timeoutMs))
        return (try? self.decoder.decode(OpenClawGatewayHealthOK.self, from: data))?.ok ?? true
    }

    static func probeHealth(url: URL, token: String, timeoutMs: Int = 5_000) async throws -> Bool {
        let channel = GatewayChannelActor(url: url, token: token)
        let decoder = JSONDecoder()
        do {
            let data = try await channel.request(method: "health", timeoutMs: Double(timeoutMs))
            await channel.shutdown()
            return (try? decoder.decode(OpenClawGatewayHealthOK.self, from: data))?.ok ?? true
        } catch {
            await channel.shutdown()
            throw error
        }
    }

    func chatHistory(sessionKey: String) async throws -> OpenClawChatHistoryPayload {
        try await self.requestDecoded(
            method: "chat.history",
            params: ["sessionKey": AnyCodable(sessionKey)],
            timeoutMs: 15_000)
    }

    func listModels() async throws -> [OpenClawChatModelChoice] {
        let data = try await self.request(method: "models.list", params: [:], timeoutMs: 15_000)
        let result = try self.decoder.decode(ModelsListResult.self, from: data)
        return result.models.map {
            OpenClawChatModelChoice(
                modelID: $0.id,
                name: $0.name,
                provider: $0.provider,
                contextWindow: $0.contextwindow)
        }
    }

    func listSessions() async throws -> OpenClawChatSessionsListResponse {
        let data = try await self.request(
            method: "sessions.list",
            params: [
                "includeGlobal": AnyCodable(true),
                "includeUnknown": AnyCodable(false),
            ],
            timeoutMs: 15_000)
        let decoded = try self.decoder.decode(OpenClawChatSessionsListResponse.self, from: data)
        return OpenClawChatSessionsListResponse(
            ts: decoded.ts,
            path: decoded.path,
            count: decoded.count,
            defaults: OpenClawChatSessionsDefaults(
                model: decoded.defaults?.model,
                contextTokens: decoded.defaults?.contextTokens,
                mainSessionKey: await self.mainSessionKey()),
            sessions: decoded.sessions)
    }

    func sendMessage(
        sessionKey: String,
        message: String,
        thinking: String,
        idempotencyKey: String,
        attachments: [OpenClawChatAttachmentPayload],
    ) async throws -> OpenClawChatSendResponse {
        var params: [String: AnyCodable] = [
            "sessionKey": AnyCodable(sessionKey),
            "message": AnyCodable(message),
            "thinking": AnyCodable(thinking),
            "idempotencyKey": AnyCodable(idempotencyKey),
            "timeoutMs": AnyCodable(30_000),
        ]
        if !attachments.isEmpty {
            let payloads = attachments.map { attachment in
                [
                    "type": attachment.type,
                    "mimeType": attachment.mimeType,
                    "fileName": attachment.fileName,
                    "content": attachment.content,
                ]
            }
            params["attachments"] = AnyCodable(payloads)
        }
        return try await self.requestDecoded(method: "chat.send", params: params, timeoutMs: 30_000)
    }

    func abort(sessionKey: String, runId: String) async throws {
        _ = try await self.request(
            method: "chat.abort",
            params: [
                "sessionKey": AnyCodable(sessionKey),
                "runId": AnyCodable(runId),
            ],
            timeoutMs: 10_000)
    }

    func reset(sessionKey: String) async throws {
        _ = try await self.request(
            method: "sessions.reset",
            params: ["key": AnyCodable(sessionKey)],
            timeoutMs: 10_000)
    }

    func compact(sessionKey: String) async throws {
        _ = try await self.request(
            method: "sessions.compact",
            params: ["key": AnyCodable(sessionKey)],
            timeoutMs: 10_000)
    }

    func setSessionModel(sessionKey: String, model: String?) async throws {
        var params: [String: AnyCodable] = ["key": AnyCodable(sessionKey)]
        params["model"] = model.map(AnyCodable.init) ?? AnyCodable(NSNull())
        _ = try await self.request(method: "sessions.patch", params: params, timeoutMs: 15_000)
    }

    func setSessionThinking(sessionKey: String, thinkingLevel: String) async throws {
        _ = try await self.request(
            method: "sessions.patch",
            params: [
                "key": AnyCodable(sessionKey),
                "thinkingLevel": AnyCodable(thinkingLevel),
            ],
            timeoutMs: 15_000)
    }

    func startWhatsAppLogin(force: Bool) async throws -> WhatsAppLoginResult {
        try await self.requestDecoded(
            method: "web.login.start",
            params: [
                "force": AnyCodable(force),
                "timeoutMs": AnyCodable(30_000),
            ],
            timeoutMs: 35_000)
    }

    func waitWhatsAppLogin() async throws -> WhatsAppWaitResult {
        try await self.requestDecoded(
            method: "web.login.wait",
            params: ["timeoutMs": AnyCodable(120_000)],
            timeoutMs: 125_000)
    }

    func logout(channel: String) async throws {
        _ = try await self.request(
            method: "channels.logout",
            params: ["channel": AnyCodable(channel)],
            timeoutMs: 15_000)
    }

    private func removeSubscriber(_ id: UUID) {
        self.subscribers[id] = nil
    }

    private func handle(push: GatewayPush) {
        if case let .snapshot(snapshot) = push {
            self.lastSnapshot = snapshot
        }
        for continuation in self.subscribers.values {
            continuation.yield(push)
        }
    }
}

struct WhatsAppLoginResult: Codable {
    let qrDataUrl: String?
    let message: String
}

struct WhatsAppWaitResult: Codable {
    let connected: Bool
    let message: String
}

struct EasyModeChatTransport: OpenClawChatTransport {
    func requestHistory(sessionKey: String) async throws -> OpenClawChatHistoryPayload {
        try await EasyModeGatewayConnection.shared.chatHistory(sessionKey: sessionKey)
    }

    func listModels() async throws -> [OpenClawChatModelChoice] {
        try await EasyModeGatewayConnection.shared.listModels()
    }

    func abortRun(sessionKey: String, runId: String) async throws {
        try await EasyModeGatewayConnection.shared.abort(sessionKey: sessionKey, runId: runId)
    }

    func listSessions(limit _: Int?) async throws -> OpenClawChatSessionsListResponse {
        try await EasyModeGatewayConnection.shared.listSessions()
    }

    func setSessionModel(sessionKey: String, model: String?) async throws {
        try await EasyModeGatewayConnection.shared.setSessionModel(sessionKey: sessionKey, model: model)
    }

    func setSessionThinking(sessionKey: String, thinkingLevel: String) async throws {
        try await EasyModeGatewayConnection.shared.setSessionThinking(
            sessionKey: sessionKey,
            thinkingLevel: thinkingLevel)
    }

    func sendMessage(
        sessionKey: String,
        message: String,
        thinking: String,
        idempotencyKey: String,
        attachments: [OpenClawChatAttachmentPayload],
    ) async throws -> OpenClawChatSendResponse {
        try await EasyModeGatewayConnection.shared.sendMessage(
            sessionKey: sessionKey,
            message: message,
            thinking: thinking,
            idempotencyKey: idempotencyKey,
            attachments: attachments)
    }

    func requestHealth(timeoutMs: Int) async throws -> Bool {
        try await EasyModeGatewayConnection.shared.healthOK(timeoutMs: timeoutMs)
    }

    func resetSession(sessionKey: String) async throws {
        try await EasyModeGatewayConnection.shared.reset(sessionKey: sessionKey)
    }

    func compactSession(sessionKey: String) async throws {
        try await EasyModeGatewayConnection.shared.compact(sessionKey: sessionKey)
    }

    func events() -> AsyncStream<OpenClawChatTransportEvent> {
        AsyncStream { continuation in
            let task = Task {
                let stream = await EasyModeGatewayConnection.shared.subscribe()
                for await push in stream {
                    if Task.isCancelled {
                        return
                    }
                    if let event = Self.mapPushToTransportEvent(push) {
                        continuation.yield(event)
                    }
                }
            }
            continuation.onTermination = { @Sendable _ in
                task.cancel()
            }
        }
    }

    private static func mapPushToTransportEvent(_ push: GatewayPush) -> OpenClawChatTransportEvent? {
        switch push {
        case let .snapshot(hello):
            let ok = (try? JSONDecoder().decode(
                OpenClawGatewayHealthOK.self,
                from: JSONEncoder().encode(hello.snapshot.health)))?.ok ?? true
            return .health(ok: ok)

        case let .event(event):
            switch event.event {
            case "health":
                guard let payload = event.payload else { return nil }
                let ok = (try? JSONDecoder().decode(
                    OpenClawGatewayHealthOK.self,
                    from: JSONEncoder().encode(payload)))?.ok ?? true
                return .health(ok: ok)
            case "tick":
                return .tick
            case "chat":
                guard let payload = event.payload,
                      let chat = try? JSONDecoder().decode(
                          OpenClawChatEventPayload.self,
                          from: JSONEncoder().encode(payload))
                else {
                    return nil
                }
                return .chat(chat)
            case "agent":
                guard let payload = event.payload,
                      let agent = try? JSONDecoder().decode(
                          OpenClawAgentEventPayload.self,
                          from: JSONEncoder().encode(payload))
                else {
                    return nil
                }
                return .agent(agent)
            default:
                return nil
            }

        case .seqGap:
            return .seqGap
        }
    }
}
