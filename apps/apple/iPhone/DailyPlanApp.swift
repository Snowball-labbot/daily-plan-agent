import SwiftUI
import WebKit
@main struct DailyPlanApp: App {
    @StateObject private var store=PhoneStore()
    var body: some Scene {WindowGroup {PhoneView().environmentObject(store)}}
}
struct PhoneView: View {
    @EnvironmentObject var store: PhoneStore
    @State private var url=UserDefaults.standard.string(forKey:"planner-url") ?? ""
    @State private var email="",password="",text=""
    @State private var showWebsite=false
    var body: some View {
        NavigationStack {
            if !store.signedIn {
                Form {Section("个人账号") {TextField("网站 HTTPS 网址",text:$url).textInputAutocapitalization(.never).keyboardType(.URL);TextField("邮箱",text:$email).textInputAutocapitalization(.never).keyboardType(.emailAddress);SecureField("密码",text:$password);Button("登录") {Task {await store.login(url:url,email:email,password:password);password=""}}.disabled(store.busy)};Text(store.message).font(.caption)}.navigationTitle("每日计划")
            } else {
                List {
                    Section(store.snapshot?.todayIso ?? "今天") {ForEach(store.snapshot?.today.blocks.filter(\.active).sorted(by:{$0.startMinute<$1.startMinute}) ?? []) {block in Button {Task {await store.toggle(block)}} label:{HStack {Text(block.time).font(.caption).foregroundStyle(.secondary);Text(block.title).foregroundStyle(.primary);Spacer();Image(systemName:block.done ? "checkmark.circle.fill":"circle").foregroundStyle(block.category=="gym" ? Color.green : Color.secondary)}}}}
                    Section("告诉 Agnes") {TextEditor(text:$text).frame(minHeight:140);Button("整理并安排") {Task {await store.tell(text,apply:true)}}.disabled(text.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty||store.busy);Button("打开完整计划与训练") {showWebsite=true};Text("微调时间、预览和复盘详情在手机网页版里继续。输入不会在提交后消失。").font(.caption).foregroundStyle(.secondary)}
                    Section {Text(store.message).font(.caption);Button("同步到手机与手表") {Task {await store.sync()}}}
                }.navigationTitle("每日计划").refreshable {await store.sync()}.task {await store.sync()}
                .sheet(isPresented:$showWebsite) {NavigationStack {PlannerWebsite(url:store.api.base).toolbar {Button("关闭") {showWebsite=false}}}}
            }
        }
    }
}
struct PlannerWebsite:UIViewRepresentable {
    let url:URL
    func makeUIView(context:Context)->WKWebView {let view=WKWebView();view.load(URLRequest(url:url));return view}
    func updateUIView(_ uiView:WKWebView,context:Context) {}
}
