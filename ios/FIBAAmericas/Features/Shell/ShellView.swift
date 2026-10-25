import SwiftUI

/// La app logueada: una pestaña por módulo habilitado y el perfil al final.
///
/// No usamos el "Más" automático del TabView: mete su propio
/// UINavigationController y, con un NavigationStack adentro, quedan dos barras.
/// Si no entran todos, van las primeras pestañas y un "Más" propio con el resto.
struct ShellView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.language) private var lang
    @SceneStorage("shell.selected") private var selected = ""

    var body: some View {
        let layout = Self.layout(NavItem.visible(for: auth.permissions))
        TabView(selection: $selected) {
            if layout.tabs.isEmpty {
                NavigationStack { NoModulesView() }
                    .tabItem { Label(L10n.t("nav.home", lang), systemImage: "house") }
                    .tag("none")
            }
            ForEach(layout.tabs) { item in
                NavigationStack { ModuleView(item: item) }
                    .tabItem { Label(L10n.t(item.labelKey, lang), systemImage: item.systemImage) }
                    .tag(item.route)
            }
            if !layout.more.isEmpty {
                NavigationStack { MoreView(items: layout.more) }
                    .tabItem { Label(L10n.t("nav.more", lang), systemImage: "ellipsis.circle") }
                    .tag("more")
            }
            NavigationStack { ProfileView() }
                .tabItem { Label(L10n.t("nav.profile", lang), systemImage: "person.crop.circle") }
                .tag("profile")
        }
        .onAppear {
            // Primera pestaña habilitada, como el `defaultRoute` de la web.
            let valid = layout.tabs.map(\.route) + ["more", "profile"]
            if !valid.contains(selected) {
                selected = layout.tabs.first?.route ?? "profile"
            }
        }
    }

    /// Qué va en la barra y qué en "Más". Perfil siempre ocupa un lugar.
    nonisolated static func layout(_ items: [NavItem]) -> (tabs: [NavItem], more: [NavItem]) {
        let maxTabs = 5 // tope de pestañas de un iPhone, Perfil incluido
        if items.count + 1 <= maxTabs { return (items, []) }
        let direct = maxTabs - 2 // Más y Perfil
        return (Array(items.prefix(direct)), Array(items.dropFirst(direct)))
    }
}

/// Los módulos que no entraron en la barra.
struct MoreView: View {
    let items: [NavItem]
    @Environment(\.language) private var lang

    var body: some View {
        List(items) { item in
            NavigationLink {
                ModuleView(item: item)
            } label: {
                Label(L10n.t(item.labelKey, lang), systemImage: item.systemImage)
            }
        }
        .navigationTitle(L10n.t("nav.more", lang))
    }
}

/// Pantalla de un módulo (va dentro de un NavigationStack). Mientras no esté
/// portado, explica que se usa desde la web y lleva a la misma pantalla allá.
struct ModuleView: View {
    let item: NavItem
    @Environment(AuthStore.self) private var auth
    @Environment(\.language) private var lang

    var body: some View {
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

/// Sin módulos: o no tiene permisos, o no cargaron (sin red). Por eso hay reintento.
struct NoModulesView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.language) private var lang
    @State private var isRetrying = false

    var body: some View {
        ZStack {
            Color.appBackground.ignoresSafeArea()
            EmptyStateView(systemImage: "lock",
                           title: L10n.t("shell.noModules.title", lang),
                           message: L10n.t("shell.noModules.body", lang)) {
                Button {
                    isRetrying = true
                    Task {
                        await auth.reloadPermissions()
                        isRetrying = false
                    }
                } label: {
                    if isRetrying { ProgressView() } else { Text(L10n.t("common.retry", lang)) }
                }
                .buttonStyle(.bordered)
                .disabled(isRetrying)
            }
        }
    }
}
