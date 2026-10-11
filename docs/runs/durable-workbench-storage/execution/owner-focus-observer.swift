import AppKit
import Darwin

let original = NSWorkspace.shared.frontmostApplication?.bundleIdentifier
for sample in 0..<1200 {
    let current = NSWorkspace.shared.frontmostApplication?.bundleIdentifier
    print("{\"sample\":\(sample),\"changed\":\(current != original ? "true" : "false")}")
    fflush(stdout)
    RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.05))
}
