import Foundation

enum JSONValue: Codable {
    case string(String), number(Double), bool(Bool), object([String: JSONValue]), array([JSONValue]), null
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let x = try? c.decode(Bool.self) { self = .bool(x) }
        else if let x = try? c.decode(Double.self) { self = .number(x) }
        else if let x = try? c.decode(String.self) { self = .string(x) }
        else if let x = try? c.decode([String: JSONValue].self) { self = .object(x) }
        else { self = .array(try c.decode([JSONValue].self)) }
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let x): try c.encode(x)
        case .number(let x): try c.encode(x)
        case .bool(let x): try c.encode(x)
        case .object(let x): try c.encode(x)
        case .array(let x): try c.encode(x)
        case .null: try c.encodeNil()
        }
    }
}
struct CloudSession: Codable { let owner: String; let email: String; var accessToken: String; var refreshToken: String; var expiresAt: Double }
struct PlannerSnapshot: Codable { var todayIso: String; var today: DayPlan; var gymSession: GymSession }
struct DayPlan: Codable { var date: String; var blocks: [PlanBlock] }
struct PlanBlock: Codable, Identifiable {
    var id: String; var title: String; var category: String; var startMinute: Int; var endMinute: Int; var done: Bool
    var disposition: String?
    var active: Bool { disposition != "deferred" }
    var time: String { String(format: "%02d:%02d", startMinute / 60, startMinute % 60) }
}
struct GymSession: Codable { var date: String; var items: [GymItem] }
struct GymItem: Codable, Identifiable { var id: String; var name: String; var reps: String; var weight: String; var actualSets: [GymSet]? }
struct GymSet: Codable, Identifiable { var id: String; var reps: Int; var weight: Double?; var unit: String? }
struct PendingOperation: Codable, Identifiable {
    var id: String = UUID().uuidString
    let owner: String; let endpoint: String; let payload: [String: JSONValue]
    let createdAt: Date
    init(owner: String, endpoint: String, payload: [String: JSONValue]) { self.owner = owner; self.endpoint = endpoint; self.payload = payload; createdAt = Date() }
}
struct WatchCache: Codable { var owner: String; var snapshot: PlannerSnapshot?; var pending: [PendingOperation] }
struct RPCError: Codable { let message: String }
struct Envelope<T: Decodable>: Decodable { let ok: Bool; let value: T?; let error: RPCError?; let revision: Int? }
struct JobID: Decodable { let id: String }
enum PlannerError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let text) = self { return text }; return nil }
}
