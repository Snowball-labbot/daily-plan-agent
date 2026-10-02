import Foundation
import Security

struct SavedLogin: Codable { let email: String; let password: String }

@MainActor final class APIClient {
    let base: URL
    var session: CloudSession?
    var revision: Int?
    private var tail: Task<Void, Never>?
    private var scope: String { "com.snowball.dailyplan.\(base.absoluteString)" }
    init(base: URL) { self.base = base; session = try? readSecret("session", as: CloudSession.self) }
    private func readSecret<T: Decodable>(_ name: String, as type: T.Type) throws -> T {
        var output: CFTypeRef?
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: scope, kSecAttrAccount as String: name,
            kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        guard SecItemCopyMatching(query as CFDictionary, &output) == errSecSuccess,
              let data = output as? Data else { throw PlannerError.message("请登录") }
        return try JSONDecoder().decode(type, from: data)
    }
    private func writeSecret<T: Encodable>(_ name: String, value: T?) throws {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: scope, kSecAttrAccount as String: name]
        guard let value else { SecItemDelete(query as CFDictionary); return }
        let attributes: [String: Any] = [kSecValueData as String: try JSONEncoder().encode(value),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let updated = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if updated == errSecItemNotFound {
            guard SecItemAdd(query.merging(attributes) { _, new in new } as CFDictionary, nil) == errSecSuccess else { throw PlannerError.message("无法保存安全登录信息") }
        } else if updated != errSecSuccess { throw PlannerError.message("无法更新安全登录信息") }
    }
    func savedLogin() -> SavedLogin? { try? readSecret("password", as: SavedLogin.self) }
    func remember(email: String, password: String, enabled: Bool) throws {
        try writeSecret("password", value: enabled ? SavedLogin(email: email, password: password) : nil)
    }
    func saveSession() throws { try writeSecret("session", value: session) }
    private func post<T: Decodable>(_ route: String, body: [String: Any], authenticated: Bool = true) async throws -> Envelope<T> {
        guard base.scheme == "https" else { throw PlannerError.message("网站需要 HTTPS") }
        var request = URLRequest(url: base.appendingPathComponent(route)); request.httpMethod = "POST"; request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if authenticated {
            guard let session else { throw PlannerError.message("请登录") }
            request.setValue("Bearer \(session.accessToken)", forHTTPHeaderField: "Authorization")
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, http) = try await URLSession.shared.data(for: request)
        guard let response = try? JSONDecoder().decode(Envelope<T>.self, from: data) else { throw PlannerError.message("服务器响应异常，文字和补记已保留") }
        guard response.ok, (http as? HTTPURLResponse)?.statusCode == 200 else { throw PlannerError.message(response.error?.message ?? "请求失败，补记保留在本机") }
        if let value = response.revision { revision = value }
        return response
    }
    func login(email: String, password: String) async throws {
        let result: Envelope<CloudSession> = try await post("api/device/session", body: ["email": email, "password": password], authenticated: false)
        guard let value = result.value else { throw PlannerError.message("登录结果不完整") }; session = value
    }
    private func refreshToken() async throws {
        guard let stored = session else { throw PlannerError.message("请登录") }
        if stored.expiresAt > Date().timeIntervalSince1970 + 90 { return }
        let result: Envelope<CloudSession> = try await post("api/device/session", body: ["refreshToken": stored.refreshToken], authenticated: false)
        guard let value = result.value, value.owner == stored.owner else { throw PlannerError.message("登录已过期，请重新登录原账号") }
        session = value; try saveSession()
    }
    func rpc<T: Decodable>(_ endpoint: String, payload: [String: JSONValue] = [:], operation: String = UUID().uuidString) async throws -> T {
        let previous = tail
        let task = Task { @MainActor () throws -> T in
            await previous?.value
            try await self.refreshToken()
            let raw = try JSONSerialization.jsonObject(with: JSONEncoder().encode(payload))
            var body: [String: Any] = ["endpoint": endpoint, "payload": raw, "operationId": operation]
            if let revision = self.revision { body["expectedRevision"] = revision }
            let result: Envelope<T> = try await self.post("api/rpc", body: body)
            guard let value = result.value else { throw PlannerError.message("服务器结果不完整") }; return value
        }
        tail = Task { _ = try? await task.value }
        return try await task.value
    }
    func logout() throws { session = nil; revision = nil; try saveSession() }
}
