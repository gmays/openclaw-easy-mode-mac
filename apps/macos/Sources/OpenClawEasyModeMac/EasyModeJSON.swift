import Foundation

enum EasyModeJSONValue: Codable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: EasyModeJSONValue])
    case array([EasyModeJSONValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([String: EasyModeJSONValue].self) {
            self = .object(value)
        } else if let value = try? container.decode([EasyModeJSONValue].self) {
            self = .array(value)
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSON value.")
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case let .string(value):
            try container.encode(value)
        case let .number(value):
            try container.encode(value)
        case let .bool(value):
            try container.encode(value)
        case let .object(value):
            try container.encode(value)
        case let .array(value):
            try container.encode(value)
        case .null:
            try container.encodeNil()
        }
    }

    static func fromFoundation(_ value: Any) -> EasyModeJSONValue? {
        switch value {
        case let string as String:
            return .string(string)
        case let number as NSNumber:
            if CFGetTypeID(number) == CFBooleanGetTypeID() {
                return .bool(number.boolValue)
            }
            return .number(number.doubleValue)
        case let bool as Bool:
            return .bool(bool)
        case let array as [Any]:
            return .array(array.compactMap(Self.fromFoundation))
        case let object as [String: Any]:
            let converted = object.compactMapValues(Self.fromFoundation)
            return .object(converted)
        default:
            return nil
        }
    }
}
