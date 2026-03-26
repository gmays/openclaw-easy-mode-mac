import AppKit
import OpenClawMacUpdates
import SwiftUI

@main
struct OpenClawEasyModeMacApp: App {
    @State private var runtimeManager = EasyModeRuntimeManager()
    @State private var accessStore = EasyModeAccessStore()
    private let updaterController: UpdaterProviding = makeUpdaterController()

    var body: some Scene {
        WindowGroup(EasyModeProduct.displayName) {
            EasyModeRootView(
                runtimeManager: self.runtimeManager,
                accessStore: self.accessStore,
                updater: self.updaterController)
                .task {
                    await self.runtimeManager.start(accessStore: self.accessStore)
                }
        }
        .defaultSize(width: 1040, height: 760)
        .commands {
            CommandGroup(replacing: .newItem) {}
            CommandGroup(after: .appInfo) {
                Button("Check for Updates…") {
                    self.updaterController.checkForUpdates(nil)
                }
                .disabled(!self.updaterController.isAvailable)
            }
        }
    }
}
