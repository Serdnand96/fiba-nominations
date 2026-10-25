import Foundation

/// Los módulos de `user_permissions.module`. Tiene que coincidir con `MODULES`
/// de `api/_lib/routers/permissions.py` y de `src/pages/Users.jsx`
/// (CLAUDE.md, punto 10: al agregar un permiso, sumarlo también acá).
enum AppModule: String, CaseIterable, Codable {
    case feed, calendar, nominations, payments, budget, personnel, competitions
    case templates, users, logistics, availability, training, games, assets
    case loans, employees, reports, evaluations
    /// No son páginas: recortan datos dentro de otra (Employees, Payments).
    case compDays = "comp_days"
    case paymentsApprove = "payments_approve"
}

struct ModulePermission: Codable, Equatable {
    let module: String
    let canView: Bool
    let canEdit: Bool

    enum CodingKeys: String, CodingKey {
        case module
        case canView = "can_view"
        case canEdit = "can_edit"
    }
}

/// Respuesta de `GET /api/permissions/{user_id}` (la misma que lee `AuthContext.jsx`).
struct PermissionsResponse: Codable, Equatable {
    let isSuperadmin: Bool
    let permissions: [ModulePermission]

    enum CodingKeys: String, CodingKey {
        case isSuperadmin = "is_superadmin"
        case permissions
    }
}

/// Permisos ya resueltos del usuario logueado. Como en la web, esto es UX:
/// esconde lo que no corresponde, pero el que decide es el backend
/// (`require_view` / `require_edit`).
struct PermissionSet: Equatable {
    var isSuperadmin = false
    var modules: [String: ModulePermission] = [:]

    static let none = PermissionSet()

    init(isSuperadmin: Bool = false, modules: [String: ModulePermission] = [:]) {
        self.isSuperadmin = isSuperadmin
        self.modules = modules
    }

    init(_ response: PermissionsResponse) {
        isSuperadmin = response.isSuperadmin
        modules = Dictionary(response.permissions.map { ($0.module, $0) }, uniquingKeysWith: { _, last in last })
    }

    func canView(_ module: AppModule) -> Bool {
        isSuperadmin || modules[module.rawValue]?.canView == true
    }

    func canEdit(_ module: AppModule) -> Bool {
        isSuperadmin || modules[module.rawValue]?.canEdit == true
    }
}
