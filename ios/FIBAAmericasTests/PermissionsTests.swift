import XCTest
@testable import FIBAAmericas

final class PermissionsTests: XCTestCase {
    private func decode(_ json: String) throws -> PermissionsResponse {
        try JSONDecoder().decode(PermissionsResponse.self, from: Data(json.utf8))
    }

    func testDecodesBackendResponse() throws {
        let response = try decode("""
        {"is_superadmin": false, "permissions": [
          {"module": "feed", "can_view": true, "can_edit": false},
          {"module": "games", "can_view": true, "can_edit": true},
          {"module": "budget", "can_view": false, "can_edit": false}
        ]}
        """)
        let perms = PermissionSet(response)
        XCTAssertFalse(perms.isSuperadmin)
        XCTAssertTrue(perms.canView(.feed))
        XCTAssertFalse(perms.canEdit(.feed))
        XCTAssertTrue(perms.canEdit(.games))
        XCTAssertFalse(perms.canView(.budget))
        XCTAssertFalse(perms.canView(.payments), "un módulo que no vino es sin acceso")
    }

    func testSuperadminSeesEverything() {
        let perms = PermissionSet(isSuperadmin: true)
        XCTAssertTrue(AppModule.allCases.allSatisfy { perms.canView($0) && perms.canEdit($0) })
    }

    /// Mismo orden que `allNavItems` de App.jsx, filtrado por permiso.
    func testVisibleNavFollowsWebOrderAndPermissions() throws {
        let perms = PermissionSet(try decode("""
        {"is_superadmin": false, "permissions": [
          {"module": "games", "can_view": true, "can_edit": false},
          {"module": "feed", "can_view": true, "can_edit": false},
          {"module": "assets", "can_view": true, "can_edit": false}
        ]}
        """))
        XCTAssertEqual(NavItem.visible(for: perms).map(\.route), ["muro", "games", "inventory", "scan"])
    }

    func testActivityIsSuperadminOnly() {
        let withUsers = PermissionSet(modules: ["users": ModulePermission(module: "users", canView: true, canEdit: true)])
        XCTAssertFalse(NavItem.visible(for: withUsers).contains { $0.route == "activity" })
        XCTAssertTrue(NavItem.visible(for: PermissionSet(isSuperadmin: true)).contains { $0.route == "activity" })
    }

    func testNoPermissionsMeansNoModules() {
        XCTAssertTrue(NavItem.visible(for: .none).isEmpty)
    }

    /// Tiene que coincidir con `MODULES` de api/_lib/routers/permissions.py.
    func testModulesMatchBackend() {
        let backend = ["feed", "calendar", "nominations", "payments", "budget", "personnel", "competitions",
                       "templates", "users", "logistics", "availability", "training", "games", "assets",
                       "loans", "employees", "reports", "evaluations", "comp_days", "payments_approve"]
        XCTAssertEqual(Set(AppModule.allCases.map(\.rawValue)), Set(backend))
    }

    /// El backend compara contra el `sub` del JWT, en minúsculas.
    func testBackendIDIsLowercase() {
        let id = UUID(uuidString: "6F9619FF-8B86-D011-B42D-00C04FC964FF")!
        XCTAssertEqual(AuthStore.backendID(id), "6f9619ff-8b86-d011-b42d-00c04fc964ff")
    }
}
