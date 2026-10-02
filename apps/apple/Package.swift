// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "PlannerSync",
    products: [.library(name: "PlannerSync", targets: ["PlannerSync"])],
    targets: [
        .target(name: "PlannerSync", path: "Shared", exclude: ["APIClient.swift"]),
        .testTarget(name: "PlannerSyncTests", dependencies: ["PlannerSync"], path: "Tests")
    ]
)
