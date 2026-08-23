import Capacitor
import Foundation
import Security

@objc(CodeBlackSecureCredentialsPlugin)
public class CodeBlackSecureCredentialsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CodeBlackSecureCredentialsPlugin"
    public let jsName = "CodeBlackSecureCredentials"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setCredential", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getCredential", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteCredential", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hasCredential", returnType: CAPPluginReturnPromise)
    ]

    private let service = "com.codeblackwx.ops.secureCredentials"
    private let allowedKeys: Set<String> = [
        "spotter-network.password",
        "vehicle-node.command-token",
        "live-overlay.station-token"
    ]

    @objc func setCredential(_ call: CAPPluginCall) {
        guard let key = normalizedKey(call.getString("key")) else {
            call.reject("Unknown credential key.")
            return
        }
        let value = call.getString("value") ?? ""
        guard let data = value.data(using: .utf8) else {
            call.reject("Credential could not be stored securely.")
            return
        }
        SecItemDelete(query(for: key) as CFDictionary)
        var attributes = query(for: key)
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(attributes as CFDictionary, nil)
        guard status == errSecSuccess else {
            call.reject("Credential could not be stored securely.")
            return
        }
        call.resolve()
    }

    @objc func getCredential(_ call: CAPPluginCall) {
        guard let key = normalizedKey(call.getString("key")) else {
            call.reject("Unknown credential key.")
            return
        }
        var attributes = query(for: key)
        attributes[kSecReturnData as String] = true
        attributes[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(attributes as CFDictionary, &item)
        if status == errSecItemNotFound {
            call.resolve(["value": NSNull()])
            return
        }
        guard status == errSecSuccess, let data = item as? Data, let value = String(data: data, encoding: .utf8) else {
            call.reject("Credential could not be read securely.")
            return
        }
        call.resolve(["value": value])
    }

    @objc func deleteCredential(_ call: CAPPluginCall) {
        guard let key = normalizedKey(call.getString("key")) else {
            call.reject("Unknown credential key.")
            return
        }
        SecItemDelete(query(for: key) as CFDictionary)
        call.resolve()
    }

    @objc func hasCredential(_ call: CAPPluginCall) {
        guard let key = normalizedKey(call.getString("key")) else {
            call.reject("Unknown credential key.")
            return
        }
        var attributes = query(for: key)
        attributes[kSecReturnData as String] = false
        attributes[kSecMatchLimit as String] = kSecMatchLimitOne
        let status = SecItemCopyMatching(attributes as CFDictionary, nil)
        call.resolve(["value": status == errSecSuccess])
    }

    private func normalizedKey(_ key: String?) -> String? {
        guard let key = key, allowedKeys.contains(key) else {
            return nil
        }
        return key
    }

    private func query(for key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key
        ]
    }
}
