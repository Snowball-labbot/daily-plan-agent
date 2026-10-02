import Foundation
import Security

final class APIClient {
    var base: URL
    var session: CloudSession?
    var revision: Int?
    init(base: URL) { self.base = base; session = try? Self.loadSession() }
    static let keychainService = "com.snowball.dailyplan.session"
    static func loadSession() throws -> CloudSession {
        var output: CFTypeRef?
        let query: [String: Any] = [kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:keychainService,kSecReturnData as String:true,kSecMatchLimit as String:kSecMatchLimitOne]
        guard SecItemCopyMatching(query as CFDictionary, &output) == errSecSuccess, let data = output as? Data else { throw PlannerError.message("请登录") }
        return try JSONDecoder().decode(CloudSession.self, from:data)
    }
    func saveSession() throws {
        let key: [String: Any] = [kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:Self.keychainService]
        SecItemDelete(key as CFDictionary)
        if let session {
            let fields = key.merging([kSecValueData as String:try JSONEncoder().encode(session),kSecAttrAccessible as String:kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]) { _, new in new }
            guard SecItemAdd(fields as CFDictionary,nil) == errSecSuccess else { throw PlannerError.message("无法保存安全登录信息") }
        }
    }
    private func post<T: Decodable>(_ route: String, body: [String: Any], authenticated: Bool = true) async throws -> Envelope<T> {
        guard base.scheme == "https" else { throw PlannerError.message("网站需要 HTTPS") }
        var request = URLRequest(url:base.appendingPathComponent(route)); request.httpMethod = "POST"; request.timeoutInterval = 30
        request.setValue("application/json",forHTTPHeaderField:"Content-Type")
        if authenticated { guard let session else { throw PlannerError.message("请登录") }; request.setValue("Bearer \(session.accessToken)",forHTTPHeaderField:"Authorization") }
        request.httpBody = try JSONSerialization.data(withJSONObject:body)
        let (data, _) = try await URLSession.shared.data(for:request)
        let response = try JSONDecoder().decode(Envelope<T>.self,from:data)
        guard response.ok else { throw PlannerError.message(response.error?.message ?? "请求失败，补记保留在本机") }
        if let value = response.revision { revision = value }
        return response
    }
    func login(email: String,password: String) async throws {
        let result: Envelope<CloudSession> = try await post("api/device/session",body:["email":email,"password":password],authenticated:false)
        session=result.value; try saveSession()
    }
    private func refreshToken() async throws {
        guard let stored=session else { throw PlannerError.message("请登录") }
        if stored.expiresAt > Date().timeIntervalSince1970+90 { return }
        let result: Envelope<CloudSession> = try await post("api/device/session",body:["refreshToken":stored.refreshToken],authenticated:false)
        session=result.value;try saveSession()
    }
    func rpc<T: Decodable>(_ endpoint: String,payload: [String: JSONValue] = [:],operation: String = UUID().uuidString) async throws -> T {
        try await refreshToken()
        let raw=try JSONSerialization.jsonObject(with:JSONEncoder().encode(payload))
        var body: [String:Any] = ["endpoint":endpoint,"payload":raw,"operationId":operation]
        if let revision { body["expectedRevision"]=revision }
        let result: Envelope<T> = try await post("api/rpc",body:body)
        guard let value=result.value else { throw PlannerError.message("服务器结果不完整") }; return value
    }
    func logout() throws { session=nil;revision=nil;try saveSession() }
}
