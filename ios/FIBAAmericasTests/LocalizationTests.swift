import XCTest
@testable import FIBAAmericas

final class LocalizationTests: XCTestCase {
    func testEveryNavItemIsTranslated() {
        for item in NavItem.all {
            for lang in AppLanguage.allCases {
                XCTAssertNotEqual(L10n.t(item.labelKey, lang), item.labelKey, "\(item.labelKey) sin \(lang)")
            }
        }
    }

    func testEveryKeyHasBothLanguages() {
        for (key, values) in L10n.strings {
            XCTAssertNotNil(values[.es], "\(key) sin es")
            XCTAssertNotNil(values[.en], "\(key) sin en")
        }
    }

    func testInitials() {
        XCTAssertEqual(AvatarView.initials(for: "ana.perez@fiba.basketball"), "AP")
        XCTAssertEqual(AvatarView.initials(for: "Gino Rullo"), "GR")
        XCTAssertEqual(AvatarView.initials(for: ""), "?")
    }
}
