import XCTest
@testable import PlannerSync

final class SyncJournalTests: XCTestCase {
    func fixture(owner: String = "alice", date: String = "2026-10-02", revision: Int = 1) -> WatchCache {
        WatchCache(owner: owner, snapshot: PlannerSnapshot(todayIso: date,
            today: DayPlan(date: date, blocks: [PlanBlock(id: "paper", title: "论文", category: "study", startMinute: 540, endMinute: 600, done: false)]),
            gymSession: GymSession(date: date, items: [GymItem(id: "bench", name: "卧推", reps: "8-12", weight: "40kg", actualSets: [])])),
            pending: [], revision: revision)
    }
    func toggle(_ done: Bool = true, owner: String = "alice") -> PendingOperation {
        PendingOperation(owner: owner, endpoint: "plan.block.toggle", payload: ["date": .string("2026-10-02"), "blockId": .string("paper"), "done": .bool(done)])
    }
    func set() -> PendingOperation {
        PendingOperation(owner: "alice", endpoint: "gym.set.log", payload: ["date": .string("2026-10-02"), "itemId": .string("bench"), "requestId": .string("set-1"),
            "set": .object(["weight": .number(40), "reps": .number(10), "unit": .string("kg")])])
    }
    func testPendingToggleSurvivesIncomingSnapshotAndRelaunch() throws {
        var cache = fixture(); let operation = toggle()
        try cache.enqueue(operation); try cache.reconcile(fixture(revision: 2))
        let restored = try JSONDecoder().decode(WatchCache.self, from: JSONEncoder().encode(cache))
        XCTAssertEqual(restored.snapshot?.today.blocks.first?.done, true)
        XCTAssertEqual(restored.pending.map(\.id), [operation.id])
    }
    func testLastToggleWinsAndOtherDayIsNotMarkedDone() throws {
        var cache = fixture(); try cache.enqueue(toggle()); try cache.enqueue(toggle(false))
        XCTAssertEqual(cache.snapshot?.today.blocks.first?.done, false)
        try cache.reconcile(fixture(date: "2026-10-03", revision: 2))
        XCTAssertEqual(cache.snapshot?.today.blocks.first?.done, false)
        XCTAssertEqual(cache.pending.count, 2)
    }
    func testActualSetSurvivesRefreshWithoutDuplicateOrPlannedWeightChanges() throws {
        var cache = fixture(); let operation = set()
        try cache.enqueue(operation); try cache.enqueue(operation)
        try cache.reconcile(fixture(revision: 2)); try cache.reconcile(fixture(revision: 3))
        XCTAssertEqual(cache.pending.count, 1)
        XCTAssertEqual(cache.snapshot?.gymSession.items.first?.actualSets?.count, 1)
        XCTAssertEqual(cache.snapshot?.gymSession.items.first?.actualSets?.first?.weight, 40)
        XCTAssertEqual(cache.snapshot?.gymSession.items.first?.actualSets?.first?.reps, 10)
        XCTAssertEqual(cache.snapshot?.gymSession.items.first?.weight, "40kg")
    }
    func testAccountSwitchAndForgedAckCannotDiscardOrUploadPending() throws {
        var cache = fixture(); let operation = toggle(); try cache.enqueue(operation)
        XCTAssertThrowsError(try cache.reconcile(fixture(owner: "bob")))
        XCTAssertThrowsError(try cache.enqueue(toggle(owner: "bob")))
        cache.acknowledge(operation.id, owner: "bob", revision: 100)
        XCTAssertEqual(cache.owner, "alice"); XCTAssertEqual(cache.pending.count, 1); XCTAssertEqual(cache.revision, 1)
        cache.acknowledge(operation.id, owner: "alice", revision: 3)
        XCTAssertTrue(cache.pending.isEmpty)
        try cache.reconcile(fixture(owner: "bob")); XCTAssertEqual(cache.owner, "bob")
    }
    func testStaleContextAfterAckCannotUndoConfirmedEdit() throws {
        var cache = fixture(); let operation = toggle(); try cache.enqueue(operation)
        cache.acknowledge(operation.id, owner: "alice", revision: 4)
        try cache.reconcile(fixture(revision: 2))
        XCTAssertEqual(cache.snapshot?.today.blocks.first?.done, true); XCTAssertEqual(cache.revision, 4)
        var fresh = fixture(revision: 4); fresh.snapshot?.today.blocks[0].done = true
        try cache.reconcile(fresh); XCTAssertEqual(cache.snapshot?.today.blocks.first?.done, true)
    }
    func testLegacyCacheWithoutRevisionCanBeRead() throws {
        var cache = fixture(); cache.revision = nil
        let encoded = try JSONEncoder().encode(cache)
        let restored = try JSONDecoder().decode(WatchCache.self, from: encoded)
        XCTAssertNil(restored.revision)
    }
    func testQueueRejectsAgentJobWithoutStableIDOrConsent() throws {
        var cache = fixture()
        XCTAssertThrowsError(try cache.enqueue(PendingOperation(owner: "alice", endpoint: "workflow.start", payload: [:])))
        XCTAssertTrue(cache.pending.isEmpty)
    }
    func testDictatedAgentIntentRetainsStableJobIDAcrossReconnect() throws {
        var cache = fixture()
        let operation = try PendingOperation.agent(owner: "alice", text: "晚饭改到六点半，后面的学习顺延", mode: "plan", date: "2026-10-02")
        try cache.enqueue(operation); try cache.enqueue(operation)
        let restored = try JSONDecoder().decode(WatchCache.self, from: JSONEncoder().encode(cache))
        XCTAssertEqual(restored.pending.count, 1); XCTAssertEqual(restored.updates?.count, 1)
        XCTAssertEqual(restored.pending.first?.payload["clientRequestId"]?.stringValue, operation.id)
        XCTAssertEqual(restored.pending.first?.payload["planEnd"]?.stringValue, "2026-10-04")
        XCTAssertEqual(restored.pending.first?.payload["mode"]?.stringValue, "plan")
    }
    func testRecordModeAndSundayRange() throws {
        let operation = try PendingOperation.agent(owner: "alice", text: "刚做完卧推，40kg十次三组", mode: "review", date: "2026-10-04")
        XCTAssertEqual(operation.payload["planEnd"]?.stringValue, "2026-10-04")
        XCTAssertEqual(operation.payload["rangeStart"]?.stringValue, "2026-10-04")
    }
}
