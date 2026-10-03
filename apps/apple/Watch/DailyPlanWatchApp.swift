import SwiftUI

@main struct DailyPlanWatchApp: App {
    @StateObject private var store = WatchStore()
    var body: some Scene { WindowGroup { WatchHome().environmentObject(store) } }
}
struct WatchHome: View {
    var body: some View {
        TabView {
            NavigationStack { TodayWatchView() }
            NavigationStack { WeekWatchView() }
            NavigationStack { AgentWatchView() }
        }.tabViewStyle(.verticalPage)
    }
}
func taskColor(_ category: String) -> Color {
    switch category { case "gym": return .green; case "activity": return .orange; case "intern": return .purple; default: return .cyan }
}
struct TaskWatchRow: View {
    @EnvironmentObject var store: WatchStore
    let block: PlanBlock
    let date: String
    var body: some View {
        Button { store.toggle(block, date: date) } label: {
            HStack(spacing: 9) {
                Image(systemName: block.done ? "checkmark.circle.fill" : "circle").foregroundStyle(taskColor(block.category)).font(.title3)
                VStack(alignment: .leading, spacing: 3) {
                    Text(block.time).font(.caption2).foregroundStyle(.secondary)
                    Text(block.title).font(.system(size: 14, weight: .medium)).lineLimit(2).foregroundStyle(block.done ? Color.secondary : Color.primary)
                }
            }.frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
        }.buttonStyle(.plain)
    }
}
struct TodayWatchView: View {
    @EnvironmentObject var store: WatchStore
    var blocks: [PlanBlock] { store.cache.snapshot?.today.blocks.filter(\.active).sorted(by: { $0.startMinute < $1.startMinute }) ?? [] }
    var body: some View {
        List {
            VStack(alignment: .leading, spacing: 6) {
                Text(store.cache.snapshot?.today.date.suffix(5) ?? "今天").font(.caption).foregroundStyle(.secondary)
                HStack { Text("今日").font(.title2.bold()); Spacer(); Text("\(blocks.filter(\.done).count)/\(blocks.count)").font(.caption).foregroundStyle(.secondary) }
                ProgressView(value: Double(blocks.filter(\.done).count), total: Double(max(1, blocks.count))).tint(.green)
            }.listRowBackground(Color.clear)
            if blocks.isEmpty { Text("今天还没有安排").font(.caption).foregroundStyle(.secondary) }
            ForEach(blocks) { block in TaskWatchRow(block: block, date: store.cache.snapshot?.today.date ?? PlannerDates.today()) }
            NavigationLink { VoiceWatchView() } label: { Label("告诉 Agnes", systemImage: "mic").font(.callout) }
            if !(store.cache.snapshot?.gymSession.items.isEmpty ?? true) {
                NavigationLink("训练补记") { WatchTrainingView() }
            }
            Text(store.message).font(.caption2).foregroundStyle(.secondary)
        }.navigationTitle("今日").toolbar { ToolbarItem(placement: .topBarTrailing) { Button { store.refresh() } label: { Image(systemName: "arrow.clockwise") } } }
    }
}
struct WeekWatchView: View {
    @EnvironmentObject var store: WatchStore
    var body: some View {
        List {
            ForEach(store.cache.snapshot?.week ?? [], id: \.date) { day in
                NavigationLink {
                    List {
                        ForEach(day.blocks.filter(\.active).sorted(by: { $0.startMinute < $1.startMinute })) { block in TaskWatchRow(block: block, date: day.date) }
                        if day.blocks.filter(\.active).isEmpty { Text("留给你的空闲时间").font(.caption).foregroundStyle(.secondary) }
                    }.navigationTitle(String(day.date.suffix(5)))
                } label: {
                    let active = day.blocks.filter(\.active)
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(String(day.date.suffix(5))).font(.headline)
                            Text(active.first?.title ?? "空闲").font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                        }
                        Spacer()
                        VStack(spacing: 4) {
                            Text("\(active.count) 项").font(.caption2)
                            HStack(spacing: 3) { ForEach(Array(active.prefix(4).enumerated()), id: \.offset) { _, block in Circle().fill(taskColor(block.category)).frame(width: 4, height: 4) } }
                        }.foregroundStyle(.secondary)
                    }
                }
            }
            if store.cache.snapshot?.week == nil { Text("在手机同步后查看本周").font(.caption) }
        }.navigationTitle("本周")
    }
}
struct AgentWatchView: View {
    @EnvironmentObject var store: WatchStore
    var body: some View {
        List {
            NavigationLink { VoiceWatchView() } label: {
                VStack(alignment: .leading, spacing: 7) { Label("说说变化", systemImage: "mic.fill").font(.headline); Text("临时改计划，或记录正在做的事").font(.caption2).foregroundStyle(.secondary) }.padding(.vertical, 7)
            }
            ForEach((store.cache.updates ?? []).sorted(by: { $0.createdAt > $1.createdAt }).prefix(5)) { update in
                VStack(alignment: .leading, spacing: 5) {
                    Label(update.phase == "applied" ? "已更新安排" : update.phase == "queued" ? "待联网" : update.finished ? "查看处理结果" : "正在整理",
                          systemImage: update.phase == "applied" ? "checkmark.circle" : "sparkles").font(.caption).foregroundStyle(update.phase == "applied" ? Color.green : Color.secondary)
                    Text(update.text).font(.caption).lineLimit(3)
                    Text(update.summary).font(.caption2).foregroundStyle(.secondary).lineLimit(6)
                }
            }
            Button("同步处理结果") { store.refresh() }
        }.navigationTitle("Agnes")
    }
}
struct VoiceWatchView: View {
    @EnvironmentObject var store: WatchStore
    @State private var text = ""
    @State private var mode = "plan"
    @State private var submitted = false
    @FocusState private var focused: Bool
    var body: some View {
        Form {
            Picker("这次想", selection: $mode) { Text("调整安排").tag("plan"); Text("记录近况").tag("review") }
            TextField("点这里听写", text: $text).focused($focused)
            if !text.isEmpty { Text(text).font(.caption).foregroundStyle(.secondary) }
            Button { submitted = store.tell(text, mode: mode) } label: { Label("让 Agnes 理解并更新", systemImage: "sparkles") }
                .disabled(submitted || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            Text(submitted ? store.message : "使用系统听写说出变化。文字会保留，联网后自动调整日程。").font(.caption2).foregroundStyle(.secondary)
        }.navigationTitle("告诉 Agnes")
        .onAppear { text = store.cache.agentDraft ?? ""; if text.isEmpty { focused = true } }
        .onChange(of: text) { _, value in store.saveDraft(value); submitted = false }
        .onChange(of: mode) { _, _ in submitted = false }
    }
}
struct WatchTrainingView: View {
    @EnvironmentObject var store: WatchStore
    var body: some View {
        List { ForEach(store.cache.snapshot?.gymSession.items ?? []) { item in NavigationLink(item.name) { LogSetView(item: item) } } }.navigationTitle("训练补记")
    }
}
struct LogSetView: View {
    @EnvironmentObject var store: WatchStore
    let item: GymItem
    @State private var weight = 0.0
    @State private var reps = 10
    var body: some View {
        Form {
            Text(item.name).font(.headline)
            Stepper("\(weight, specifier: "%.1f") kg", value: $weight, in: 0...600, step: 0.5)
            Stepper("\(reps) 次", value: $reps, in: 1...100)
            Button("记这一组") { store.log(item, weight: weight, reps: reps) }
            Text(store.message).font(.caption2).foregroundStyle(.secondary)
        }.onAppear { weight = Double(item.weight.replacingOccurrences(of: "kg", with: "")) ?? 0; reps = Int(item.reps) ?? 10 }
    }
}
