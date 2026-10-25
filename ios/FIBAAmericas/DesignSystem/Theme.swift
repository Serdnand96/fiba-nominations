import SwiftUI
import UIKit

/// Tokens del design system (tailwind.config.js / DESIGN_SYSTEM.md):
/// navy institucional + naranja basketball + neutros ink.
extension Color {
    // Escalas fijas
    static let navy300 = Color(hex: 0x8AA5CF)
    static let navy700 = Color(hex: 0x1A3668)
    static let navy800 = Color(hex: 0x142C4E)
    static let navy900 = Color(hex: 0x0C2340) // navy oficial FIBA
    static let navy950 = Color(hex: 0x081628)
    static let basketball500 = Color(hex: 0xF57C2A)
    static let basketball600 = Color(hex: 0xD96A1A)
    static let ink50 = Color(hex: 0xF8FAFC)
    static let ink200 = Color(hex: 0xE4E8EE)
    static let ink500 = Color(hex: 0x6B7385)
    static let ink900 = Color(hex: 0x0F1320)
    static let success600 = Color(hex: 0x039855)
    static let warning600 = Color(hex: 0xDC6803)
    static let danger600 = Color(hex: 0xD92D20)

    // Semánticos, con variante oscura (el equivalente nativo de las CSS
    // variables que hacen dark-aware a los `fiba-*`).
    static let appBackground = Color(light: 0xF8FAFC, dark: 0x081628)
    static let surface = Color(light: 0xFFFFFF, dark: 0x0C2340)
    static let border = Color(light: 0xE4E8EE, dark: 0x142C4E)
    static let textPrimary = Color(light: 0x0F1320, dark: 0xFFFFFF)
    static let textSecondary = Color(light: 0x6B7385, dark: 0x8AA5CF)
    static let accent = Color.basketball500

    init(hex: UInt32, opacity: Double = 1) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255,
                  opacity: opacity)
    }

    init(light: UInt32, dark: UInt32) {
        self.init(uiColor: UIColor { traits in
            UIColor(Color(hex: traits.userInterfaceStyle == .dark ? dark : light))
        })
    }
}

/// IBM Plex Sans, la misma tipografía de la web. `relativeTo` mantiene el
/// Dynamic Type del sistema.
extension Font {
    static func plex(_ size: CGFloat, _ weight: Font.Weight = .regular,
                     relativeTo style: Font.TextStyle = .body) -> Font {
        let name: String
        switch weight {
        case .bold, .heavy, .black: name = "IBMPlexSans-Bold"
        case .semibold: name = "IBMPlexSans-SemiBold"
        case .medium: name = "IBMPlexSans-Medium"
        default: name = "IBMPlexSans-Regular"
        }
        return .custom(name, size: size, relativeTo: style)
    }
}

/// Apariencia elegida en el perfil. Default oscuro, como la web (DESIGN_SYSTEM.md).
enum AppAppearance: String, CaseIterable, Identifiable {
    case system, light, dark
    var id: String { rawValue }

    var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }
}
