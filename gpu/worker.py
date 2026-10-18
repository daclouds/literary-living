"""One Nosana allocation, one image, then exit. No web server or wallet secrets."""
import io
import os
import sys
import time
from urllib.parse import urlparse

import requests


def render_image(spec):
    import torch
    from diffusers import StableDiffusionXLPipeline

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA GPU is unavailable")
    pipe = StableDiffusionXLPipeline.from_pretrained(
        spec["model"], revision=spec["revision"],
        torch_dtype=torch.float16, use_safetensors=True, variant="fp16",
    ).to("cuda")
    pipe.enable_vae_slicing()
    pipe.enable_vae_tiling()
    generator = torch.Generator(device="cuda").manual_seed(spec["seed"])
    with torch.inference_mode():
        image = pipe(
            prompt=spec["prompt"], negative_prompt=spec["negativePrompt"],
            width=spec["width"], height=spec["height"],
            num_inference_steps=spec["steps"], guidance_scale=7.0,
            generator=generator,
        ).images[0]
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def run(callback_url, job_id, token, renderer=render_image, session=None):
    if urlparse(callback_url).scheme != "https":
        raise ValueError("A public HTTPS callback URL is required")
    session = session or requests.Session()
    # Bearer credentials are never sent through redirects to another host.
    headers = {"Authorization": "Bearer " + token}
    base = callback_url.rstrip("/") + "/api/worker/jobs/" + job_id
    claimed = session.post(base + "/claim", headers=headers, timeout=30, allow_redirects=False)
    if claimed.status_code == 409:
        print("Job already claimed or terminal; exiting without inference")
        return
    claimed.raise_for_status()
    spec = claimed.json()
    try:
        image = renderer(spec)
        for attempt in range(3):
            try:
                response = session.put(base + "/image", data=image,
                                       headers={**headers, "Content-Type": "image/png"},
                                       timeout=90, allow_redirects=False)
                response.raise_for_status()
                break
            except requests.RequestException:
                if attempt == 2:
                    raise
                time.sleep(2 ** attempt)
        print("Image uploaded successfully; GPU process exiting")
    except Exception:
        # Keep exception messages and URLs out of logs: they may contain capabilities.
        try:
            session.post(base + "/fail", json={"code": "INFERENCE_FAILED"},
                         headers=headers, timeout=20, allow_redirects=False)
        except requests.RequestException:
            pass
        print("Inference or result upload failed", file=sys.stderr)
        raise RuntimeError("GPU image generation failed") from None


if __name__ == "__main__" and os.environ.get("LL_SETUP_ONLY") != "1":
    run(os.environ["LL_CALLBACK_URL"], os.environ["LL_JOB_ID"], os.environ["LL_JOB_TOKEN"])
