import Observation
import OpenClawMacUpdates
import SwiftUI

struct EasyModeUpdateSettingsView: View {
    let updater: UpdaterProviding?
    @AppStorage("autoUpdateEnabled") private var autoUpdateEnabled = true
    @State private var didLoadUpdaterState = false
    @Bindable private var updateStatus: UpdateStatus

    init(updater: UpdaterProviding?) {
        self.updater = updater
        self._updateStatus = Bindable(wrappedValue: updater?.updateStatus ?? UpdateStatus.disabled)
    }

    var body: some View {
        GroupBox("Updates") {
            VStack(alignment: .leading, spacing: 12) {
                if let updater, updater.isAvailable {
                    Toggle("Check for updates automatically", isOn: self.$autoUpdateEnabled)
                        .toggleStyle(.checkbox)

                    Button(self.updateStatus.isUpdateReady ? "Update ready, restart now?" : "Check for Updates…") {
                        updater.checkForUpdates(nil)
                    }
                    .buttonStyle(.bordered)
                } else {
                    Text("Updates unavailable in this build.")
                        .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear {
            guard let updater, !self.didLoadUpdaterState else { return }
            updater.automaticallyChecksForUpdates = self.autoUpdateEnabled
            updater.automaticallyDownloadsUpdates = self.autoUpdateEnabled
            self.didLoadUpdaterState = true
        }
        .onChange(of: self.autoUpdateEnabled) { _, newValue in
            self.updater?.automaticallyChecksForUpdates = newValue
            self.updater?.automaticallyDownloadsUpdates = newValue
        }
    }
}
