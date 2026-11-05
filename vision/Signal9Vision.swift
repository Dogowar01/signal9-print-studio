// signal9-vision: looks at artworks with macOS's built-in image recognition
// (Apple's Vision framework). Everything runs on the Mac; nothing is uploaded.
//
//   signal9-vision <image> [<image> ...]
//
// Prints one JSON line per image:
//   {"path": "...", "labels": [["cityscape", 0.82], ...], "print": "<base64 float32 vector>"}
// or {"path": "...", "error": "..."} if the image couldn't be read.
//
// "labels" says what's in the picture; "print" is Vision's feature print, a
// vector that lands close to other pictures with similar content.

import Foundation
import Vision

setvbuf(stdout, nil, _IOLBF, 0)

func featureFloats(_ observation: VNFeaturePrintObservation) -> [Float] {
  let data = observation.data
  switch observation.elementType {
  case .float:
    return data.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
  case .double:
    return data.withUnsafeBytes { $0.bindMemory(to: Double.self).map { Float($0) } }
  default:
    return []
  }
}

func analyse(_ path: String) -> [String: Any] {
  let handler = VNImageRequestHandler(url: URL(fileURLWithPath: path), options: [:])
  let classify = VNClassifyImageRequest()
  let featurePrint = VNGenerateImageFeaturePrintRequest()
  do {
    try handler.perform([classify, featurePrint])
  } catch {
    return ["path": path, "error": error.localizedDescription]
  }

  var out: [String: Any] = ["path": path]
  let observations = (classify.results ?? [])
    .filter { $0.confidence >= 0.1 }
    .sorted { $0.confidence > $1.confidence }
    .prefix(25)
  out["labels"] = observations.map { obs -> [Any] in
    [obs.identifier, (Double(obs.confidence) * 1000).rounded() / 1000]
  }
  if let fp = featurePrint.results?.first {
    let floats = featureFloats(fp)
    out["print"] = floats.withUnsafeBufferPointer { Data(buffer: $0) }.base64EncodedString()
  }
  return out
}

for path in CommandLine.arguments.dropFirst() {
  autoreleasepool {
    let result = analyse(path)
    if let data = try? JSONSerialization.data(withJSONObject: result),
       let line = String(data: data, encoding: .utf8) {
      print(line)
    }
  }
}
