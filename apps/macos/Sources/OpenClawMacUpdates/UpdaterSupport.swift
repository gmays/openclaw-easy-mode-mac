import AppKit
import Foundation
import Observation
import Security

@MainActor
public protocol UpdaterProviding: AnyObject {
    var automaticallyChecksForUpdates: Bool { get set }
    var automaticallyDownloadsUpdates: Bool { get set }
    var isAvailable: Bool { get }
    var updateStatus: UpdateStatus { get }
    func checkForUpdates(_ sender: Any?)
}

@MainActor
public final class DisabledUpdaterController: UpdaterProviding {
    public var automaticallyChecksForUpdates: Bool = false
    public var automaticallyDownloadsUpdates: Bool = false
    public let isAvailable: Bool = false
    public let updateStatus = UpdateStatus()

    public init() {}

    public func checkForUpdates(_: Any?) {}
}

@MainActor
@Observable
public final class UpdateStatus {
    public static let disabled = UpdateStatus()
    public var isUpdateReady: Bool

    public init(isUpdateReady: Bool = false) {
        self.isUpdateReady = isUpdateReady
    }
}

#if canImport(Sparkle)
import Sparkle

@MainActor
public final class SparkleUpdaterController: NSObject, UpdaterProviding {
    private lazy var controller = SPUStandardUpdaterController(
        startingUpdater: false,
        updaterDelegate: self,
        userDriverDelegate: nil)

    public let updateStatus = UpdateStatus()

    public init(savedAutoUpdate: Bool) {
        super.init()
        let updater = self.controller.updater
        updater.automaticallyChecksForUpdates = savedAutoUpdate
        updater.automaticallyDownloadsUpdates = savedAutoUpdate
        self.controller.startUpdater()
    }

    public var automaticallyChecksForUpdates: Bool {
        get { self.controller.updater.automaticallyChecksForUpdates }
        set { self.controller.updater.automaticallyChecksForUpdates = newValue }
    }

    public var automaticallyDownloadsUpdates: Bool {
        get { self.controller.updater.automaticallyDownloadsUpdates }
        set { self.controller.updater.automaticallyDownloadsUpdates = newValue }
    }

    public var isAvailable: Bool {
        true
    }

    public func checkForUpdates(_ sender: Any?) {
        self.controller.checkForUpdates(sender)
    }

    public func updater(_ updater: SPUUpdater, didDownloadUpdate item: SUAppcastItem) {
        self.updateStatus.isUpdateReady = true
    }

    public func updater(_ updater: SPUUpdater, failedToDownloadUpdate item: SUAppcastItem, error: Error) {
        self.updateStatus.isUpdateReady = false
    }

    public func userDidCancelDownload(_ updater: SPUUpdater) {
        self.updateStatus.isUpdateReady = false
    }

    public func updater(
        _ updater: SPUUpdater,
        userDidMakeChoice choice: SPUUserUpdateChoice,
        forUpdate updateItem: SUAppcastItem,
        state: SPUUserUpdateState)
    {
        switch choice {
        case .install, .skip:
            self.updateStatus.isUpdateReady = false
        case .dismiss:
            self.updateStatus.isUpdateReady = (state.stage == .downloaded)
        @unknown default:
            self.updateStatus.isUpdateReady = false
        }
    }
}

extension SparkleUpdaterController: SPUUpdaterDelegate {}
#endif

private func isDeveloperIDSigned(bundleURL: URL) -> Bool {
    var staticCode: SecStaticCode?
    guard SecStaticCodeCreateWithPath(bundleURL as CFURL, SecCSFlags(), &staticCode) == errSecSuccess,
          let code = staticCode
    else { return false }

    var infoCF: CFDictionary?
    guard SecCodeCopySigningInformation(code, SecCSFlags(rawValue: kSecCSSigningInformation), &infoCF) == errSecSuccess,
          let info = infoCF as? [String: Any],
          let certs = info[kSecCodeInfoCertificates as String] as? [SecCertificate],
          let leaf = certs.first
    else {
        return false
    }

    if let summary = SecCertificateCopySubjectSummary(leaf) as String? {
        return summary.hasPrefix("Developer ID Application:")
    }
    return false
}

@MainActor
public func makeUpdaterController(autoUpdateKey: String = "autoUpdateEnabled") -> UpdaterProviding {
    let bundleURL = Bundle.main.bundleURL
    let isBundledApp = bundleURL.pathExtension == "app"
    guard isBundledApp, isDeveloperIDSigned(bundleURL: bundleURL) else {
        return DisabledUpdaterController()
    }

    #if canImport(Sparkle)
    let defaults = UserDefaults.standard
    let savedAutoUpdate = (defaults.object(forKey: autoUpdateKey) as? Bool) ?? true
    return SparkleUpdaterController(savedAutoUpdate: savedAutoUpdate)
    #else
    return DisabledUpdaterController()
    #endif
}
