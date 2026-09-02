// J3NSONTOP INDUSTRIES - SceneDelegate.swift
//
// No storyboard: the window is built in code and rooted at the WebViewController.
import UIKit

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession,
               options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = WebViewController()
        self.window = window
        window.makeKeyAndVisible()

        // An APK opened from Files / another app arrives here.
        if let ctx = connectionOptions.urlContexts.first { handleIncoming(ctx.url) }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        if let ctx = URLContexts.first { handleIncoming(ctx.url) }
    }

    /// Copies the shared file into the app and hands it to the web layer via
    /// J3.incoming(), the same entry point the Android side uses.
    private func handleIncoming(_ url: URL) {
        guard let vc = window?.rootViewController as? WebViewController else { return }
        vc.receiveSharedFile(url)
    }
}
