import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = ThemedBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

/// Paints the native view behind the web page (the status-bar inset included) in the
/// theme's page colour, light or dark with the device, mirroring src/styles/theme.js.
class ThemedBridgeViewController: CAPBridgeViewController {

    private let page = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor( red: 0x00 / 255, green: 0x2B / 255, blue: 0x36 / 255, alpha: 1 )
            : UIColor( red: 0xF7 / 255, green: 0xF6 / 255, blue: 0xF2 / 255, alpha: 1 )
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = page
        webView?.isOpaque = false
        webView?.backgroundColor = page
        webView?.scrollView.backgroundColor = page
    }
}
