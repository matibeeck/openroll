#!/usr/bin/env python
"""Re-export Transkun 2.0 (pip `transkun==2.0.1`, MIT, (c) 2021 Yujia Yan) to ONNX for OpenRoll.

Adapted from the MIT export scripts of huggingface.co/TuesdayCrowd/transkun-onnx
(export_transkun.py + export_transkun_heads.py): same graphs, same names, no hard-coded paths.

    transkun.onnx        featuresBatch [1,T,229,6] -> S [T,T,90], ctx [90,T,256]   (opset 17)
    transkun-heads.onnx  attr [N,768] -> velLogits [N,128], ofRaw [N,4]

Also prints the front-end constants that src/converters/inputs/audio/transkun/frontend.ts
hard-codes (the 5 learned Gaussian windows are 10 numbers) and, with --compare DIR, checks the
exported graphs against other copies (e.g. the Hugging Face files) on the same random inputs.

Usage (Python 3.11/3.12; torch has no wheels for newer Pythons yet):
    uv venv -p 3.12 .venv
    VIRTUAL_ENV=.venv uv pip install transkun==2.0.1 torch torchaudio onnx onnxruntime onnxscript numpy
    .venv/bin/python scripts/transkun/export_onnx.py OUT_DIR [--compare HF_DIR]
"""
import argparse
import os

import numpy as np
import torch
import torch.nn.functional as F

ap = argparse.ArgumentParser()
ap.add_argument("out")
ap.add_argument("--compare", help="directory with another transkun.onnx / transkun-heads.onnx to compare against")
args = ap.parse_args()
os.makedirs(args.out, exist_ok=True)
torch.manual_seed(0)
np.random.seed(0)

import moduleconf
import transkun

tk_dir = os.path.dirname(transkun.__file__)
cm = moduleconf.parseFromFile(os.path.join(tk_dir, "pretrained", "2.0.conf"))
model = cm["Model"].module.TransKun(conf=cm["Model"].config)
ckpt = torch.load(os.path.join(tk_dir, "pretrained", "2.0.pt"), map_location="cpu")
key = "best_state_dict" if "best_state_dict" in ckpt else "state_dict"
res = model.load_state_dict(ckpt[key], strict=False)
model.eval()
torch.set_grad_enabled(False)
# Gradient checkpointing is a training-time memory trick (same outputs); newer torch versions cannot
# trace through it, so the export runs the layers directly.
model.backbone.useGradientCheckpoint = False
print(f"[1] transkun {tk_dir}: {key}, missing={len(res.missing_keys)} unexpected={len(res.unexpected_keys)}")

# The backbone calls SDPA on 5-D tensors; the ONNX exporter only supports 4-D. SDPA batches every dim
# before the last two, so folding the two leading dims is an identity (checked below).
_sdpa = F.scaled_dot_product_attention


def _sdpa4d(q, k, v, *a, **kw):
    if q.ndim == 5:
        B, X, H, L, D = q.shape
        r = lambda t: t.reshape(B * X, H, L, D)
        return _sdpa(r(q), r(k), r(v), *a, **kw).reshape(B, X, H, L, D)
    return _sdpa(q, k, v, *a, **kw)


F.scaled_dot_product_attention = _sdpa4d
torch.nn.functional.scaled_dot_product_attention = _sdpa4d

import onnx
import onnxruntime as ort


def consolidate(split_path, single_path):
    m = onnx.load(split_path)
    onnx.save(m, single_path, save_as_external_data=False)
    os.remove(split_path)
    if os.path.exists(split_path + ".data"):
        os.remove(split_path + ".data")


class MainWrapper(torch.nn.Module):
    def __init__(self, m):
        super().__init__()
        self.backbone = m.backbone
        self.scorer = m.scorer
        self.register_buffer("outputIndices", torch.tensor(m.targetMIDIPitch))

    def forward(self, featuresBatch):
        ctx = self.backbone(featuresBatch, outputIndices=self.outputIndices)  # [1,90,T,256]
        S_batch, _ = self.scorer(ctx)  # [T,T,1,90]; the skip score is 0
        return S_batch.flatten(-2, -1), ctx.squeeze(0)


class HeadWrapper(torch.nn.Module):
    def __init__(self, m):
        super().__init__()
        self.vel = m.velocityPredictor
        self.of = m.refinedOFPredictor

    def forward(self, attr):
        return self.vel(attr), self.of(attr)


main = MainWrapper(model).eval()
heads = HeadWrapper(model).eval()

split = os.path.join(args.out, "_main.onnx")
torch.onnx.export(main, (torch.randn(1, 64, 229, 6),), split, opset_version=17,
                  input_names=["featuresBatch"], output_names=["S", "ctx"],
                  dynamic_axes={"featuresBatch": {1: "T"}, "S": {0: "T", 1: "T"}, "ctx": {1: "T"}})
main_path = os.path.join(args.out, "transkun.onnx")
consolidate(split, main_path)
hsplit = os.path.join(args.out, "_heads.onnx")
torch.onnx.export(heads, (torch.randn(7, 768),), hsplit, opset_version=17,
                  input_names=["attr"], output_names=["velLogits", "ofRaw"],
                  dynamic_axes={"attr": {0: "N"}, "velLogits": {0: "N"}, "ofRaw": {0: "N"}})
heads_path = os.path.join(args.out, "transkun-heads.onnx")
consolidate(hsplit, heads_path)
print(f"[2] wrote transkun.onnx {os.path.getsize(main_path)/1e6:.1f} MB, "
      f"transkun-heads.onnx {os.path.getsize(heads_path)/1e6:.2f} MB")


def corr(a, b):
    return float(np.corrcoef(np.asarray(a).ravel(), np.asarray(b).ravel())[0, 1])


def rel(a, b):
    a, b = np.asarray(a), np.asarray(b)
    return float(np.abs(a - b).max() / (np.abs(a).max() + 1e-9))


feat = torch.randn(1, 100, 229, 6)
attr = torch.randn(9, 768)
S_t, ctx_t = main(feat)
v_t, o_t = heads(attr)
sess = ort.InferenceSession(main_path, providers=["CPUExecutionProvider"])
hsess = ort.InferenceSession(heads_path, providers=["CPUExecutionProvider"])
S_o, ctx_o = sess.run(None, {"featuresBatch": feat.numpy()})
v_o, o_o = hsess.run(None, {"attr": attr.numpy()})
print(f"[3] ONNX vs PyTorch (T=100): S corr {corr(S_t, S_o):.6f} maxRelErr {rel(S_t, S_o):.1e}; "
      f"ctx corr {corr(ctx_t, ctx_o):.6f}; vel corr {corr(v_t, v_o):.6f}; of corr {corr(o_t, o_o):.6f}")

if args.compare:
    s2 = ort.InferenceSession(os.path.join(args.compare, "transkun.onnx"), providers=["CPUExecutionProvider"])
    h2 = ort.InferenceSession(os.path.join(args.compare, "transkun-heads.onnx"), providers=["CPUExecutionProvider"])
    S_c, ctx_c = s2.run(None, {"featuresBatch": feat.numpy()})
    v_c, o_c = h2.run(None, {"attr": attr.numpy()})
    print(f"[4] {args.compare} vs this export: S maxRelErr {rel(S_o, S_c):.1e} (corr {corr(S_o, S_c):.6f}); "
          f"ctx maxRelErr {rel(ctx_o, ctx_c):.1e}; vel maxRelErr {rel(v_o, v_c):.1e}; of maxRelErr {rel(o_o, o_c):.1e}")

    # Weights: every raw initializer of the other graph must also be in this one, byte for byte.
    def inits(path):
        return {(tuple(t.dims), t.raw_data) for t in onnx.load(path).graph.initializer if t.raw_data}

    for name in ["transkun.onnx", "transkun-heads.onnx"]:
        a, b = inits(os.path.join(args.out, name)), inits(os.path.join(args.compare, name))
        big = {x for x in b if len(x[1]) >= 1024}
        print(f"    {name}: {len(b & a)}/{len(b)} raw initializers byte-identical "
              f"({len(big & a)}/{len(big)} of those >= 1 KB)")

fe = model.framewiseFeatureExtractor
wg = fe.spectrogramExtractor.winGen
print("[5] front-end constants (frontend.ts):")
print("    gaussian sigma logits:", [float(x) for x in wg.sigma])
print("    gaussian center logits:", [float(x) for x in wg.center])
print("    eps", fe.eps, "fs", model.fs, "window", model.windowSize, "hop", model.hopSize,
      "segment", model.segmentSizeInSecond, "/", model.segmentHopSizeInSecond,
      "symbols", model.targetMIDIPitch[:3], "...")
