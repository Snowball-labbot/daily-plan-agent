import Foundation
import SwiftUI
import WatchConnectivity

final class WatchStore:NSObject,ObservableObject,WCSessionDelegate {
    @Published var cache=WatchCache(owner:"",snapshot:nil,pending:[])
    @Published var message="先在 iPhone 登录并同步"
    private var url:URL {FileManager.default.urls(for:.applicationSupportDirectory,in:.userDomainMask)[0].appendingPathComponent("planner-watch.json")}
    override init() {
        super.init()
        if let data=try? Data(contentsOf:url),let saved=try? JSONDecoder().decode(WatchCache.self,from:data) {cache=saved}
        WCSession.default.delegate=self;WCSession.default.activate()
    }
    private func persist() {
        do {try FileManager.default.createDirectory(at:url.deletingLastPathComponent(),withIntermediateDirectories:true);try JSONEncoder().encode(cache).write(to:url,options:.atomic)}catch {message="缓存未保存，请先保持连接"}
    }
    func enqueue(_ endpoint:String,payload:[String:JSONValue]) {
        guard !cache.owner.isEmpty else {message="先在手机登录";return}
        let operation=PendingOperation(owner:cache.owner,endpoint:endpoint,payload:payload)
        cache.pending.append(operation);persist();send(operation);message="已补记 · 待手机同步 \(cache.pending.count) 项"
    }
    private func send(_ operation:PendingOperation) {if let data=try? JSONEncoder().encode(operation) {WCSession.default.transferUserInfo(["operation":data])}}
    func toggle(_ block:PlanBlock) {
        guard let date=cache.snapshot?.todayIso else {return}
        enqueue("plan.block.toggle",payload:["date":.string(date),"blockId":.string(block.id),"done":.bool(!block.done)])
        if let index=cache.snapshot?.today.blocks.firstIndex(where:{$0.id==block.id}) {cache.snapshot?.today.blocks[index].done.toggle();persist()}
    }
    func log(_ item:GymItem,weight:Double,reps:Int) {
        guard let date=cache.snapshot?.gymSession.date else {return}
        enqueue("gym.set.log",payload:["date":.string(date),"itemId":.string(item.id),"requestId":.string(UUID().uuidString),"set":.object(["reps":.number(Double(reps)),"weight":.number(weight),"unit":.string("kg")])])
    }
    func session(_ session:WCSession,activationDidCompleteWith activationState:WCSessionActivationState,error:Error?) {DispatchQueue.main.async {for item in self.cache.pending {self.send(item)}}}
    func session(_ session:WCSession,didReceiveApplicationContext applicationContext:[String:Any]) {
        guard let data=applicationContext["cache"] as? Data,let incoming=try? JSONDecoder().decode(WatchCache.self,from:data) else {return}
        DispatchQueue.main.async {
            if !self.cache.pending.isEmpty && self.cache.owner != incoming.owner {self.message="有旧账号补记，请在手机核对后再切换";return}
            self.cache=WatchCache(owner:incoming.owner,snapshot:incoming.snapshot,pending:self.cache.pending);self.persist();self.message="已同步 · 待上传 \(self.cache.pending.count) 项"
        }
    }
    func session(_ session:WCSession,didReceiveUserInfo userInfo:[String:Any]) {
        guard let id=userInfo["ack"] as? String,let owner=userInfo["owner"] as? String else {return}
        DispatchQueue.main.async {if self.cache.owner==owner {self.cache.pending.removeAll(where:{$0.id==id});self.persist();self.message="待手机同步 \(self.cache.pending.count) 项"}}
    }
}
