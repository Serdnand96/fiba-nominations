import SwiftUI

/// Idioma de la app. Como en la web, se elige adentro de la app (no sigue el
/// idioma del sistema) y por defecto es español.
enum AppLanguage: String, CaseIterable, Identifiable {
    case es, en
    var id: String { rawValue }
    var displayName: String { self == .es ? "Español" : "English" }
}

/// Traducciones con las mismas claves que `src/i18n/translations.js`
/// (`nav.feed`, `nav.calendar`, …) para poder portarlas módulo a módulo.
enum L10n {
    static func t(_ key: String, _ lang: AppLanguage) -> String {
        strings[key]?[lang] ?? strings[key]?[.es] ?? key
    }

    static let strings: [String: [AppLanguage: String]] = [
        // ── Navegación (src/i18n/translations.js → nav) ──
        "nav.feed": [.en: "Wall", .es: "Muro"],
        "nav.calendar": [.en: "Calendar", .es: "Calendario"],
        "nav.nominations": [.en: "Nominations", .es: "Nominaciones"],
        "nav.payments": [.en: "Payments", .es: "Pagos"],
        "nav.budget": [.en: "Budget", .es: "Presupuesto"],
        "nav.personnel": [.en: "Personnel", .es: "Personal"],
        "nav.competitions": [.en: "Competitions", .es: "Competencias"],
        "nav.templates": [.en: "Templates", .es: "Templates"],
        "nav.users": [.en: "Users", .es: "Usuarios"],
        "nav.logistics": [.en: "Logistics", .es: "Logística"],
        "nav.availability": [.en: "Availability", .es: "Disponibilidad"],
        "nav.training": [.en: "Training", .es: "Entrenamientos"],
        "nav.games": [.en: "Games", .es: "Juegos"],
        "nav.inventory": [.en: "Inventory", .es: "Inventario"],
        "nav.loans": [.en: "Loans", .es: "Préstamos"],
        "nav.scan": [.en: "Scan QR", .es: "Escanear QR"],
        "nav.employees": [.en: "Employees", .es: "Empleados"],
        "nav.reports": [.en: "Reports", .es: "Reportes"],
        "nav.evaluations": [.en: "Evaluations", .es: "Evaluaciones"],
        "nav.activity": [.en: "Activity", .es: "Actividad"],
        "nav.profile": [.en: "Profile", .es: "Perfil"],
        "nav.home": [.en: "Home", .es: "Inicio"],
        "nav.more": [.en: "More", .es: "Más"],

        // ── Login ──
        "login.subtitle": [.en: "Administration", .es: "Administración"],
        "login.email": [.en: "Email", .es: "Email"],
        "login.password": [.en: "Password", .es: "Contraseña"],
        "login.submit": [.en: "Sign in", .es: "Ingresar"],
        "login.invalid": [.en: "Invalid email or password.", .es: "Email o contraseña incorrectos."],
        "login.notConfigured": [
            .en: "The app has no Supabase key configured (Config/Secrets.xcconfig).",
            .es: "La app no tiene configurada la key de Supabase (Config/Secrets.xcconfig).",
        ],

        // ── Módulos todavía no portados ──
        "module.comingSoon.title": [.en: "Coming soon to the app", .es: "Próximamente en la app"],
        "module.comingSoon.body": [
            .en: "This module is still used from the web. Your permissions are the same on both.",
            .es: "Este módulo todavía se usa desde la web. Tus permisos son los mismos en las dos.",
        ],
        "module.openWeb": [.en: "Open on the web", .es: "Abrir en la web"],
        "module.readOnly": [.en: "Read only", .es: "Solo lectura"],
        "shell.noModules.title": [.en: "No modules enabled", .es: "Sin módulos habilitados"],
        "shell.noModules.body": [
            .en: "Ask an administrator to grant you access.",
            .es: "Pedile a un administrador que te dé acceso.",
        ],

        // ── Perfil ──
        "profile.title": [.en: "My profile", .es: "Mi perfil"],
        "profile.changePhoto": [.en: "Change photo", .es: "Cambiar foto"],
        "profile.removePhoto": [.en: "Remove photo", .es: "Quitar foto"],
        "profile.preferences": [.en: "Preferences", .es: "Preferencias"],
        "profile.language": [.en: "Language", .es: "Idioma"],
        "profile.appearance": [.en: "Appearance", .es: "Apariencia"],
        "profile.appearance.system": [.en: "System", .es: "Sistema"],
        "profile.appearance.light": [.en: "Light", .es: "Claro"],
        "profile.appearance.dark": [.en: "Dark", .es: "Oscuro"],
        "profile.superadmin": [.en: "Superadmin", .es: "Superadmin"],
        "profile.signOut": [.en: "Sign out", .es: "Cerrar sesión"],
        "profile.version": [.en: "Version", .es: "Versión"],

        "common.error": [.en: "Error", .es: "Error"],
        "common.ok": [.en: "OK", .es: "OK"],
        "common.retry": [.en: "Retry", .es: "Reintentar"],
    ]
}

private struct LanguageKey: EnvironmentKey {
    static let defaultValue: AppLanguage = .es
}

extension EnvironmentValues {
    var language: AppLanguage {
        get { self[LanguageKey.self] }
        set { self[LanguageKey.self] = newValue }
    }
}
