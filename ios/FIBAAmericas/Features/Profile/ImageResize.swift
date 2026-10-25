import UIKit

enum ImageResize {
    /// Recorta al centro en cuadrado y baja a `side` px, como el canvas de
    /// `ProfileModal.jsx`. El backend igual valida tipo y tamaño (2 MB).
    static func squareJPEG(_ image: UIImage, side: CGFloat = 512, quality: CGFloat = 0.85) -> Data? {
        let size = image.size
        let edge = min(size.width, size.height)
        guard edge > 0 else { return nil }
        let target = min(side, edge)
        let scale = target / edge
        let drawSize = CGSize(width: size.width * scale, height: size.height * scale)
        let origin = CGPoint(x: (target - drawSize.width) / 2, y: (target - drawSize.height) / 2)

        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: target, height: target), format: format)
        let output = renderer.image { _ in
            image.draw(in: CGRect(origin: origin, size: drawSize))
        }
        return output.jpegData(compressionQuality: quality)
    }
}
