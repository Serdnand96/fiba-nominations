import Foundation

/// Respuesta vacía (204, o un endpoint cuyo cuerpo no nos interesa).
struct EmptyResponse: Decodable {}

/// Cliente del backend FastAPI. Es el equivalente de `src/api/client.js`: cada
/// request lleva el JWT de Supabase como `Authorization: Bearer`.
///
/// Los modelos declaran sus `CodingKeys` en snake_case explícitos; no usamos
/// `convertFromSnakeCase` porque también reescribe claves de diccionarios
/// (ids, códigos de módulo) y eso rompe en silencio.
final class APIClient: @unchecked Sendable {
    typealias TokenProvider = @Sendable () async -> String?

    let baseURL: URL
    private let session: URLSession
    private let tokenProvider: TokenProvider
    /// Lo llama ante un 401: el AuthStore cierra la sesión.
    var onUnauthorized: (@Sendable () -> Void)?

    static let decoder = JSONDecoder()
    static let encoder = JSONEncoder()

    init(baseURL: URL, session: URLSession = .shared, tokenProvider: @escaping TokenProvider) {
        self.baseURL = baseURL
        self.session = session
        self.tokenProvider = tokenProvider
    }

    // MARK: - JSON

    func get<T: Decodable>(_ path: String, query: [String: String?] = [:]) async throws -> T {
        try await decode(perform(makeRequest("GET", path, query: query)))
    }

    func post<T: Decodable>(_ path: String, body: some Encodable) async throws -> T {
        try await decode(perform(makeRequest("POST", path, body: body)))
    }

    func put<T: Decodable>(_ path: String, body: some Encodable) async throws -> T {
        try await decode(perform(makeRequest("PUT", path, body: body)))
    }

    func patch<T: Decodable>(_ path: String, body: some Encodable) async throws -> T {
        try await decode(perform(makeRequest("PATCH", path, body: body)))
    }

    func delete<T: Decodable>(_ path: String, query: [String: String?] = [:]) async throws -> T {
        try await decode(perform(makeRequest("DELETE", path, query: query)))
    }

    // MARK: - Archivos

    /// Sube un archivo como `multipart/form-data` (fotos, Excel, .docx).
    func upload<T: Decodable>(_ path: String, field: String, filename: String,
                              mimeType: String, data: Data) async throws -> T {
        let boundary = "fiba-\(UUID().uuidString)"
        var body = Data()
        body.append("--\(boundary)\r\n")
        body.append("Content-Disposition: form-data; name=\"\(field)\"; filename=\"\(filename)\"\r\n")
        body.append("Content-Type: \(mimeType)\r\n\r\n")
        body.append(data)
        body.append("\r\n--\(boundary)--\r\n")

        var request = try await makeRequest("POST", path)
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        return try decode(await perform(request))
    }

    /// Baja un archivo privado (PDF de una carta, export) con el JWT y lo deja en
    /// un temporal listo para QuickLook o el share sheet. Es el equivalente de
    /// `downloadNominationBlob`: el bucket `nominations` es privado, nunca se
    /// arma una URL pública.
    ///
    /// `method` es POST en los endpoints que tienen que quedar en el activity
    /// log (W-8, banking): no los pases a GET.
    func download(_ path: String, method: String = "GET", body: (any Encodable)? = nil,
                  query: [String: String?] = [:], fallbackName: String = "archivo") async throws -> URL {
        var request = try await makeRequest(method, path, query: query)
        if let body {
            request.httpBody = try Self.encoder.encode(body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await perform(request)
        let name = Self.filename(fromContentDisposition: response.value(forHTTPHeaderField: "Content-Disposition"))
            ?? fallbackName
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent(name)
        try data.write(to: url, options: .completeFileProtection)
        return url
    }

    // MARK: - Internos

    func makeRequest(_ method: String, _ path: String, query: [String: String?] = [:],
                     body: (any Encodable)? = nil) async throws -> URLRequest {
        guard let token = await tokenProvider() else { throw APIError.notAuthenticated }
        var request = URLRequest(url: try url(for: path, query: query))
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.httpBody = try Self.encoder.encode(body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return request
    }

    func url(for path: String, query: [String: String?] = [:]) throws -> URL {
        let trimmed = path.hasPrefix("/") ? String(path.dropFirst()) : path
        let full = trimmed.isEmpty ? baseURL : baseURL.appendingPathComponent(trimmed)
        guard var components = URLComponents(url: full, resolvingAgainstBaseURL: false) else {
            throw APIError.network("URL inválida: \(path)")
        }
        let items = query.compactMap { key, value in value.map { URLQueryItem(name: key, value: $0) } }
            .sorted { $0.name < $1.name }
        components.queryItems = items.isEmpty ? nil : items
        guard let url = components.url else { throw APIError.network("URL inválida: \(path)") }
        return url
    }

    private func perform(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError.network(error.localizedDescription)
        }
        guard let http = response as? HTTPURLResponse else {
            throw APIError.network("Respuesta inválida del servidor.")
        }
        guard (200..<300).contains(http.statusCode) else {
            let error = APIError.from(status: http.statusCode, data: data)
            if error == .unauthorized { onUnauthorized?() }
            throw error
        }
        return (data, http)
    }

    private func decode<T: Decodable>(_ result: (Data, HTTPURLResponse)) throws -> T {
        let data = result.0
        if T.self == EmptyResponse.self, data.isEmpty || data == Data("null".utf8) {
            return EmptyResponse() as! T
        }
        do {
            return try Self.decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decoding(String(describing: error))
        }
    }

    /// `attachment; filename="carta.pdf"` o `filename*=UTF-8''carta%20x.pdf`.
    static func filename(fromContentDisposition header: String?) -> String? {
        guard let header else { return nil }
        for part in header.split(separator: ";").map({ $0.trimmingCharacters(in: .whitespaces) }) {
            if part.lowercased().hasPrefix("filename*=") {
                let value = part.dropFirst("filename*=".count)
                let encoded = value.components(separatedBy: "''").last ?? String(value)
                if let decoded = encoded.removingPercentEncoding, !decoded.isEmpty { return sanitize(decoded) }
            }
        }
        for part in header.split(separator: ";").map({ $0.trimmingCharacters(in: .whitespaces) }) {
            if part.lowercased().hasPrefix("filename=") {
                let value = part.dropFirst("filename=".count).trimmingCharacters(in: CharacterSet(charactersIn: "\""))
                if !value.isEmpty { return sanitize(value) }
            }
        }
        return nil
    }

    /// Un nombre de archivo nunca puede escaparse del directorio temporal.
    private static func sanitize(_ name: String) -> String {
        let cleaned = name.replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "\\", with: "_")
        return cleaned == ".." || cleaned == "." ? "archivo" : cleaned
    }
}

private extension Data {
    mutating func append(_ string: String) {
        append(Data(string.utf8))
    }
}
