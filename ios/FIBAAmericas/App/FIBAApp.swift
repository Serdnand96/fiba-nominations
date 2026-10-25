import SwiftUI

@main
struct FIBAApp: App {
    @State private var auth = AuthStore()
    @AppStorage("fiba_lang") private var language: AppLanguage = .es
    @AppStorage("fiba_appearance") private var appearance: AppAppearance = .dark

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(auth)
                .environment(\.language, language)
                .preferredColorScheme(appearance.colorScheme)
                .tint(Color.accent)
                .task { await auth.start() }
        }
    }
}

/// Login o la app, según la sesión.
struct RootView: View {
    @Environment(AuthStore.self) private var auth

    var body: some View {
        switch auth.phase {
        case .loading:
            ZStack {
                Color.navy900.ignoresSafeArea()
                ProgressView().tint(.white)
            }
        case .signedOut:
            LoginView()
        case .signedIn:
            ShellView()
        }
    }
}
