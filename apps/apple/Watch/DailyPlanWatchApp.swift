import SwiftUI
@main struct DailyPlanWatchApp:App {
    @StateObject private var store=WatchStore()
    var body:some Scene {WindowGroup {WatchPlan().environmentObject(store)}}
}
struct WatchPlan:View {
    @EnvironmentObject var store:WatchStore
    var body:some View {NavigationStack {List {
        Section(store.cache.snapshot?.todayIso ?? "今天") {ForEach(store.cache.snapshot?.today.blocks.filter(\.active).sorted(by:{$0.startMinute<$1.startMinute}) ?? []) {block in Button {store.toggle(block)} label:{HStack {VStack(alignment:.leading) {Text(block.time).font(.caption2).foregroundStyle(.secondary);Text(block.title).font(.body)};Spacer();Image(systemName:block.done ? "checkmark.circle.fill":"circle")}}}}
        Section("训练补记") {ForEach(store.cache.snapshot?.gymSession.items ?? []) {item in NavigationLink(item.name) {LogSetView(item:item).environmentObject(store)}}}
        Text(store.message).font(.caption2)
    }.navigationTitle("每日计划")}}
}
struct LogSetView:View {
    @EnvironmentObject var store:WatchStore
    let item:GymItem
    @State private var weight=0.0
    @State private var reps=10
    var body:some View {Form {Text(item.name);Stepper("\(weight,specifier:"%.1f") kg",value:$weight,in:0...600,step:0.5);Stepper("\(reps) 次",value:$reps,in:1...100);Button("记这一组") {store.log(item,weight:weight,reps:reps)};Text("联网后经 iPhone 写入同一条训练记录").font(.caption2)}.onAppear {weight=Double(item.weight.replacingOccurrences(of:"kg",with:"")) ?? 0;reps=Int(item.reps) ?? 10}}
}
