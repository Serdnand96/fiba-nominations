import Foundation

/// Errores del backend, ya interpretados para la UI.
enum APIError: Error, Equatable, LocalizedError {
    /// No hay sesión: el request ni salió.
    case notAuthenticated
    /// 401: el JWT venció o fue revocado. El AuthStore cierra la sesión.
    case unauthorized
    /// 403: falta el permiso del módulo. Los guards de la app son UX; el que manda es el backend.
    case forbidden(String?)
    /// Cualquier otro status ≥ 400, con el `detail` de FastAPI tal cual.
    case server(status: Int, detail: JSONValue?)
    case network(String)
    case decoding(String)

    static func from(status: Int, data: Data) -> APIError {
        let detail = (try? JSONDecoder().decode(ErrorBody.self, from: data))?.detail
        switch status {
        case 401: return .unauthorized
        case 403: return .forbidden(Self.message(from: detail))
        default: return .server(status: status, detail: detail)
        }
    }

    /// Campos que faltan para generar una carta (`422 {code: "missing_fields", missing: [...]}`).
    var missingFields: [String]? {
        guard case .server(422, let detail?) = self,
              detail["code"]?.stringValue == "missing_fields",
              case .array(let items)? = detail["missing"] else { return nil }
        return items.compactMap(\.stringValue)
    }

    var status: Int? {
        switch self {
        case .unauthorized: return 401
        case .forbidden: return 403
        case .server(let status, _): return status
        default: return nil
        }
    }

    var errorDescription: String? {
        switch self {
        case .notAuthenticated, .unauthorized: return "Tu sesión venció. Volvé a ingresar."
        case .forbidden(let msg): return msg ?? "No tenés permiso para esta acción."
        case .server(let status, let detail): return Self.message(from: detail) ?? "Error del servidor (\(status))."
        case .network(let msg): return msg
        case .decoding: return "La respuesta del servidor no tiene el formato esperado."
        }
    }

    /// Texto legible de un `detail`: string tal cual, lista de Pydantic unida por
    /// `msg`, dict por `message`/`detail`/`code`.
    static func message(from detail: JSONValue?) -> String? {
        switch detail {
        case .string(let s)?: return s
        case .array(let items)?:
            let msgs = items.compactMap { $0["msg"]?.stringValue ?? $0.stringValue }
            return msgs.isEmpty ? nil : msgs.joined(separator: "\n")
        case .object?:
            return detail?["message"]?.stringValue ?? detail?["detail"]?.stringValue ?? detail?["code"]?.stringValue
        default: return nil
        }
    }

    private struct ErrorBody: Decodable { let detail: JSONValue? }
}
