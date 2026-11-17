#!/usr/bin/env python
"""Upstream reference for tests/roundtrip/transkun.test.ts: runs the PyTorch `transkun` 2.0.1 model
(MIT, (c) 2021 Yujia Yan) exactly like its CLI (`transkun.transcribe`: 16 s / 8 s segments, velocity =
argmax, mergeIncompleteEvent) on raw float32 mono 44.1 kHz audio and writes the events as JSON.

    .venv/bin/python scripts/transkun/python_reference.py AUDIO.f32 OUT.json

The test writes AUDIO.f32 (a generated piece, see the test) when run with TRANSKUN_WRITE_AUDIO=path.
"""
import json
import os
import sys

import numpy as np
import torch

import moduleconf
import transkun

tk_dir = os.path.dirname(transkun.__file__)
cm = moduleconf.parseFromFile(os.path.join(tk_dir, "pretrained", "2.0.conf"))
model = cm["Model"].module.TransKun(conf=cm["Model"].config)
ckpt = torch.load(os.path.join(tk_dir, "pretrained", "2.0.pt"), map_location="cpu")
model.load_state_dict(ckpt["best_state_dict" if "best_state_dict" in ckpt else "state_dict"], strict=False)
model.eval()
torch.set_grad_enabled(False)

audio = np.fromfile(sys.argv[1], dtype="<f4")
x = torch.from_numpy(audio).unsqueeze(-1)  # [n, 1], as the CLI's readAudio
notes = model.transcribe(x)
events = [{"start": n.start, "end": n.end, "symbol": int(n.pitch), "velocity": int(n.velocity)} for n in notes]
json.dump({"samples": int(audio.shape[0]), "events": events}, open(sys.argv[2], "w"))
print(f"{len(events)} events ({sum(e['symbol'] > 0 for e in events)} notes) from {audio.shape[0] / 44100:.2f} s")
