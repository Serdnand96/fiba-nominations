import Foundation

/// Una entrada del menú. Es `allNavItems` de `src/App.jsx`, en el mismo orden:
/// si el usuario tiene `feed`, el Muro queda primero y es su pantalla de entrada.
struct NavItem: Identifiable, Hashable {
    /// La ruta de la web (`/muro`, `/calendar`, …): sirve de id y para "Abrir en la web".
    let route: String
    let labelKey: String
    let module: AppModule
    let systemImage: String
    var superadminOnly = false

    var id: String { route }

    static let all: [NavItem] = [
        NavItem(route: "muro", labelKey: "nav.feed", module: .feed, systemImage: "bubble.left.and.bubble.right"),
        NavItem(route: "calendar", labelKey: "nav.calendar", module: .calendar, systemImage: "calendar"),
        NavItem(route: "nominations", labelKey: "nav.nominations", module: .nominations, systemImage: "doc.text"),
        NavItem(route: "payments", labelKey: "nav.payments", module: .payments, systemImage: "creditcard"),
        NavItem(route: "budget", labelKey: "nav.budget", module: .budget, systemImage: "chart.pie"),
        NavItem(route: "personnel", labelKey: "nav.personnel", module: .personnel, systemImage: "person.2"),
        NavItem(route: "competitions", labelKey: "nav.competitions", module: .competitions, systemImage: "trophy"),
        NavItem(route: "templates", labelKey: "nav.templates", module: .templates, systemImage: "doc.richtext"),
        NavItem(route: "users", labelKey: "nav.users", module: .users, systemImage: "person.badge.key"),
        NavItem(route: "availability", labelKey: "nav.availability", module: .availability, systemImage: "checkmark.circle"),
        NavItem(route: "logistics", labelKey: "nav.logistics", module: .logistics, systemImage: "airplane"),
        NavItem(route: "training", labelKey: "nav.training", module: .training, systemImage: "figure.basketball"),
        NavItem(route: "games", labelKey: "nav.games", module: .games, systemImage: "sportscourt"),
        NavItem(route: "inventory", labelKey: "nav.inventory", module: .assets, systemImage: "shippingbox"),
        NavItem(route: "loans", labelKey: "nav.loans", module: .loans, systemImage: "arrow.left.arrow.right"),
        NavItem(route: "scan", labelKey: "nav.scan", module: .assets, systemImage: "qrcode.viewfinder"),
        NavItem(route: "employees", labelKey: "nav.employees", module: .employees, systemImage: "person.3"),
        NavItem(route: "reports", labelKey: "nav.reports", module: .reports, systemImage: "chart.bar.doc.horizontal"),
        NavItem(route: "evaluations", labelKey: "nav.evaluations", module: .evaluations, systemImage: "star"),
        // `activity` no es un permiso de `user_permissions`: es solo superadmin.
        NavItem(route: "activity", labelKey: "nav.activity", module: .users, systemImage: "list.bullet.rectangle",
                superadminOnly: true),
    ]

    /// Lo que ve este usuario (mismo filtro que `navItems` en App.jsx).
    static func visible(for permissions: PermissionSet) -> [NavItem] {
        all.filter { $0.superadminOnly ? permissions.isSuperadmin : permissions.canView($0.module) }
    }
}
