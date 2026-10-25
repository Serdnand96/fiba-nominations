import SwiftUI

/// La app logueada: una pestaña por módulo habilitado y el perfil al final.
/// En iPhone, lo que no entra en la barra va al "Más" del sistema.
struct ShellView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.language) private var lang
    @SceneStorage("shell.selected") private var selected = ""

    var body: some View {
        let items = NavItem.visible(for: auth.permissions)
        TabView(selection: $selected) {
            if items.isEmpty {
                NoModulesView()
                    .tabItem { Label(L10n.t("nav.home", lang), systemImage: "house") }
                    .tag("none")
            }
            ForEach(items) { item in
                ModuleView(item: item)
                    .tabItem { Label(L10n.t(item.labelKey, lang), systemImage: item.systemImage) }
                    .tag(item.route)
            }
            ProfileView()
                .tabItem { Label(L10n.t("nav.profile", lang), systemImage: "person.crop.circle") }
                .tag("profile")
        }
        .onAppear {
            // Primera pestaña habilitada, como el `defaultRoute` de la web.
            if selected.isEmpty || (selected != "profile" && !items.contains(where: { $0.route == selected })) {
                selected = items.first?.route ?? "profile"
            }
        }
    }
}

/// Pantalla de un módulo. Mientras no esté portado, explica que se usa desde
/// la web y lleva a la misma pantalla allá.
struct ModuleView: View {
    let item: NavItem
    @Environment(AuthStore.self) private var auth
    @Environment(\.language) private var lang

    var body: some View {
        NavigationStack {
            ZStack {
                Color.appBackground.ignoresSafeArea()
                EmptyStateView(systemImage: item.systemImage,
                               title: L10n.t("module.comingSoon.title", lang),
                               message: L10n.t("module.comingSoon.body", lang)) {
                    Link(destination: AppConfig.webURL(route: item.route)) {
                        Label(L10n.t("module.openWeb", lang), systemImage: "safari")
                            .padding(.horizontal, 16)
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
            .navigationTitle(L10n.t(item.labelKey, lang))
            .toolbar {
                if !auth.canEdit(item.module) && !item.superadminOnly {
                    ToolbarItem(placement: .topBarTrailing) {
                        Badge(text: L10n.t("module.readOnly", lang))
                    }
                }
            }
        }
    }
}

struct NoModulesView: View {
    @Environment(\.language) private var lang

    var body: some View {
        ZStack {
            Color.appBackground.ignoresSafeArea()
            EmptyStateView(systemImage: "lock",
                           title: L10n.t("shell.noModules.title", lang),
                           message: L10n.t("shell.noModules.body", lang))
        }
    }
}
