import Foundation
import SwiftUI
import WatchConnectivity
import Network

@MainActor final class PhoneStore: ObservableObject {
    @Published var snapshot: PlannerSnapshot?
    @Published var message=""
    @Published var signedIn=false
    @Published var busy=false
    @Published var jobs: [String] = []
    private var operations: [PendingOperation] = []
    private var syncing=false
    private let bridge=PhoneConnectivity()
    private let monitor=NWPathMonitor()
    var api: APIClient
    private var cacheURL: URL { FileManager.default.urls(for:.applicationSupportDirectory,in:.userDomainMask)[0].appendingPathComponent("planner-phone.json") }
    init() {
        let base=URL(string:UserDefaults.standard.string(forKey:"planner-url") ?? "https://example.invalid")!
        api=APIClient(base:base);signedIn=api.session != nil
        if let data=try? Data(contentsOf:cacheURL),let cache=try? JSONDecoder().decode(WatchCache.self,from:data),cache.owner==api.session?.owner { snapshot=cache.snapshot;operations=cache.pending }
        bridge.onOperation={ [weak self] item in Task { @MainActor in await self?.receive(item) } }; bridge.onReady={ [weak self] in Task { @MainActor in self?.publish() } }
        bridge.activate()
        monitor.pathUpdateHandler={ [weak self] path in if path.status == .satisfied { Task { @MainActor in await self?.sync() } } }
        monitor.start(queue:DispatchQueue(label:"daily-plan-network"))
    }
    private func persist() {
        guard let owner=api.session?.owner else { return }
        do { try FileManager.default.createDirectory(at:cacheURL.deletingLastPathComponent(),withIntermediateDirectories:true);try JSONEncoder().encode(WatchCache(owner:owner,snapshot:snapshot,pending:operations)).write(to:cacheURL,options:.atomic) } catch { message="本机缓存保存失败，暂不要关闭应用" }
    }
    func login(url: String,email: String,password: String) async {
        guard let base=URL(string:url),base.scheme=="https",base.host != nil else { message="请输入 HTTPS 网站根网址";return }
        busy=true;defer {busy=false}
        do { api=APIClient(base:base);try await api.login(email:email,password:password);UserDefaults.standard.set(base.absoluteString,forKey:"planner-url");signedIn=true;await sync() } catch { message=error.localizedDescription }
    }
    func sync() async {
        guard signedIn,!syncing else {return};syncing=true;defer {syncing=false}
        do {
            snapshot=try await api.rpc("snapshot")
            while let operation=operations.first {
                guard operation.owner==api.session?.owner else { throw PlannerError.message("旧账号的补记未提交，请切回原账号核对") }
                let _: JSONValue=try await api.rpc(operation.endpoint,payload:operation.payload,operation:operation.id)
                operations.removeFirst();persist();bridge.acknowledge(operation.id,owner:operation.owner)
            }
            snapshot=try await api.rpc("snapshot");message="已同步";persist();publish()
        } catch { message="\(error.localizedDescription) · 本机待同步 \(operations.count) 项" }
    }
    private func publish() { guard let owner=api.session?.owner else {return};bridge.publish(WatchCache(owner:owner,snapshot:snapshot,pending:[])) }
    func receive(_ operation: PendingOperation) async {
        guard operation.owner==api.session?.owner else {message="收到另一个账号的手表补记，未写入此账号";return}
        if !operations.contains(where:{$0.id==operation.id}) {operations.append(operation);persist()}
        await sync()
    }
    func toggle(_ block: PlanBlock) async {
        guard let date=snapshot?.todayIso,let owner=api.session?.owner else {return}
        let operation=PendingOperation(owner:owner,endpoint:"plan.block.toggle",payload:["date":.string(date),"blockId":.string(block.id),"done":.bool(!block.done)])
        await receive(operation)
    }
    func tell(_ text: String,apply: Bool) async {
        busy=true;defer {busy=false}
        do { let result: JobID=try await api.rpc("workflow.start",payload:["text":.string(text),"mode":.string("review"),"apply":.bool(apply),"replaceConflicts":.bool(true),"clientRequestId":.string(UUID().uuidString)])
            jobs.append(result.id);UserDefaults.standard.set(jobs,forKey:"planner-jobs");message="Agnes 已开始后台整理，网页版可继续微调这份安排";await sync()
        } catch {message=error.localizedDescription}
    }
}
final class PhoneConnectivity: NSObject,WCSessionDelegate {
    var onOperation: ((PendingOperation)->Void)?
    var onReady: (()->Void)?
    func activate() { if WCSession.isSupported() {WCSession.default.delegate=self;WCSession.default.activate()} }
    func publish(_ cache: WatchCache) {
        guard WCSession.default.activationState == .activated,let data=try? JSONEncoder().encode(cache) else {return}
        try? WCSession.default.updateApplicationContext(["cache":data])
    }
    func acknowledge(_ id: String,owner: String) {WCSession.default.transferUserInfo(["ack":id,"owner":owner])}
    func session(_ session: WCSession,activationDidCompleteWith activationState:WCSessionActivationState,error:Error?) {onReady?()}
    func sessionDidBecomeInactive(_ session:WCSession) {}
    func sessionDidDeactivate(_ session:WCSession) {session.activate()}
    func session(_ session:WCSession,didReceiveUserInfo userInfo:[String:Any]) {if let data=userInfo["operation"] as? Data,let item=try? JSONDecoder().decode(PendingOperation.self,from:data) {onOperation?(item)} }
}
