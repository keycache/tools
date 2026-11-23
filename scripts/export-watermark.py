"""Export the pinned FODUU state_dict without executing downloaded Python code.

Architecture adapted from foduucom/Watermark_Removal at
e75b840dc74b7d213833c4ef5cc1cea63c19e81d (declared Apache-2.0).
Changes: export-only wrapper, functional pooling/upsampling, and numerical checks.
See public/licenses/image-models.txt and the distributed Apache-2.0 license.
"""

from pathlib import Path
import sys

import numpy as np
import onnx
import onnxruntime as ort
import torch
from torch import nn


class WatermarkRemover(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.enc1 = self.block(3, 64)
        self.enc2 = self.block(64, 128)
        self.enc3 = self.block(128, 256)
        self.enc4 = self.block(256, 512)
        self.bottleneck = self.block(512, 1024)
        self.dec4 = self.block(1536, 512)
        self.dec3 = self.block(768, 256)
        self.dec2 = self.block(384, 128)
        self.dec1 = self.block(192, 64)
        self.final_layer = nn.Conv2d(64, 3, kernel_size=1)

    @staticmethod
    def block(inputs: int, outputs: int) -> nn.Sequential:
        return nn.Sequential(
            nn.Conv2d(inputs, outputs, 3, padding=1), nn.ReLU(inplace=True),
            nn.Conv2d(outputs, outputs, 3, padding=1), nn.ReLU(inplace=True),
        )

    def forward(self, image):
        e1 = self.enc1(image)
        e2 = self.enc2(nn.functional.max_pool2d(e1, 2))
        e3 = self.enc3(nn.functional.max_pool2d(e2, 2))
        e4 = self.enc4(nn.functional.max_pool2d(e3, 2))
        result = self.bottleneck(nn.functional.max_pool2d(e4, 2))
        for block, skip in ((self.dec4, e4), (self.dec3, e3), (self.dec2, e2), (self.dec1, e1)):
            result = block(torch.cat((nn.functional.interpolate(result, scale_factor=2, mode="nearest"), skip), dim=1))
        return self.final_layer(result)


def export(checkpoint: Path, destination: Path) -> None:
    torch.set_num_threads(2)
    torch.manual_seed(0)
    model = WatermarkRemover()
    model.load_state_dict(torch.load(checkpoint, map_location="cpu", weights_only=True))
    model.eval()
    sample = torch.rand(1, 3, 256, 256)
    temporary = destination.with_suffix(".partial.onnx")
    try:
        with torch.inference_mode():
            torch.onnx.export(
                model, sample, str(temporary), input_names=["image"], output_names=["output"],
                opset_version=17, dynamo=False, external_data=False,
            )
        onnx.checker.check_model(str(temporary))
        options = ort.SessionOptions()
        options.intra_op_num_threads = 2
        runtime = ort.InferenceSession(str(temporary), sess_options=options, providers=["CPUExecutionProvider"])
        for label, image in (("random", sample), ("black", torch.zeros_like(sample)), ("white", torch.ones_like(sample))):
            with torch.inference_mode():
                expected = model(image).numpy()
            actual = runtime.run(None, {"image": image.numpy()})[0]
            np.testing.assert_allclose(actual, expected, rtol=1e-3, atol=1e-4)
            print(f"{label} ONNX parity: max absolute error {np.max(np.abs(actual - expected)):.8f}")
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: export-watermark.py checkpoint.pth output.onnx")
    export(Path(sys.argv[1]), Path(sys.argv[2]))
