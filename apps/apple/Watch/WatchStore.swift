import Foundation
import SwiftUI
import WatchConnectivity

@MainActor final class WatchStore: NSObject, ObservableObject, WCSessionDelegate {
    @Published var cache = WatchCache(owner: "", snapshot: nil, pending: [])
    @Published var message = "先在 iPhone 登录并同步"
    private var url: URL { FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("planner-watch.json") }
    override init() {
        super.init()
        if let data = try? Data(contentsOf: url), let saved = try? JSONDecoder().decode(WatchCache.self, from: data) { cache = saved }
        WCSession.default.delegate = self; WCSession.default.activate()
    }
    @discardableResult private func persist() -> Bool {
        do {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try JSONEncoder().encode(cache).write(to: url, options: .atomic); return true
        } catch { message = "缓存未保存，请先保持连接"; return false }
    }
    func saveDraft(_ text: String) { cache.agentDraft = text; persist() }
    private func enqueue(_ operation: PendingOperation) -> Bool {
        do {
            try cache.enqueue(operation); guard persist() else { return false }; send(operation)
            message = "已记录 · 待手机同步 \(cache.pending.count) 项"; return true
        } catch { message = error.localizedDescription; return false }
    }
    private func send(_ operation: PendingOperation) {
        guard WCSession.default.activationState == .activated else { return }
        guard !WCSession.default.outstandingUserInfoTransfers.contains(where: { $0.userInfo["operationId"] as? String == operation.id }) else { return }
        if let data = try? JSONEncoder().encode(operation) { WCSession.default.transferUserInfo(["operation": data, "operationId": operation.id]) }
    }
    func refresh() {
        guard WCSession.default.activationState == .activated else { message = "正在连接手机"; return }
        for operation in cache.pending { send(operation) }
        WCSession.default.transferUserInfo(["refresh": true]); message = "已请求手机同步"
    }
    func toggle(_ block: PlanBlock, date: String? = nil) {
        guard let day = date ?? cache.snapshot?.todayIso else { return }
        _ = enqueue(PendingOperation(owner: cache.owner, endpoint: "plan.block.toggle", payload: ["date": .string(day), "blockId": .string(block.id), "done": .bool(!block.done)]))
    }
    func log(_ item: GymItem, weight: Double, reps: Int) {
        guard let date = cache.snapshot?.gymSession.date else { return }
        _ = enqueue(PendingOperation(owner: cache.owner, endpoint: "gym.set.log", payload: ["date": .string(date), "itemId": .string(item.id), "requestId": .string(UUID().uuidString),
            "set": .object(["reps": .number(Double(reps)), "weight": .number(weight), "unit": .string("kg")])]))
    }
    @discardableResult func tell(_ text: String, mode: String) -> Bool {
        guard !cache.owner.isEmpty else { message = "先在手机登录"; return false }
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty, clean.count <= 30000 else { message = "先说说你的变化或近况"; return false }
        do {
            let accepted = enqueue(try PendingOperation.agent(owner: cache.owner, text: clean, mode: mode, date: PlannerDates.today()))
            if accepted { cache.agentDraft = clean; persist(); message = "文字已保留，联网后 Agnes 会自动整理" }
            return accepted
        } catch { message = error.localizedDescription; return false }
    }
    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        Task { @MainActor in for item in self.cache.pending { self.send(item) } }
    }
    nonisolated func sessionReachabilityDidChange(_ session: WCSession) { Task { @MainActor in if session.isReachable { self.refresh() } } }
    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        guard let data = applicationContext["cache"] as? Data, let incoming = try? JSONDecoder().decode(WatchCache.self, from: data) else { return }
        Task { @MainActor in
            do { try self.cache.reconcile(incoming); self.persist(); self.message = self.cache.pending.isEmpty ? "已同步" : "已同步 · 待上传 \(self.cache.pending.count) 项" }
            catch { self.message = error.localizedDescription }
        }
    }
    nonisolated func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
        guard let id = userInfo["ack"] as? String, let owner = userInfo["owner"] as? String else { return }
        let revision = userInfo["revision"] as? Int
        Task { @MainActor in self.cache.acknowledge(id, owner: owner, revision: revision); self.persist(); self.message = "待手机同步 \(self.cache.pending.count) 项" }
    }
}
