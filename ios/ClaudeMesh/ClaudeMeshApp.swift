import SwiftUI

/// The app's name (CFBundleDisplayName, set from MESH_NAME in Mesh.xcconfig / Local.xcconfig).
let appName = (Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String) ?? "Mesh for Claude Code"

// The iPhone app — a native shell around the live mesh served by the Mac app (📱 button)
// or by the server program on an always-on box. The app remembers one pairing link per host and opens the
// first that answers: the Mac when it's up, the server when the Mac is off.
@main
struct ClaudeMeshApp: App {
    @StateObject private var pairing = Pairing()
    var body: some Scene {
        WindowGroup {
            Group {
                if pairing.urls.isEmpty { PairingView() } else { MeshScreen() }
            }
            .environmentObject(pairing)
            .preferredColorScheme(.dark)
        }
    }
}

/// Saved pairing links in the order they are tried, e.g. the Mac over Tailscale, the Mac on Wi-Fi, then the server.
/// Each host keeps its own key (the Mac app and the server program each issue one).
final class Pairing: ObservableObject {
    @Published var urls: [URL] { didSet { UserDefaults.standard.set(urls.map(\.absoluteString), forKey: "pairing.urls") } }
    init() { urls = (UserDefaults.standard.stringArray(forKey: "pairing.urls") ?? []).compactMap(URL.init(string:)) }

    /// Accepts a link from the Mac's QR code / copy or the server's `--pair` output. Returns false if it isn't a
    /// A pairing link. A link for a host already paired replaces that host's old link; other hosts stay.
    @discardableResult func add(_ text: String) -> Bool {
        // pasted text may carry extra characters (chat formatting, a previous paste, a trailing dot):
        // use the first http(s) link found anywhere in it
        let link = text.range(of: #"https?://[^\s`'"<>()]+"#, options: .regularExpression)
            .map { String(text[$0]).trimmingCharacters(in: CharacterSet(charactersIn: ".,;:!?")) } ?? text
        guard let u = URL(string: link.trimmingCharacters(in: .whitespacesAndNewlines)),
              let scheme = u.scheme, scheme.hasPrefix("http"), let host = u.host, u.port == 47320,
              let q = URLComponents(url: u, resolvingAgainstBaseURL: false)?.queryItems,
              q.contains(where: { $0.name == "t" && !($0.value ?? "").isEmpty }) else { return false }
        urls.removeAll { $0.host == host }
        urls.append(u)
        return true
    }
    func remove(_ u: URL) { urls.removeAll { $0 == u } }
    /// Put this host first so it is tried before the others.
    func prefer(_ u: URL) { guard let i = urls.firstIndex(of: u) else { return }; urls.remove(at: i); urls.insert(u, at: 0) }
    func reset() { urls = [] }

    /// Short label for a host, for menus: "Mac · 100.x.y.z" / "Server · 100.x.y.w".
    static func label(_ u: URL) -> String { (u.host ?? "?") }
}
