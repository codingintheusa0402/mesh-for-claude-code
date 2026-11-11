import SwiftUI
import WebKit

/// Full-screen live mesh. Tries each paired host in turn (Mac over Tailscale, Mac on Wi-Fi, server …);
/// if none answers, shows a native retry / re-pair screen. While a page is open and reports that its
/// host stopped answering (window.webkit → 'offline'), the next host is tried automatically.
struct MeshScreen: View {
    @EnvironmentObject var pairing: Pairing
    @State private var failed = false
    @State private var attempt = 0
    @State private var startAt = 0            // which paired host the next load starts from
    @State private var showMenu = false
    @State private var showAdd = false
    @Environment(\.scenePhase) private var phase

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            MeshWebView(urls: pairing.urls, attempt: attempt, startAt: startAt, failed: $failed).ignoresSafeArea()
            if failed {
                VStack(spacing: 14) {
                    Image(systemName: "wifi.exclamationmark").font(.system(size: 40)).foregroundStyle(.white.opacity(0.7))
                    Text(pairing.urls.count > 1 ? "Can’t reach your Mac or the server" : "Can’t reach your Mac").font(.headline).foregroundStyle(.white)
                    Text("\(appName) must be open on the Mac with phone access on, or the server must be running.\nAway from home, turn on Tailscale on this iPhone.")
                        .font(.footnote).multilineTextAlignment(.center).foregroundStyle(.white.opacity(0.65))
                    HStack { Button("Retry") { reload(from: 0) }.buttonStyle(.borderedProminent)
                             Button("Hosts…") { showMenu = true }.buttonStyle(.bordered) }
                }.padding(30).background(RoundedRectangle(cornerRadius: 16).fill(Color(white: 0.06)).overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.white.opacity(0.14))))
            }
        }
        .onChange(of: phase) { _, p in if p == .active && failed { reload(from: 0) } }
        // long-press with three fingers anywhere → connection menu
        .overlay(ThreeFingerHold { showMenu = true }.allowsHitTesting(true).opacity(0.001))
        .confirmationDialog(appName, isPresented: $showMenu) {
            Button("Reload") { reload(from: 0) }
            ForEach(Array(pairing.urls.enumerated()), id: \.offset) { i, u in
                Button("Connect to \(Pairing.label(u))") { reload(from: i) }
            }
            Button("Add a host (pairing link)") { showAdd = true }
            Button("Forget all hosts", role: .destructive) { pairing.reset() }
        }
        .sheet(isPresented: $showAdd) { PairingView(onDone: { showAdd = false; reload(from: pairing.urls.count - 1) }) }
    }
    private func reload(from i: Int) { failed = false; startAt = max(0, min(i, pairing.urls.count - 1)); attempt += 1 }
}

struct MeshWebView: UIViewRepresentable {
    let urls: [URL]; let attempt: Int; let startAt: Int
    @Binding var failed: Bool

    func makeCoordinator() -> Coord { Coord(self) }
    func makeUIView(context: Context) -> WKWebView {
        let cfg = WKWebViewConfiguration()
        cfg.allowsInlineMediaPlayback = true
        cfg.websiteDataStore = .default()                       // keeps the pairing key + saved orbits (per host)
        cfg.userContentController.add(context.coordinator, name: "mesh")
        let wv = WKWebView(frame: .zero, configuration: cfg)
        wv.isOpaque = false; wv.backgroundColor = UIColor.black
        wv.scrollView.bounces = false; wv.scrollView.contentInsetAdjustmentBehavior = .never
        wv.allowsBackForwardNavigationGestures = false
        wv.navigationDelegate = context.coordinator; wv.uiDelegate = context.coordinator
        context.coordinator.web = wv; context.coordinator.load(index: startAt)
        return wv
    }
    func updateUIView(_ wv: WKWebView, context: Context) {
        context.coordinator.parent = self
        if context.coordinator.lastAttempt != attempt { context.coordinator.lastAttempt = attempt; context.coordinator.tried = 0; context.coordinator.load(index: startAt) }
    }

    final class Coord: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        var parent: MeshWebView; weak var web: WKWebView?; var index = 0; var tried = 0; var lastAttempt = 0; var lastError = ""
        init(_ p: MeshWebView) {
            parent = p; lastAttempt = p.attempt; super.init()
            // on a fallback host (e.g. the server while the Mac was off): every 60 s ask the hosts listed
            // before it whether they answer again, and move back to the first one that does
            preferTimer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in self?.tryPreferred() }
            // the web view runs full screen under the keyboard: tell the page how much of the screen the keyboard
            // covers, so it can lift the typing area above it and show its Done bar (phone.js meshKeyboard)
            for n in [UIResponder.keyboardWillChangeFrameNotification, UIResponder.keyboardWillHideNotification] {
                NotificationCenter.default.addObserver(forName: n, object: nil, queue: .main) { [weak self] note in
                    guard let web = self?.web, let win = web.window else { return }
                    var h: CGFloat = 0
                    if note.name != UIResponder.keyboardWillHideNotification, let end = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect {
                        h = max(0, win.bounds.maxY - win.convert(end, from: nil).minY)
                    }
                    web.evaluateJavaScript("window.meshKeyboard && window.meshKeyboard(\(Int(h)))")
                }
            }
        }
        deinit { preferTimer?.invalidate() }
        private var preferTimer: Timer?
        private var probing = false
        func tryPreferred() {
            guard index > 0, !probing, UIApplication.shared.applicationState == .active else { return }
            let better = Array(parent.urls.prefix(index)); probing = true
            func probe(_ k: Int) {
                guard k < better.count else { probing = false; return }
                var r = URLRequest(url: better[k]); r.timeoutInterval = 4; r.cachePolicy = .reloadIgnoringLocalCacheData
                URLSession.shared.dataTask(with: r) { [weak self] _, resp, _ in
                    DispatchQueue.main.async {
                        guard let self else { return }
                        if (resp as? HTTPURLResponse)?.statusCode == 200 {
                            NSLog("MESH preferred host back → %@", better[k].host ?? "?")
                            self.probing = false; self.tried = 0; self.load(index: k)
                        } else { probe(k + 1) }
                    }
                }.resume()
            }
            probe(0)
        }
        /// Load host `i`; after every host has been tried once without an answer, show the failed screen.
        func load(index i: Int) {
            let n = parent.urls.count
            guard n > 0, tried < n else { DispatchQueue.main.async { self.parent.failed = true }; return }
            index = i % n; tried += 1
            var r = URLRequest(url: parent.urls[index]); r.timeoutInterval = 12
            NSLog("MESH load %@", parent.urls[index].absoluteString.replacingOccurrences(of: #"t=[^&]+"#, with: "t=…", options: .regularExpression))
            web?.load(r)
        }
        // vnc:// (Screen Sharing buttons), tel:, mailto: … → hand to the app that owns the scheme (RVNC Viewer for vnc)
        func webView(_ w: WKWebView, decidePolicyFor a: WKNavigationAction, decisionHandler done: @escaping (WKNavigationActionPolicy) -> Void) {
            if let u = a.request.url, let sch = u.scheme?.lowercased(), !["http", "https", "about", "blob", "data"].contains(sch) {
                UIApplication.shared.open(u) { ok in
                    if !ok, sch == "vnc" { DispatchQueue.main.async { self.alert("Install RVNC Viewer (RealVNC) from the App Store to open \(u.host ?? "this Mac")'s screen.") } }
                }
                return done(.cancel)
            }
            done(.allow)
        }
        // address didn't answer → try the next paired one
        func webView(_ w: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) { NSLog("MESH fail-prov %@", "\(e)"); lastError = e.localizedDescription; load(index: index + 1) }
        func webView(_ w: WKWebView, didFail n: WKNavigation!, withError e: Error) { NSLog("MESH fail %@", "\(e)"); lastError = e.localizedDescription; load(index: index + 1) }
        func webView(_ w: WKWebView, didFinish n: WKNavigation!) { DispatchQueue.main.async { self.parent.failed = false }; tried = 0 }
        // the page says its host stopped answering (20 s without data) → move on to the next host
        func userContentController(_ u: WKUserContentController, didReceive m: WKScriptMessage) {
            guard m.name == "mesh", let s = m.body as? String, s == "offline", parent.urls.count > 1 else { return }
            NSLog("MESH host offline → next"); tried = 0; load(index: index + 1)
        }

        // the page's alert / confirm / prompt dialogs, shown natively
        func alert(_ m: String) {
            let a = UIAlertController(title: nil, message: m, preferredStyle: .alert); a.addAction(.init(title: "OK", style: .default))
            top?.present(a, animated: true)
        }
        private var top: UIViewController? { UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first?.rootViewController.flatMap { var v = $0; while let p = v.presentedViewController { v = p }; return v } }
        func webView(_ w: WKWebView, runJavaScriptAlertPanelWithMessage m: String, initiatedByFrame f: WKFrameInfo, completionHandler done: @escaping () -> Void) {
            let a = UIAlertController(title: nil, message: m, preferredStyle: .alert); a.addAction(.init(title: "OK", style: .default) { _ in done() })
            top?.present(a, animated: true) ?? done()
        }
        func webView(_ w: WKWebView, runJavaScriptConfirmPanelWithMessage m: String, initiatedByFrame f: WKFrameInfo, completionHandler done: @escaping (Bool) -> Void) {
            let a = UIAlertController(title: nil, message: m, preferredStyle: .alert)
            a.addAction(.init(title: "Cancel", style: .cancel) { _ in done(false) }); a.addAction(.init(title: "OK", style: .default) { _ in done(true) })
            top?.present(a, animated: true) ?? done(false)
        }
        func webView(_ w: WKWebView, runJavaScriptTextInputPanelWithPrompt p: String, defaultText: String?, initiatedByFrame f: WKFrameInfo, completionHandler done: @escaping (String?) -> Void) {
            let a = UIAlertController(title: nil, message: p, preferredStyle: .alert)
            a.addTextField { $0.text = defaultText }
            a.addAction(.init(title: "Cancel", style: .cancel) { _ in done(nil) }); a.addAction(.init(title: "OK", style: .default) { _ in done(a.textFields?.first?.text) })
            top?.present(a, animated: true) ?? done(nil)
        }
    }
}

/// Three-finger long press (doesn't interfere with the mesh's one/two-finger gestures).
struct ThreeFingerHold: UIViewRepresentable {
    var action: () -> Void
    func makeUIView(context: Context) -> UIView {
        let v = PassThroughView(); let g = UILongPressGestureRecognizer(target: context.coordinator, action: #selector(Coord.fire(_:)))
        g.numberOfTouchesRequired = 3; g.minimumPressDuration = 0.6; g.cancelsTouchesInView = false; v.addGestureRecognizer(g); return v
    }
    func updateUIView(_ uiView: UIView, context: Context) {}
    func makeCoordinator() -> Coord { Coord(action) }
    final class Coord: NSObject { let action: () -> Void; init(_ a: @escaping () -> Void) { action = a }
        @objc func fire(_ g: UILongPressGestureRecognizer) { if g.state == .began { action() } } }
    final class PassThroughView: UIView { override func point(inside p: CGPoint, with e: UIEvent?) -> Bool { (e?.allTouches?.count ?? 0) >= 3 } }
}
