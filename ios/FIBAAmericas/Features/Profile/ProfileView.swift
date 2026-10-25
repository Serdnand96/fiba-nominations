import PhotosUI
import SwiftUI

/// "Mi perfil": foto (mismo endpoint `/api/me/avatar` que la web), idioma,
/// apariencia y cerrar sesión.
struct ProfileView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.language) private var lang
    @AppStorage("fiba_lang") private var language: AppLanguage = .es
    @AppStorage("fiba_appearance") private var appearance: AppAppearance = .dark

    @State private var photoItem: PhotosPickerItem?
    @State private var isUploading = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: 16) {
                        ZStack {
                            AvatarView(url: auth.profile?.avatarURL, name: auth.email ?? "", size: 64)
                            if isUploading {
                                Circle().fill(.black.opacity(0.45)).frame(width: 64, height: 64)
                                ProgressView().tint(.white)
                            }
                        }
                        VStack(alignment: .leading, spacing: 6) {
                            Text(auth.email ?? "")
                                .font(.plex(16, .semibold))
                                .lineLimit(1)
                                .truncationMode(.middle)
                            if auth.isSuperadmin {
                                Badge(text: L10n.t("profile.superadmin", lang), color: .accent)
                            }
                        }
                    }
                    .padding(.vertical, 4)

                    PhotosPicker(selection: $photoItem, matching: .images) {
                        Label(L10n.t("profile.changePhoto", lang), systemImage: "photo")
                    }
                    .disabled(isUploading)

                    if auth.profile?.avatarURL != nil {
                        Button(role: .destructive, action: removePhoto) {
                            Label(L10n.t("profile.removePhoto", lang), systemImage: "trash")
                        }
                        .disabled(isUploading)
                    }
                }

                Section(L10n.t("profile.preferences", lang)) {
                    Picker(L10n.t("profile.language", lang), selection: $language) {
                        ForEach(AppLanguage.allCases) { Text($0.displayName).tag($0) }
                    }
                    Picker(L10n.t("profile.appearance", lang), selection: $appearance) {
                        ForEach(AppAppearance.allCases) {
                            Text(L10n.t("profile.appearance.\($0.rawValue)", lang)).tag($0)
                        }
                    }
                }

                Section {
                    Button(role: .destructive) {
                        Task { await auth.signOut() }
                    } label: {
                        Label(L10n.t("profile.signOut", lang), systemImage: "rectangle.portrait.and.arrow.right")
                    }
                } footer: {
                    Text("\(L10n.t("profile.version", lang)) \(Self.version)")
                }
            }
            .navigationTitle(L10n.t("profile.title", lang))
            .refreshable { await auth.reloadProfile() }
            .onChange(of: photoItem) { _, item in
                guard let item else { return }
                upload(item)
            }
            .alert(L10n.t("common.error", lang), isPresented: Binding(
                get: { errorMessage != nil },
                set: { if !$0 { errorMessage = nil } }
            )) {
                Button(L10n.t("common.ok", lang), role: .cancel) {}
            } message: {
                Text(errorMessage ?? "")
            }
        }
    }

    private static var version: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return "\(short) (\(build))"
    }

    private func upload(_ item: PhotosPickerItem) {
        isUploading = true
        Task {
            defer {
                isUploading = false
                photoItem = nil
            }
            do {
                guard let data = try await item.loadTransferable(type: Data.self),
                      let image = UIImage(data: data),
                      let jpeg = ImageResize.squareJPEG(image) else {
                    throw APIError.server(status: 400, detail: .string("No se pudo leer la imagen."))
                }
                let response: AvatarResponse = try await auth.api.upload(
                    "/me/avatar", field: "photo", filename: "avatar.jpg", mimeType: "image/jpeg", data: jpeg)
                if auth.profile == nil {
                    await auth.reloadProfile()
                } else {
                    auth.profile?.avatarURL = response.avatarURL
                }
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func removePhoto() {
        isUploading = true
        Task {
            defer { isUploading = false }
            do {
                let _: AvatarResponse = try await auth.api.delete("/me/avatar")
                auth.profile?.avatarURL = nil
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}
