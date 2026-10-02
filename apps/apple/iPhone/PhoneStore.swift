import Foundation
import SwiftUI
import WatchConnectivity
import Network

@MainActor final class PhoneStore: ObservableObject {
    @Published var cache = WatchCache(owner: "", snapshot: nil, pending: [])
    @Published var message = ""
    @Published var signedIn = false
    @Published var busy = false
    var snapshot: PlannerSnapshot? { cache.snapshot }
    private var syncing = false
    private let bridge = PhoneConnectivity()
    private let monitor = NWPathMonitor()
    private var polling: Task<Void, Never>?
    var api: APIClient
    private var cacheURL: URL {
        let host = (api.base.host ?? "unknown").replacingOccurrences(of: ":", with: "_")
        return FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("planner-\(host)-\(cache.owner).json")
    }
    init() {
        let base = URL(string: UserDefaults.standard.string(forKey: "planner-url") ?? "https://example.invalid")!
        api = APIClient(base: base); signedIn = api.session != nil; cache.owner = api.session?.owner ?? ""
        restore()
        bridge.onOperation = { [weak self] item in Task { @MainActor in await self?.receive(item) } }
        bridge.onReady = { [weak self] in Task { @MainActor in self?.publish() } }
        bridge.onRefresh = { [weak self] in Task { @MainActor in await self?.sync() } }
        bridge.activate()
        monitor.pathUpdateHandler = { [weak self] path in if path.status == .satisfied { Task { @MainActor in await self?.sync() } } }
        monitor.start(queue: DispatchQueue(label: "daily-plan-network"))
    }
    private func restore() {
        if let data = try? Data(contentsOf: cacheURL), let saved = try? JSONDecoder().decode(WatchCache.self, from: data), saved.owner == cache.owner { cache = saved }
    }
    @discardableResult private func persist() -> Bool {
        guard !cache.owner.isEmpty else { return false }
        do {
            try FileManager.default.createDirectory(at: cacheURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try JSONEncoder().encode(cache).write(to: cacheURL, options: .atomic); return true
        } catch { message = "本机缓存保存失败，暂不要关闭应用"; return false }
    }
    func login(url: String, email: String, password: String, remember: Bool) async {
        guard let base = URL(string: url.trimmingCharacters(in: .whitespacesAndNewlines)), base.scheme == "https",
              base.host != nil, base.user == nil, base.password == nil, ["", "/"].contains(base.path), base.query == nil, base.fragment == nil else { message = "请输入 HTTPS 网站根网址"; return }
        guard !syncing else { message = "正在同步补记，请稍后重新登录"; return }
        busy = true; defer { busy = false }
        do {
            let candidate = APIClient(base: base); try await candidate.login(email: email, password: password)
            guard cache.pending.isEmpty || (cache.owner == candidate.session?.owner && api.base == base) else { throw PlannerError.message("还有旧账号或网站的补记，请先同步再切换") }
            try candidate.saveSession(); try candidate.remember(email: email, password: password, enabled: remember)
            let same = cache.owner == candidate.session?.owner && api.base == base
            api = candidate
            if !same { cache = WatchCache(owner: candidate.session?.owner ?? "", snapshot: nil, pending: []); restore() }
            UserDefaults.standard.set(base.absoluteString, forKey: "planner-url"); signedIn = true; await sync()
        } catch { message = error.localizedDescription }
    }
    func logout() {
        guard cache.pending.isEmpty, !syncing else { message = "请先同步本机补记再退出账号"; return }
        do { try api.logout(); signedIn = false; cache = WatchCache(owner: "", snapshot: nil, pending: []); polling?.cancel(); bridge.publish(cache) }
        catch { message = error.localizedDescription }
    }
    func sync() async {
        guard signedIn, !syncing else { return }; syncing = true; defer { syncing = false }
        do {
            let first: PlannerSnapshot = try await api.rpc("snapshot")
            try cache.reconcile(WatchCache(owner: cache.owner, snapshot: first, pending: [], revision: api.revision, updates: cache.updates))
            while let operation = cache.pending.first {
                guard operation.owner == api.session?.owner else { throw PlannerError.message("旧账号补记未提交，请切回原账号") }
                if operation.endpoint == "workflow.start" {
                    let job: JobID = try await api.rpc(operation.endpoint, payload: operation.payload, operation: operation.id)
                    if let index = cache.updates?.firstIndex(where: { $0.id == operation.id }) { cache.updates?[index].id = job.id; cache.updates?[index].phase = "generating"; cache.updates?[index].summary = "Agnes 正在理解并调整安排" }
                } else { let _: JSONValue = try await api.rpc(operation.endpoint, payload: operation.payload, operation: operation.id) }
                cache.acknowledge(operation.id, owner: operation.owner, revision: api.revision)
                guard persist() else { throw PlannerError.message("补记已提交，但本机缓存未保存，请保持连接") }
                bridge.acknowledge(operation.id, owner: operation.owner, revision: api.revision)
            }
            for update in cache.updates ?? [] where !update.finished {
                let status: JobStatus = try await api.rpc("workflow.status", payload: ["id": .string(update.id)])
                if let index = cache.updates?.firstIndex(where: { $0.id == update.id }) {
                    cache.updates?[index].phase = status.phase
                    cache.updates?[index].summary = status.run.error ?? status.run.draft?.summary ?? "Agnes 正在整理"
                    if let questions = status.run.draft?.questions, !questions.isEmpty { cache.updates?[index].summary += "\n" + questions.joined(separator: "\n") }
                }
            }
            let latest: PlannerSnapshot = try await api.rpc("snapshot")
            try cache.reconcile(WatchCache(owner: cache.owner, snapshot: latest, pending: [], revision: api.revision, updates: cache.updates))
            message = "已同步"; if persist() { publish() }; resumePolling()
        } catch { message = "\(error.localizedDescription) · 本机待同步 \(cache.pending.count) 项"; publish(); resumePolling() }
    }
    private func resumePolling() {
        guard (cache.updates ?? []).contains(where: { !$0.finished }), polling == nil else { return }
        polling = Task { [weak self] in
            defer { self?.polling = nil }
            for _ in 0..<60 {
                do { try await Task.sleep(nanoseconds: 3_000_000_000) } catch { return }
                guard let self, self.signedIn, (self.cache.updates ?? []).contains(where: { !$0.finished }) else { return }
                await self.sync()
            }
        }
    }
    private func publish() { guard signedIn else { return }; var outgoing = cache; outgoing.pending = []; outgoing.agentDraft = nil; bridge.publish(outgoing) }
    func receive(_ operation: PendingOperation) async {
        do { try cache.enqueue(operation); guard persist() else { return }; publish(); await sync() } catch { message = error.localizedDescription }
    }
    func toggle(_ block: PlanBlock) async {
        guard let date = snapshot?.todayIso, let owner = api.session?.owner else { return }
        await receive(PendingOperation(owner: owner, endpoint: "plan.block.toggle", payload: ["date": .string(date), "blockId": .string(block.id), "done": .bool(!block.done)]))
    }
    func tell(_ text: String, apply: Bool) async {
        guard let owner = api.session?.owner else { return }
        do { await receive(try PendingOperation.agent(owner: owner, text: text, mode: "review", date: PlannerDates.today())) } catch { message = error.localizedDescription }
    }
}
final class PhoneConnectivity: NSObject, WCSessionDelegate {
    var onOperation: ((PendingOperation) -> Void)?
    var onReady: (() -> Void)?
    var onRefresh: (() -> Void)?
    func activate() { if WCSession.isSupported() { WCSession.default.delegate = self; WCSession.default.activate() } }
    func publish(_ cache: WatchCache) {
        guard WCSession.default.activationState == .activated, let data = try? JSONEncoder().encode(cache) else { return }
        try? WCSession.default.updateApplicationContext(["cache": data])
    }
    func acknowledge(_ id: String, owner: String, revision: Int?) {
        guard WCSession.default.activationState == .activated else { return }
        var fields: [String: Any] = ["ack": id, "owner": owner]; if let revision { fields["revision"] = revision }
        WCSession.default.transferUserInfo(fields)
    }
    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) { onReady?() }
    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) { session.activate() }
    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
        if userInfo["refresh"] as? Bool == true { onRefresh?() }
        if let data = userInfo["operation"] as? Data, let item = try? JSONDecoder().decode(PendingOperation.self, from: data) { onOperation?(item) }
    }
}
