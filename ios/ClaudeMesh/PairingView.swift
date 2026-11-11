import SwiftUI
import AVFoundation

struct PairingView: View {
    @EnvironmentObject var pairing: Pairing
    var onDone: (() -> Void)? = nil           // set when shown as a sheet (adding a second host)
    @State private var scanning = false
    @State private var pasted = ""
    @State private var error: String?

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.black.ignoresSafeArea()
            if let onDone {                    // opened from "Hosts…" — let the user go back to the mesh
                Button { onDone() } label: {
                    Image(systemName: "chevron.left").font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.85)).padding(14)
                        .background(Circle().fill(.white.opacity(0.08)))
                }
                .padding(.leading, 16).padding(.top, 12).zIndex(1)
                .accessibilityLabel("Back")
            }
            VStack(spacing: 22) {
                Image("AppIconImage").resizable().frame(width: 84, height: 84).clipShape(RoundedRectangle(cornerRadius: 20))
                    
                Text(appName).font(.system(size: 22, weight: .semibold)).foregroundStyle(Color(red: 0.925, green: 0.922, blue: 0.902))
                Text("On your Mac open \(appName), click 📱, turn on phone access, then scan the QR code.\nUse the Tailscale code to connect from anywhere.\nFor the server, paste the link from `mesh-server.js --pair`.")
                    .font(.footnote).multilineTextAlignment(.center).foregroundStyle(.white.opacity(0.65)).padding(.horizontal, 28)
                Button { scanning = true } label: {
                    Label("Scan QR code", systemImage: "qrcode.viewfinder").font(.headline).padding(.horizontal, 26).padding(.vertical, 13)
                        .background(Capsule().fill(Color(red: 0.929, green: 0.902, blue: 0.839)))
                        .foregroundStyle(Color(red: 0.078, green: 0.067, blue: 0.043))
                }
                VStack(spacing: 8) {
                    TextField("…or paste the pairing link", text: $pasted).textInputAutocapitalization(.never).autocorrectionDisabled()
                        .padding(12).background(RoundedRectangle(cornerRadius: 14).fill(.white.opacity(0.08))).foregroundStyle(.white)
                    Button("Connect") { if pairing.add(pasted) { onDone?() } else { error = "That isn't a \(appName) pairing link." } }.disabled(pasted.isEmpty)
                }.padding(.horizontal, 28)
                if let error { Text(error).font(.footnote).foregroundStyle(.red.opacity(0.85)) }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)   // keep the content centred (ZStack aligns top-leading for the back button)
        }
        .sheet(isPresented: $scanning) {
            QRScanner { code in
                scanning = false
                if pairing.add(code) { onDone?() } else { error = "That QR code isn't a \(appName) pairing code." }
            }
            .ignoresSafeArea()
        }
    }
}

/// Camera QR scanner (AVFoundation).
struct QRScanner: UIViewControllerRepresentable {
    var onCode: (String) -> Void
    func makeUIViewController(context: Context) -> ScannerVC { let vc = ScannerVC(); vc.onCode = onCode; return vc }
    func updateUIViewController(_ vc: ScannerVC, context: Context) {}

    final class ScannerVC: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
        var onCode: ((String) -> Void)?
        private let session = AVCaptureSession()
        private var done = false
        override func viewDidLoad() {
            super.viewDidLoad(); view.backgroundColor = .black
            guard let cam = AVCaptureDevice.default(for: .video), let input = try? AVCaptureDeviceInput(device: cam), session.canAddInput(input) else {
                let l = UILabel(); l.text = "Camera unavailable — paste the link instead."; l.textColor = .white; l.textAlignment = .center
                l.frame = view.bounds; l.autoresizingMask = [.flexibleWidth, .flexibleHeight]; view.addSubview(l); return
            }
            session.addInput(input)
            let out = AVCaptureMetadataOutput()
            if session.canAddOutput(out) { session.addOutput(out); out.setMetadataObjectsDelegate(self, queue: .main); out.metadataObjectTypes = [.qr] }
            let layer = AVCaptureVideoPreviewLayer(session: session); layer.frame = view.bounds; layer.videoGravity = .resizeAspectFill
            view.layer.addSublayer(layer)
            DispatchQueue.global(qos: .userInitiated).async { self.session.startRunning() }
        }
        override func viewWillDisappear(_ animated: Bool) { super.viewWillDisappear(animated); session.stopRunning() }
        func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput objects: [AVMetadataObject], from connection: AVCaptureConnection) {
            guard !done, let s = (objects.first as? AVMetadataMachineReadableCodeObject)?.stringValue else { return }
            done = true; UINotificationFeedbackGenerator().notificationOccurred(.success); onCode?(s)
        }
    }
}
