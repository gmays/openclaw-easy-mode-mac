import AppKit
import Observation
import OpenClawChatUI
import SwiftUI

struct EasyModeRootView: View {
    @Bindable var runtimeManager: EasyModeRuntimeManager
    @Bindable var accessStore: EasyModeAccessStore
    @State private var selectedTab: EasyModeTab = .chat
    @State private var chatViewModel: OpenClawChatViewModel?
    @State private var telegramDraft: String = EasyModeConfigFile.telegramBotToken()

    var body: some View {
        TabView(selection: self.$selectedTab) {
            self.chatTab
                .tabItem { Label("Chat", systemImage: "message") }
                .tag(EasyModeTab.chat)

            self.accessTab
                .tabItem { Label("Access", systemImage: "folder.badge.plus") }
                .tag(EasyModeTab.access)

            self.servicesTab
                .tabItem { Label("Connected Services", systemImage: "link") }
                .tag(EasyModeTab.services)

            self.settingsTab
                .tabItem { Label("Settings", systemImage: "gearshape") }
                .tag(EasyModeTab.settings)

            self.exportTab
                .tabItem { Label("Export", systemImage: "square.and.arrow.up") }
                .tag(EasyModeTab.export)
        }
        .frame(minWidth: 960, minHeight: 720)
        .padding(20)
        .task(id: self.runtimeManager.isRunning) {
            if self.runtimeManager.isRunning {
                let sessionKey = await EasyModeGatewayConnection.shared.mainSessionKey()
                self.chatViewModel = OpenClawChatViewModel(
                    sessionKey: sessionKey,
                    transport: EasyModeChatTransport(),
                    initialThinkingLevel: "default",
                    onThinkingLevelChanged: { _ in })
            } else {
                self.chatViewModel = nil
            }
        }
    }

    private var chatTab: some View {
        Group {
            if let chatViewModel {
                OpenClawChatView(
                    viewModel: chatViewModel,
                    showsSessionSwitcher: false,
                    userAccent: Color.orange)
            } else {
                ContentUnavailableView(
                    "Gateway Starting",
                    systemImage: "message.badge.circle",
                    description: Text("Start Easy Mode to open chat."))
            }
        }
    }

    private var accessTab: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Chat only is the default. Add folders here when you want OpenClaw Easy Mode to read or edit files outside its workspace.")
                .foregroundStyle(.secondary)
            HStack(spacing: 12) {
                Button("Grant Folder Access") {
                    self.accessStore.addFolderGrant()
                }
                .buttonStyle(.borderedProminent)
                Text("Workspace: \(EasyModeProduct.workspaceURL.path)")
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
            }
            List {
                Section("Granted Folders") {
                    if self.accessStore.grants.isEmpty {
                        Text("No additional folders granted.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(self.accessStore.grants) { grant in
                            HStack {
                                Text(grant.path)
                                Spacer()
                                Button("Remove") {
                                    self.accessStore.removeGrant(grant)
                                }
                                .buttonStyle(.bordered)
                            }
                        }
                    }
                }
            }
            if let error = self.accessStore.lastError {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
    }

    private var servicesTab: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                GroupBox("ChatGPT/Codex") {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(self.runtimeManager.authStatus)
                            .foregroundStyle(.secondary)
                        Button("Sign In With ChatGPT/Codex") {
                            Task {
                                await self.runtimeManager.signInWithCodex()
                            }
                        }
                        .buttonStyle(.borderedProminent)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }

                GroupBox("WhatsApp") {
                    VStack(alignment: .leading, spacing: 12) {
                        if let message = self.runtimeManager.whatsappMessage {
                            Text(message)
                                .foregroundStyle(.secondary)
                        }
                        if let qrDataUrl = self.runtimeManager.whatsappQrDataUrl,
                           let image = Self.qrImage(from: qrDataUrl)
                        {
                            Image(nsImage: image)
                                .resizable()
                                .interpolation(.none)
                                .frame(width: 180, height: 180)
                                .clipShape(RoundedRectangle(cornerRadius: 12))
                        }
                        HStack(spacing: 12) {
                            Button("Show QR") {
                                Task {
                                    await self.runtimeManager.startWhatsAppLogin(force: false)
                                }
                            }
                            .buttonStyle(.borderedProminent)
                            Button("Relink") {
                                Task {
                                    await self.runtimeManager.startWhatsAppLogin(force: true)
                                }
                            }
                            .buttonStyle(.bordered)
                            Button("Logout") {
                                Task {
                                    await self.runtimeManager.logout(channel: "whatsapp")
                                }
                            }
                            .buttonStyle(.bordered)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }

                GroupBox("Telegram") {
                    VStack(alignment: .leading, spacing: 12) {
                        SecureField("Bot token", text: self.$telegramDraft)
                            .textFieldStyle(.roundedBorder)
                        HStack(spacing: 12) {
                            Button("Save Bot Token") {
                                self.runtimeManager.saveTelegramToken(self.telegramDraft)
                            }
                            .buttonStyle(.borderedProminent)
                            Button("Logout") {
                                Task {
                                    await self.runtimeManager.logout(channel: "telegram")
                                    self.telegramDraft = ""
                                }
                            }
                            .buttonStyle(.bordered)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }

    private var settingsTab: some View {
        VStack(alignment: .leading, spacing: 16) {
            GroupBox("Runtime") {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Status: \(self.runtimeManager.status.label)")
                    Text("State: \(EasyModeProduct.stateDirURL.path)")
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                    Text("Config: \(EasyModeProduct.configURL.path)")
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                    HStack(spacing: 12) {
                        Button("Restart Runtime") {
                            Task {
                                await self.runtimeManager.restart(accessStore: self.accessStore)
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        Button("Reload Telegram Token") {
                            self.runtimeManager.reloadTelegramToken()
                            self.telegramDraft = self.runtimeManager.telegramToken
                        }
                        .buttonStyle(.bordered)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            if let error = self.runtimeManager.lastError {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
            }

            if !self.runtimeManager.gatewayLog.isEmpty {
                ScrollView {
                    Text(self.runtimeManager.gatewayLog)
                        .font(.system(.caption, design: .monospaced))
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxHeight: 220)
                .background(Color.secondary.opacity(0.08))
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
        }
    }

    private var exportTab: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Export your Easy Mode workspace, settings, and supported connector config so full OpenClaw can pick it up later.")
                .foregroundStyle(.secondary)
            Button("Export Easy Mode Bundle") {
                self.runtimeManager.exportBundle(accessStore: self.accessStore)
            }
            .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private static func qrImage(from dataUrl: String) -> NSImage? {
        guard let commaIndex = dataUrl.firstIndex(of: ",") else {
            return nil
        }
        let base64 = String(dataUrl[dataUrl.index(after: commaIndex)...])
        guard let data = Data(base64Encoded: base64) else {
            return nil
        }
        return NSImage(data: data)
    }
}

enum EasyModeTab: Hashable {
    case chat
    case access
    case services
    case settings
    case export
}
