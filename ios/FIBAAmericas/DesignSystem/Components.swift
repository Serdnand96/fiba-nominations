import SwiftUI

/// CTA principal: naranja basketball, como `<Button variant="primary">`.
struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.plex(16, .semibold))
            .frame(maxWidth: .infinity, minHeight: 48)
            .foregroundStyle(.white)
            .background(Color.accent.opacity(isEnabled ? (configuration.isPressed ? 0.85 : 1) : 0.4))
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

/// Estado vacío con ícono, título, texto y una acción opcional.
struct EmptyStateView<Action: View>: View {
    let systemImage: String
    let title: String
    let message: String
    @ViewBuilder var action: () -> Action

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: systemImage)
                .font(.system(size: 40, weight: .light))
                .foregroundStyle(Color.textSecondary)
            Text(title)
                .font(.plex(18, .semibold, relativeTo: .headline))
                .foregroundStyle(Color.textPrimary)
            Text(message)
                .font(.plex(15, relativeTo: .subheadline))
                .foregroundStyle(Color.textSecondary)
                .multilineTextAlignment(.center)
            action()
                .padding(.top, 6)
        }
        .padding(32)
        .frame(maxWidth: 420)
    }
}

extension EmptyStateView where Action == EmptyView {
    init(systemImage: String, title: String, message: String) {
        self.init(systemImage: systemImage, title: title, message: message) { EmptyView() }
    }
}

/// Píldora chica (estado, rol, "Solo lectura").
struct Badge: View {
    let text: String
    var color: Color = .textSecondary

    var body: some View {
        Text(text)
            .font(.plex(12, .medium, relativeTo: .caption))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .foregroundStyle(color)
            .background(color.opacity(0.12), in: Capsule())
    }
}

/// Foto de perfil con fallback a iniciales (como el sidebar de la web).
struct AvatarView: View {
    let url: String?
    let name: String
    var size: CGFloat = 40

    var body: some View {
        Group {
            if let url, let parsed = URL(string: url) {
                AsyncImage(url: parsed) { phase in
                    if let image = phase.image {
                        image.resizable().scaledToFill()
                    } else {
                        initials
                    }
                }
            } else {
                initials
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityLabel(name)
    }

    private var initials: some View {
        ZStack {
            Circle().fill(Color.navy700)
            Text(Self.initials(for: name))
                .font(.plex(size * 0.38, .semibold))
                .foregroundStyle(.white)
        }
    }

    /// "ana.perez@fiba.basketball" → "AP"; "Ana Pérez" → "AP".
    nonisolated static func initials(for name: String) -> String {
        let base = name.split(separator: "@").first.map(String.init) ?? name
        let parts = base.split(whereSeparator: { $0 == " " || $0 == "." || $0 == "_" || $0 == "-" })
        let letters = parts.prefix(2).compactMap(\.first).map { String($0).uppercased() }
        return letters.isEmpty ? "?" : letters.joined()
    }
}
