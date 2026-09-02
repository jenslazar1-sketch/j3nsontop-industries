// J3NSONTOP INDUSTRIES - WebViewController.swift
//
// The iOS host: a WKWebView over the exact same web assets the Android app
// ships (../app/src/main/assets, bundled here as `www`). Every JS engine —
// the toolbox, APK Lab, the tamper detector — is standard web code and runs
// unchanged. Only the thin native surface differs per platform.
//
// Why a local loopback server instead of loadFileURL: a file:// page is not a
// secure context, so crypto.subtle — every SHA hash and certificate
// fingerprint in the app — does not exist there. http://localhost IS a secure
// context (WebKit treats loopback as trustworthy), so serving the bundle over
// GCDWebServer on 127.0.0.1 hands the page real WebCrypto while keeping every
// byte on-device. Same problem, same fix as the Android LocalServer.
//
// This is a scaffold: it is written to be correct, but it has never been
// compiled here (no Mac). Build it on macOS — see ios/README.md.

import UIKit
import WebKit
import GCDWebServer
import UniformTypeIdentifiers

final class WebViewController: UIViewController, WKScriptMessageHandler, WKUIDelegate, WKNavigationDelegate {

    private var webView: WKWebView!
    private let server = GCDWebServer()

    // Files handed in from other apps, served back to the page at /__file/<id>
    // exactly like the Android LocalServer, so a large APK never crosses the JS
    // bridge as base64.
    private var handed: [String: URL] = [:]
    private var seq = 0

    // Android-only views have no iOS equivalent and are hidden by an injected
    // stylesheet: Scanner needs PackageManager (iOS sandboxes the app list
    // away entirely) and the native ImGui console is a GLSurfaceView.
    private let hideAndroidOnly = """
    (function(){var s=document.createElement('style');
    s.textContent='#nav [data-view=\\"scanner\\"]{display:none!important}';
    document.documentElement.appendChild(s);
    window.J3_PLATFORM='ios';})();
    """

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.02, green: 0.027, blue: 0.039, alpha: 1)

        let cfg = WKWebViewConfiguration()
        let ucc = WKUserContentController()
        ucc.add(self, name: "j3")                         // window.webkit.messageHandlers.j3
        ucc.addUserScript(WKUserScript(source: hideAndroidOnly,
                                       injectionTime: .atDocumentEnd,
                                       forMainFrameOnly: true))
        cfg.userContentController = ucc
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []

        webView = WKWebView(frame: view.bounds, configuration: cfg)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.uiDelegate = self
        webView.navigationDelegate = self
        #if DEBUG
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        #endif
        view.addSubview(webView)

        startServerAndLoad()
    }

    // MARK: - Local secure origin

    private func startServerAndLoad() {
        guard let www = Bundle.main.path(forResource: "www", ofType: nil) else {
            loadFailure("Bundled web assets (www) are missing from the app.")
            return
        }
        server.addGETHandler(forBasePath: "/",
                             directoryPath: www,
                             indexFilename: "index.html",
                             cacheAge: 0,
                             allowRangeRequests: true)
        // Added after the base handler so it wins (GCDWebServer matches LIFO).
        server.addHandler(forMethod: "GET", pathRegex: "^/__file/.+$",
                          request: GCDWebServerRequest.self) { [weak self] req in
            let id = (req.path as NSString).lastPathComponent
            guard let self = self, let url = self.handed[id],
                  let data = try? Data(contentsOf: url) else {
                return GCDWebServerResponse(statusCode: 404)
            }
            return GCDWebServerDataResponse(data: data, contentType: "application/octet-stream")
        }
        do {
            // Bind to loopback so the origin is http://localhost — a secure
            // context — and never reachable from the network.
            try server.start(options: [
                GCDWebServerOption_BindToLocalhost: true,
                GCDWebServerOption_Port: 0                 // any free port
            ])
        } catch {
            loadFailure("Could not start the local server: \(error.localizedDescription)")
            return
        }
        let port = server.port
        if let url = URL(string: "http://localhost:\(port)/index.html") {
            webView.load(URLRequest(url: url))
        }
    }

    private func loadFailure(_ msg: String) {
        let html = "<body style=\"background:#05070a;color:#7CFF00;font:15px monospace;padding:24px\">\(msg)</body>"
        webView.loadHTMLString(html, baseURL: nil)
    }

    // MARK: - The native bridge (what the sandbox cannot do from JS)

    func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "j3", let body = message.body as? [String: Any],
              let action = body["action"] as? String else { return }
        switch action {
        case "save":  handleSave(body)
        case "share": handleShare(body)
        case "open":  handleOpen(body)
        default: break
        }
    }

    /// Decodes a base64 payload, writes it to a temp file, and presents the
    /// share sheet so the user can drop it into Files, AirDrop, etc.
    private func handleSave(_ body: [String: Any]) {
        guard let name = body["name"] as? String,
              let b64 = body["b64"] as? String,
              let data = Data(base64Encoded: b64) else { return }
        let safe = name.replacingOccurrences(of: "/", with: "_")
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(safe)
        do { try data.write(to: url) } catch { return }
        presentShare([url])
    }

    private func handleShare(_ body: [String: Any]) {
        var items: [Any] = []
        if let subject = body["subject"] as? String, !subject.isEmpty { items.append(subject) }
        if let text = body["text"] as? String { items.append(text) }
        guard !items.isEmpty else { return }
        presentShare(items)
    }

    private func handleOpen(_ body: [String: Any]) {
        guard let s = body["url"] as? String, let url = URL(string: s) else { return }
        UIApplication.shared.open(url)
    }

    // MARK: - Files opened from other apps

    /// Copies a shared file in, registers it under /__file/<id>, and hands it to
    /// the web layer via J3.incoming — the same path MainActivity uses on Android.
    func receiveSharedFile(_ url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else { return }
        seq += 1
        let id = "f\(seq)"
        let tmp = FileManager.default.temporaryDirectory
            .appendingPathComponent(id + "-" + url.lastPathComponent)
        do { try data.write(to: tmp) } catch { return }
        handed[id] = tmp
        let js = "window.J3 && J3.incoming && J3.incoming({id:'\(id)',name:\(jsString(url.lastPathComponent)),size:\(data.count)})"
        // Give the page a beat if it is still booting.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
            self.webView.evaluateJavaScript(js, completionHandler: nil)
        }
    }

    private func jsString(_ s: String) -> String {
        let escaped = s
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
            .replacingOccurrences(of: "\n", with: "\\n")
        return "'\(escaped)'"
    }

    private func presentShare(_ items: [Any]) {
        DispatchQueue.main.async {
            let vc = UIActivityViewController(activityItems: items, applicationActivities: nil)
            vc.popoverPresentationController?.sourceView = self.view        // iPad
            vc.popoverPresentationController?.sourceRect = CGRect(x: self.view.bounds.midX,
                                                                  y: self.view.bounds.midY,
                                                                  width: 0, height: 0)
            self.present(vc, animated: true)
        }
    }

    // MARK: - Send real links to Safari, keep the app inside the WebView

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = navigationAction.request.url,
           let host = url.host, host != "localhost",
           url.scheme == "http" || url.scheme == "https" {
            UIApplication.shared.open(url)                 // external link -> Safari
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    deinit { server.stop() }
}
