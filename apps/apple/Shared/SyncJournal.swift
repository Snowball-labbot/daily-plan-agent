import Foundation

extension JSONValue {
    var stringValue: String? { if case .string(let value) = self { return value }; return nil }
    var numberValue: Double? { if case .number(let value) = self { return value }; return nil }
    var boolValue: Bool? { if case .bool(let value) = self { return value }; return nil }
    var objectValue: [String: JSONValue]? { if case .object(let value) = self { return value }; return nil }
}

/// The same journal is used on iPhone and Watch. A snapshot never erases an
/// unacknowledged edit, and an acknowledgement is scoped to its account.
extension WatchCache {
    mutating func enqueue(_ operation: PendingOperation) throws {
        guard !owner.isEmpty, operation.owner == owner else {
            throw PlannerError.message("补记属于另一个账号，请切回原账号同步")
        }
        let agent = operation.endpoint == "workflow.start" && operation.payload["clientRequestId"]?.stringValue == operation.id &&
            ["review", "plan"].contains(operation.payload["mode"]?.stringValue ?? "") &&
            operation.payload["apply"]?.boolValue == true &&
            !(operation.payload["text"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
        guard ["plan.block.toggle", "gym.set.log"].contains(operation.endpoint) || agent else {
            throw PlannerError.message("此操作不能离线补记")
        }
        if !pending.contains(where: { $0.id == operation.id }) { pending.append(operation) }
        if agent, !(updates ?? []).contains(where: { $0.id == operation.id }) {
            updates = (updates ?? []) + [AgentUpdate(id: operation.id, text: operation.payload["text"]?.stringValue ?? "", phase: "queued", summary: "待手机联网后整理", createdAt: operation.createdAt)]
        }
        overlayPending()
    }

    mutating func reconcile(_ incoming: WatchCache) throws {
        guard incoming.owner == owner || pending.isEmpty else {
            throw PlannerError.message("还有旧账号补记，请先在原账号完成同步")
        }
        if incoming.owner == owner, let old = revision, let next = incoming.revision, next < old { return }
        let sameOwner = incoming.owner == owner
        let retained = sameOwner ? pending : []
        let oldUpdates = sameOwner ? (updates ?? []) : []
        let draft = sameOwner ? agentDraft : nil
        owner = incoming.owner
        snapshot = incoming.snapshot
        revision = incoming.revision
        pending = retained
        updates = incoming.updates ?? []
        for update in oldUpdates where !(updates ?? []).contains(where: { $0.id == update.id }) { updates?.append(update) }
        updates = Array((updates ?? []).sorted(by: { $0.createdAt > $1.createdAt }).prefix(30))
        agentDraft = draft
        overlayPending()
    }

    mutating func acknowledge(_ id: String, owner account: String, revision incoming: Int? = nil) {
        guard account == owner else { return }
        pending.removeAll(where: { $0.id == id })
        if let incoming { revision = max(revision ?? incoming, incoming) }
    }

    private mutating func overlayPending() {
        for operation in pending where operation.owner == owner {
            let payload = operation.payload
            if operation.endpoint == "plan.block.toggle",
               payload["date"]?.stringValue == snapshot?.today.date,
               let id = payload["blockId"]?.stringValue,
               let done = payload["done"]?.boolValue,
               let index = snapshot?.today.blocks.firstIndex(where: { $0.id == id }) {
                snapshot?.today.blocks[index].done = done
            }
            if operation.endpoint == "plan.block.toggle", let date = payload["date"]?.stringValue,
               let id = payload["blockId"]?.stringValue, let done = payload["done"]?.boolValue,
               let day = snapshot?.week?.firstIndex(where: { $0.date == date }),
               let block = snapshot?.week?[day].blocks.firstIndex(where: { $0.id == id }) {
                snapshot?.week?[day].blocks[block].done = done
            }
            if operation.endpoint == "gym.set.log",
               payload["date"]?.stringValue == snapshot?.gymSession.date,
               let id = payload["itemId"]?.stringValue,
               let requestID = payload["requestId"]?.stringValue,
               let set = payload["set"]?.objectValue,
               let reps = set["reps"]?.numberValue,
               reps.isFinite, reps >= 1, reps <= 500, reps.rounded() == reps,
               let index = snapshot?.gymSession.items.firstIndex(where: { $0.id == id }) {
                let logged = GymSet(id: requestID, reps: Int(reps), weight: set["weight"]?.numberValue,
                                    unit: set["unit"]?.stringValue ?? "kg")
                var sets = snapshot?.gymSession.items[index].actualSets ?? []
                if let existing = sets.firstIndex(where: { $0.id == requestID }) { sets[existing] = logged }
                else { sets.append(logged) }
                snapshot?.gymSession.items[index].actualSets = sets
            }
        }
    }
}

extension PendingOperation {
    static func agent(owner: String, text: String, mode: String, date: String) throws -> PendingOperation {
        let formatter = DateFormatter(); formatter.calendar = Calendar(identifier: .iso8601)
        formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"
        guard let today = formatter.date(from: date), formatter.string(from: today) == date else { throw PlannerError.message("先同步今天的日程再提交") }
        var calendar = Calendar(identifier: .iso8601); calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let day = calendar.component(.weekday, from: today)
        let end = calendar.date(byAdding: .day, value: (8 - day) % 7, to: today)!
        let id = UUID().uuidString
        return PendingOperation(id: id, owner: owner, endpoint: "workflow.start", payload: [
            "clientRequestId": .string(id), "text": .string(text), "mode": .string(mode),
            "apply": .bool(true), "replaceConflicts": .bool(true), "rangeStart": .string(date), "rangeEnd": .string(date),
            "planStart": .string(date), "planEnd": .string(formatter.string(from: end))
        ], createdAt: Date())
    }
}

enum PlannerDates {
    static func today() -> String {
        let formatter = DateFormatter(); formatter.calendar = Calendar(identifier: .iso8601)
        formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = TimeZone(identifier: "Asia/Shanghai")
        formatter.dateFormat = "yyyy-MM-dd"; return formatter.string(from: Date())
    }
}
