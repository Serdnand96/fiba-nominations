import SwiftUI
import Supabase

struct LoginView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.language) private var lang

    @State private var email = ""
    @State private var password = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?
    @FocusState private var focused: Field?

    private enum Field { case email, password }

    var body: some View {
        ZStack {
            Color.navy900.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 28) {
                    VStack(spacing: 10) {
                        Image("FIBAMark")
                            .resizable()
                            .scaledToFit()
                            .frame(width: 88, height: 88)
                            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                        Text("FIBA Americas")
                            .font(.plex(26, .bold, relativeTo: .largeTitle))
                            .foregroundStyle(.white)
                        Text(L10n.t("login.subtitle", lang))
                            .font(.plex(15, .medium))
                            .foregroundStyle(Color.navy300)
                    }
                    .padding(.top, 64)

                    VStack(spacing: 14) {
                        field {
                            TextField("", text: $email,
                                      prompt: Text(L10n.t("login.email", lang)).foregroundColor(Color.navy300))
                                .textContentType(.username)
                                .keyboardType(.emailAddress)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .focused($focused, equals: .email)
                                .submitLabel(.next)
                                .onSubmit { focused = .password }
                        }
                        field {
                            SecureField("", text: $password,
                                        prompt: Text(L10n.t("login.password", lang)).foregroundColor(Color.navy300))
                                .textContentType(.password)
                                .focused($focused, equals: .password)
                                .submitLabel(.go)
                                .onSubmit(submit)
                        }

                        if let errorMessage {
                            Text(errorMessage)
                                .font(.plex(14))
                                .foregroundStyle(Color(hex: 0xFDA29B))
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }

                        Button(action: submit) {
                            if isSubmitting {
                                ProgressView().tint(.white)
                            } else {
                                Text(L10n.t("login.submit", lang))
                            }
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(!canSubmit)
                        .padding(.top, 4)
                    }
                    .frame(maxWidth: 420)

                    if !AppConfig.isConfigured {
                        Text(L10n.t("login.notConfigured", lang))
                            .font(.plex(13))
                            .foregroundStyle(Color.basketball500)
                            .multilineTextAlignment(.center)
                    }
                }
                .padding(.horizontal, 24)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
        }
    }

    private var canSubmit: Bool {
        AppConfig.isConfigured && !isSubmitting && !email.trimmingCharacters(in: .whitespaces).isEmpty && !password.isEmpty
    }

    private func field<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        content()
            .font(.plex(16))
            .foregroundStyle(.white)
            .padding(.horizontal, 14)
            .frame(height: 50)
            .background(Color.navy800, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Color.navy700))
    }

    private func submit() {
        guard canSubmit else { return }
        isSubmitting = true
        errorMessage = nil
        Task {
            defer { isSubmitting = false }
            do {
                try await auth.signIn(email: email.trimmingCharacters(in: .whitespaces), password: password)
            } catch let error as AuthError {
                // Credenciales malas: mensaje propio, sin filtrar el detalle de Supabase.
                errorMessage = error.errorCode == .invalidCredentials
                    ? L10n.t("login.invalid", lang)
                    : error.localizedDescription
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}
