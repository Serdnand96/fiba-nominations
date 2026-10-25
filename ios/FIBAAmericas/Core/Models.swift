import Foundation

/// `GET /api/me` (router `profile.py`): quién soy para la UI.
struct MeProfile: Codable, Equatable {
    let id: String
    let email: String?
    var avatarURL: String?

    enum CodingKeys: String, CodingKey {
        case id, email
        case avatarURL = "avatar_url"
    }
}

/// `POST /api/me/avatar` y `DELETE /api/me/avatar`.
struct AvatarResponse: Codable, Equatable {
    let avatarURL: String?

    enum CodingKeys: String, CodingKey {
        case avatarURL = "avatar_url"
    }
}
