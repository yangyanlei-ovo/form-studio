# Third-party notices / 第三方说明

This repository contains source code and small demo assets. It intentionally
does **not** include the Apple SHARP model (`sharp_2572gikvuh.pt`), PyTorch /
SHARP runtime, DeepSeek Harness runtime, or any API key.

## Runtime and model

- **Apple SHARP 3DGS** — model and upstream code are not distributed here.
  See Apple's upstream project and license before downloading or using the
  model.
- **DeepSeek Harness (DSH)** — installed separately by the FORM installer; not
  part of this source repository.
- **Seedream / Volcengine Ark** — proprietary cloud API, used through the user's
  own API key. Model access and terms are governed by Volcengine.
- **OpenRouter / Seedream 4.5** — optional cloud API, governed by OpenRouter
  and the model provider.
- **DeepSeek API (`deepseek-chat`)** — optional direct fallback for the Agent;
  governed by DeepSeek's API terms.

## Front-end libraries

- **Three.js** — MIT License, Copyright 2010-2025 Three.js Authors.
  Files under `assets/3dgs-vendor/three*.js`.
- **Spark** (`@sparkjsdev/spark`, PlayCanvas) — vendored under
  `assets/3dgs-vendor/spark.module.js`; see the upstream package for its
  license and notices.
- **Pass.js** — Three.js addon, MIT License.

## Assets

- `assets/living-room.png` is a demo render used by the interface.
- Screenshots under `docs/screenshots/` are project documentation.

If you redistribute a build that includes any of the excluded runtime/model
files, you are responsible for complying with their upstream licenses.
