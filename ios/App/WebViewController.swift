// J3NSONTOP INDUSTRIES - WebViewController.swift
//
// The iOS host: a WKWebView over the exact same web assets the Android app
// ships (../app/src/main/assets, bundled here as `www`). Every JS engine —
// the toolbox, APK Lab, the tamper detector — is standard web code and runs
// unchanged. Only the thin native surface differs per platform.
//
// No local web server: WebKit treats a file:// page as a secure context, so
// crypto.subtle — every SHA hash and certificate fingerprint in the app — is
// available straight from loadFileURL, with no dependency and no open port.
// (This is a WebKit-specific guarantee; Chromium does not make it, which is why
// the Android build serves over a loopback origin instead.)
//
// Files opened from other apps are handed to the page by injecting their bytes
// into window.__j3ios_files and calling J3.incoming — core.js reads them there
// instead of fetching /__file/<id>, so no server is needed for that either.

import UIKit
import WebKit
import UniformTypeIdentifiers

final class WebViewController: UIViewController, WKScriptMessageHandler, WKUIDelegate, WKNavigationDelegate {

    private var webView: WKWebView!
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

        loadLocalBundle()
    }

    // MARK: - Load the bundled app (file:// is a secure context in WebKit)

    private func loadLocalBundle() {
        let fm = FileManager.default

        // A folder reference keeps its on-disk directory name in the bundle, so
        // the web layer may sit under "www" or "assets". Try the likely names,
        // then fall back to locating index.html anywhere under the resources.
        var indexURL: URL?
        for name in ["www", "assets"] {
            if let dir = Bundle.main.url(forResource: name, withExtension: nil) {
                let idx = dir.appendingPathComponent("index.html")
                if fm.fileExists(atPath: idx.path) { indexURL = idx; break }
            }
        }
        if indexURL == nil, let res = Bundle.main.resourceURL,
           let walker = fm.enumerator(at: res, includingPropertiesForKeys: nil) {
            for case let u as URL in walker where u.lastPathComponent == "index.html" {
                indexURL = u; break
            }
        }

        guard let index = indexURL else {
            loadFailure("Bundled web assets are missing from the app.")
            return
        }
        // Read access to the folder holding index.html lets the page pull its
        // js/css/assets by their relative paths (the folder keeps its structure).
        webView.loadFileURL(index, allowingReadAccessTo: index.deletingLastPathComponent())
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

    /// Copies a shared file in and hands its bytes to the web layer by injecting
    /// them into window.__j3ios_files, then calling J3.incoming — the same entry
    /// point MainActivity uses on Android, just without a server in between.
    func receiveSharedFile(_ url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else { return }
        seq += 1
        let id = "f\(seq)"
        let b64 = data.base64EncodedString()
        let name = jsString(url.lastPathComponent)
        let js = """
        (function(){window.__j3ios_files=window.__j3ios_files||{};
        var b=atob('\(b64)');var u=new Uint8Array(b.length);
        for(var i=0;i<b.length;i++)u[i]=b.charCodeAt(i);
        window.__j3ios_files['\(id)']=u;
        window.J3&&J3.incoming&&J3.incoming({id:'\(id)',name:\(name),size:\(data.count)});})();
        """
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
           url.scheme == "http" || url.scheme == "https" {
            UIApplication.shared.open(url)                 // external link -> Safari
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }
}
