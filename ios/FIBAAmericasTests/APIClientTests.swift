import XCTest
@testable import FIBAAmericas

final class APIClientTests: XCTestCase {
    func testStringDetail() {
        let error = APIError.from(status: 400, data: Data(#"{"detail": "Empty file"}"#.utf8))
        XCTAssertEqual(error.errorDescription, "Empty file")
        XCTAssertEqual(error.status, 400)
    }

    func testValidationListDetail() {
        let error = APIError.from(status: 422, data: Data("""
        {"detail": [{"loc": ["body", "email"], "msg": "field required"}, {"msg": "bad date"}]}
        """.utf8))
        XCTAssertEqual(error.errorDescription, "field required\nbad date")
        XCTAssertNil(error.missingFields)
    }

    /// El 422 de `POST /nominations/{id}/generate` trae un dict a propósito.
    func testMissingFieldsDetail() {
        let error = APIError.from(status: 422, data: Data("""
        {"detail": {"code": "missing_fields", "missing": ["letter_date", "window_fee"]}}
        """.utf8))
        XCTAssertEqual(error.missingFields, ["letter_date", "window_fee"])
    }

    func testAuthStatuses() {
        XCTAssertEqual(APIError.from(status: 401, data: Data()), .unauthorized)
        XCTAssertEqual(APIError.from(status: 403, data: Data(#"{"detail": "Forbidden"}"#.utf8)), .forbidden("Forbidden"))
    }

    func testNonJSONErrorBody() {
        let error = APIError.from(status: 502, data: Data("<html>Bad Gateway</html>".utf8))
        XCTAssertEqual(error, .server(status: 502, detail: nil))
        XCTAssertEqual(error.errorDescription, "Error del servidor (502).")
    }

    func testURLBuilding() throws {
        let client = APIClient(baseURL: URL(string: "https://www.fibaapp.com/api")!) { "token" }
        XCTAssertEqual(try client.url(for: "/me").absoluteString, "https://www.fibaapp.com/api/me")
        XCTAssertEqual(try client.url(for: "/personnel", query: ["role": "TD", "q": nil, "active": "true"]).absoluteString,
                       "https://www.fibaapp.com/api/personnel?active=true&role=TD")
    }

    func testRequestCarriesBearer() async throws {
        let client = APIClient(baseURL: URL(string: "https://www.fibaapp.com/api")!) { "abc" }
        let request = try await client.makeRequest("GET", "/me")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer abc")
    }

    func testNoSessionNeverSendsTheRequest() async {
        let client = APIClient(baseURL: URL(string: "https://www.fibaapp.com/api")!) { nil }
        do {
            _ = try await client.makeRequest("GET", "/me")
            XCTFail("sin sesión no se arma el request")
        } catch {
            XCTAssertEqual(error as? APIError, .notAuthenticated)
        }
    }

    func testContentDispositionFilename() {
        XCTAssertEqual(APIClient.filename(fromContentDisposition: #"attachment; filename="carta TD.pdf""#), "carta TD.pdf")
        XCTAssertEqual(APIClient.filename(fromContentDisposition: "attachment; filename*=UTF-8''Nominaci%C3%B3n.pdf"),
                       "Nominación.pdf")
        XCTAssertEqual(APIClient.filename(fromContentDisposition: #"attachment; filename="../../x.pdf""#), ".._.._x.pdf")
        XCTAssertNil(APIClient.filename(fromContentDisposition: nil))
    }

    func testMeProfileDecoding() throws {
        let me = try JSONDecoder().decode(MeProfile.self, from: Data("""
        {"id": "u1", "email": "a@b.com", "avatar_url": null}
        """.utf8))
        XCTAssertEqual(me, MeProfile(id: "u1", email: "a@b.com", avatarURL: nil))
    }
}

final class MultipartTests: XCTestCase {
    func testHeaderSafe() {
        XCTAssertEqual(APIClient.headerSafe("a\"b\r\nc.pdf"), "a'b  c.pdf")
    }
}
