import AppKit
import SwiftUI

@main
struct OpenClawEasyModeMacApp: App {
    @State private var runtimeManager = EasyModeRuntimeManager()
    @State private var accessStore = EasyModeAccessStore()

    var body: some Scene {
        WindowGroup(EasyModeProduct.displayName) {
            EasyModeRootView(
                runtimeManager: self.runtimeManager,
                accessStore: self.accessStore)
                .task {
                    await self.runtimeManager.start(accessStore: self.accessStore)
                }
        }
        .defaultSize(width: 1040, height: 760)
        .commands {
            CommandGroup(replacing: .newItem) {}
        }
    }
}
