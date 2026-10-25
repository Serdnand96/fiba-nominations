import Foundation

/// URLs y claves de la app. Salen del Info.plist, que las toma de
/// `Config/*.xcconfig` (ver ios/README.md).
enum AppConfig {
    static let apiBaseURL = url("API_BASE_URL", fallback: "https://www.fibaapp.com/api")
    static let webBaseURL = url("WEB_BASE_URL", fallback: "https://www.fibaapp.com")
    static let supabaseURL = url("SUPABASE_URL", fallback: "https://mckaplalscnvaanukrmz.supabase.co")
    static let supabaseAnonKey = string("SUPABASE_ANON_KEY") ?? ""

    /// Sin anon key no hay login posible: la pantalla de login lo avisa en vez
    /// de fallar con un error de red críptico.
    static var isConfigured: Bool { !supabaseAnonKey.isEmpty }

    /// Link a la misma pantalla en la web, para los módulos que la app todavía no tiene.
    static func webURL(route: String) -> URL {
        webBaseURL.appendingPathComponent(route)
    }

    private static func string(_ key: String) -> String? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespaces)
        return trimmed.isEmpty ? nil : trimmed
    }

    private static func url(_ key: String, fallback: String) -> URL {
        if let raw = string(key), let url = URL(string: raw) { return url }
        return URL(string: fallback)!
    }
}
