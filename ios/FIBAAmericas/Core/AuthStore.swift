import Foundation
import Observation
import Supabase

/// Sesión, permisos y perfil del usuario. Es el `AuthContext.jsx` de la app.
///
/// El login es contra Supabase Auth con la anon key, igual que la web. La
/// sesión (access + refresh token) la guarda supabase-swift en el **Keychain**;
/// no se escribe en UserDefaults ni en disco.
@MainActor
@Observable
final class AuthStore {
    enum Phase: Equatable {
        case loading, signedOut, signedIn
    }

    private(set) var phase: Phase = .loading
    private(set) var userID: String?
    private(set) var email: String?
    private(set) var permissions: PermissionSet = .none
    var profile: MeProfile?

    let supabase: SupabaseClient
    let api: APIClient

    init() {
        let client = SupabaseClient(
            supabaseURL: AppConfig.supabaseURL,
            // Sin key igual se construye: el login avisa que falta configurarla.
            supabaseKey: AppConfig.isConfigured ? AppConfig.supabaseAnonKey : "missing-anon-key"
        )
        supabase = client
        // `session` refresca el access token si está por vencer.
        api = APIClient(baseURL: AppConfig.apiBaseURL) {
            try? await client.auth.session.accessToken
        }
        api.onUnauthorized = { [weak self] in
            Task { @MainActor in await self?.signOut() }
        }
    }

    var isSuperadmin: Bool { permissions.isSuperadmin }
    func canView(_ module: AppModule) -> Bool { permissions.canView(module) }
    func canEdit(_ module: AppModule) -> Bool { permissions.canEdit(module) }

    /// Escucha los cambios de sesión durante toda la vida de la app
    /// (sesión inicial desde el Keychain, refresh, logout).
    func start() async {
        for await (event, session) in supabase.auth.authStateChanges {
            switch event {
            case .initialSession, .signedIn, .tokenRefreshed, .userUpdated:
                if let session {
                    if userID != Self.backendID(session.user.id) || phase != .signedIn {
                        await load(session)
                    }
                } else {
                    clear()
                }
            case .signedOut:
                clear()
            default:
                break
            }
        }
    }

    func signIn(email: String, password: String) async throws {
        let session = try await supabase.auth.signIn(email: email, password: password)
        await load(session)
    }

    func signOut() async {
        try? await supabase.auth.signOut()
        clear()
    }

    func reloadProfile() async {
        profile = try? await api.get("/me")
    }

    /// El backend compara el `user_id` contra el `sub` del JWT, que va en
    /// minúsculas. `UUID.uuidString` sale en MAYÚSCULAS: sin esto, pedir los
    /// permisos propios da 403.
    nonisolated static func backendID(_ id: UUID) -> String {
        id.uuidString.lowercased()
    }

    private func load(_ session: Session) async {
        let id = Self.backendID(session.user.id)
        userID = id
        email = session.user.email

        async let perms: PermissionsResponse = api.get("/permissions/\(id)")
        async let me: MeProfile = api.get("/me")

        // Como la web: si los permisos no cargan, sin acceso (falla cerrado).
        do {
            let response = try await perms
            permissions = PermissionSet(response)
        } catch {
            permissions = .none
        }
        // La foto nunca bloquea el login: sin perfil, el avatar cae a las iniciales.
        profile = try? await me
        // Un 401 en el medio ya cerró la sesión: no la reabrimos.
        if userID == id { phase = .signedIn }
    }

    private func clear() {
        userID = nil
        email = nil
        permissions = .none
        profile = nil
        phase = .signedOut
    }
}
